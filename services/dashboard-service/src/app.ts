import { Router } from 'express';
import {
  asyncHandler,
  authenticate,
  env,
  many,
  one,
  processOnce,
  requireRole,
  type AuthedRequest,
  type DomainEvent,
  type ServiceContext,
} from '@sos/shared';

const SERVICES = [
  { name: 'auth-service', envKey: 'AUTH_SERVICE_URL', fallback: 'http://localhost:4001' },
  { name: 'donor-service', envKey: 'DONOR_SERVICE_URL', fallback: 'http://localhost:4002' },
  { name: 'hospital-service', envKey: 'HOSPITAL_SERVICE_URL', fallback: 'http://localhost:4003' },
  { name: 'matching-service', envKey: 'MATCHING_SERVICE_URL', fallback: 'http://localhost:4004' },
  { name: 'notification-service', envKey: 'NOTIFICATION_SERVICE_URL', fallback: 'http://localhost:4005' },
  { name: 'stock-service', envKey: 'STOCK_SERVICE_URL', fallback: 'http://localhost:4006' },
  { name: 'dashboard-service', envKey: 'DASHBOARD_SERVICE_URL', fallback: 'http://localhost:4007' },
];

export function serviceUrls(): { name: string; url: string }[] {
  return SERVICES.map((service) => ({ name: service.name, url: env(service.envKey, service.fallback) }));
}

/** Statistiques de demonstration: clairement identifiees comme telles cote API et UI. */
const DEMO_STATS = {
  donorsRegistered: 4280,
  hospitalsConnected: 37,
  livesSupported: 11240,
  averageResponseMinutes: 14,
  label: 'donnees de demonstration',
};

export function dashboardRoutes(ctx: ServiceContext): Router {
  const router = Router();
  const auth = authenticate(() => ctx.config.jwtSecret);

  async function liveAggregates(hospitalId?: string): Promise<{
    urgencesDeclared: number;
    bagsCollected: number;
    donorsMobilized: number;
    hospitalsEngaged: number;
    avgMobilisationSeconds: number | null;
  }> {
    const params: unknown[] = [];
    const filter = hospitalId ? "AND payload->>'hospitalId' = $1" : '';
    if (hospitalId) params.push(hospitalId);

    const counts = await one<{ urgences: string; bags: string }>(
      ctx.pool,
      `SELECT
         count(*) FILTER (WHERE type = 'urgence.creee')::text AS urgences,
         COALESCE(sum((payload->>'bags')::int) FILTER (WHERE type = 'don.effectue'), 0)::text AS bags
       FROM events_log WHERE 1=1 ${filter}`,
      params,
    );

    const donors = await one<{ count: string }>(
      ctx.pool,
      `SELECT count(DISTINCT donor_id)::text AS count FROM (
         SELECT jsonb_array_elements(payload->'selected')->>'donorId' AS donor_id
         FROM events_log WHERE type = 'donneurs.selectionnes' ${filter}
       ) t WHERE donor_id IS NOT NULL`,
      params,
    );

    const hospitals = await one<{ count: string }>(
      ctx.pool,
      `SELECT count(DISTINCT payload->>'hospitalId')::text AS count FROM events_log
       WHERE payload ? 'hospitalId' ${filter}`,
      params,
    );

    const delay = await one<{ avg_seconds: string | null }>(
      ctx.pool,
      `SELECT round(avg(extract(epoch FROM (occurred_at - (payload->>'requestedAt')::timestamptz))))::text AS avg_seconds
       FROM events_log WHERE type = 'donneurs.selectionnes' AND payload ? 'requestedAt' ${filter}`,
      params,
    );

    return {
      urgencesDeclared: Number(counts?.urgences ?? 0),
      bagsCollected: Number(counts?.bags ?? 0),
      donorsMobilized: Number(donors?.count ?? 0),
      hospitalsEngaged: Number(hospitals?.count ?? 0),
      avgMobilisationSeconds: delay?.avg_seconds ? Number(delay.avg_seconds) : null,
    };
  }

  // ------------------------------------------------------------------ public
  router.get(
    '/dashboard/public',
    asyncHandler(async (_req, res) => {
      const live = await liveAggregates();
      res.json({ live, demo: DEMO_STATS, disclaimer: 'demo = donnees fictives de demonstration' });
    }),
  );

  // ------------------------------------------------------------------ hopital
  router.get(
    '/dashboard/hospital/me',
    auth,
    requireRole('HOSPITAL'),
    asyncHandler(async (req: AuthedRequest, res) => {
      const aggregated = await liveAggregates(req.user!.sub);
      const series = await many<{ day: string; count: string }>(
        ctx.pool,
        `SELECT to_char(date_trunc('day', occurred_at), 'YYYY-MM-DD') AS day, count(*)::text AS count
         FROM events_log WHERE type = 'urgence.creee' AND payload->>'hospitalId' = $1
           AND occurred_at > now() - interval '14 days'
         GROUP BY 1 ORDER BY 1`,
        [req.user!.sub],
      );
      res.json({ aggregates: aggregated, series: series.map((r) => ({ day: r.day, count: Number(r.count) })) });
    }),
  );

  // ------------------------------------------------------------------ admin
  router.get(
    '/dashboard/admin/overview',
    auth,
    requireRole('ADMIN'),
    asyncHandler(async (req: AuthedRequest, res) => {
      const [live, byStatus, byPriority, series, recent, users] = await Promise.all([
        liveAggregates(),
        many<{ status: string; count: string }>(
          ctx.pool,
          `SELECT payload->>'status' AS status, count(*)::text AS count FROM events_log
           WHERE type = 'urgence.cloturee' GROUP BY 1`,
        ),
        many<{ priority: string; count: string }>(
          ctx.pool,
          `SELECT payload->>'priority' AS priority, count(*)::text AS count FROM events_log
           WHERE type = 'urgence.creee' GROUP BY 1`,
        ),
        many<{ day: string; count: string }>(
          ctx.pool,
          `SELECT to_char(date_trunc('day', occurred_at), 'YYYY-MM-DD') AS day, count(*)::text AS count
           FROM events_log WHERE type = 'urgence.creee' AND occurred_at > now() - interval '14 days'
           GROUP BY 1 ORDER BY 1`,
        ),
        many<{ type: string; occurred_at: string; correlation_id: string }>(
          ctx.pool,
          'SELECT type, occurred_at, correlation_id FROM events_log ORDER BY recorded_at DESC LIMIT 25',
        ),
        (async () => {
          try {
            const response = await fetch(`${env('AUTH_SERVICE_URL', 'http://localhost:4001')}/api/admin/stats`, {
              headers: { authorization: req.header('authorization') ?? '' },
              signal: AbortSignal.timeout(2000),
            });
            return response.ok ? ((await response.json()) as unknown) : null;
          } catch {
            return null;
          }
        })(),
      ]);

      res.json({
        live,
        users,
        urgences: { byStatus, byPriority },
        series: series.map((r) => ({ day: r.day, count: Number(r.count) })),
        recentEvents: recent,
      });
    }),
  );

  /**
   * Liste des urgences vue administrateur, reconstruite depuis le journal d'evenements
   * (read model). Aucun acces direct au schema hospital : l'etat est deduit du dernier
   * evenement connu pour chaque correlation_id.
   */
  router.get(
    '/dashboard/admin/urgences',
    auth,
    requireRole('ADMIN'),
    asyncHandler(async (req, res) => {
      const limit = Math.min(Number(req.query.limit ?? 100), 300);
      const rows = await many<Record<string, unknown>>(
        ctx.pool,
        `WITH urgence_events AS (
           SELECT * FROM events_log WHERE correlation_id IN (
             SELECT correlation_id FROM events_log WHERE type = 'urgence.creee'
           )
         ), latest AS (
           SELECT correlation_id,
                  (array_agg(type ORDER BY occurred_at DESC))[1] AS last_type,
                  (array_agg(payload ORDER BY occurred_at DESC))[1] AS last_payload,
                  max(occurred_at) AS last_event_at,
                  (array_agg(payload ORDER BY occurred_at ASC))[1] AS first_payload,
                  bool_or(type = 'besoin.couvert') AS has_covered,
                  bool_or(type = 'urgence.cloturee') AS has_closed,
                  max((payload->>'confirmedCount')::int) FILTER (WHERE type = 'besoin.couvert') AS covered_count,
                  max((payload->>'bagsConfirmed')::int) FILTER (WHERE type = 'urgence.cloturee') AS closed_bags
           FROM urgence_events GROUP BY correlation_id
         )
         SELECT correlation_id AS id,
                last_type,
                last_event_at,
                CASE
                  WHEN has_closed THEN COALESCE(last_payload->>'status', 'CLOSED')
                  WHEN has_covered THEN 'COVERED'
                  ELSE 'OPEN'
                END AS status,
                first_payload->>'bloodGroup' AS blood_group,
                first_payload->>'priority' AS priority,
                first_payload->>'hospitalId' AS hospital_id,
                first_payload->>'bagsNeeded' AS bags_needed,
                COALESCE(closed_bags, covered_count, 0) AS bags_confirmed
         FROM latest ORDER BY last_event_at DESC LIMIT $1`,
        [limit],
      );

      res.json({
        urgences: rows.map((r) => ({
          id: r.id,
          status: r.status,
          lastEvent: r.last_type,
          lastEventAt: r.last_event_at,
          bloodGroup: r.blood_group,
          priority: r.priority,
          hospitalId: r.hospital_id,
          bagsNeeded: r.bags_needed ? Number(r.bags_needed) : null,
          bagsConfirmed: Number(r.bags_confirmed ?? 0),
        })),
      });
    }),
  );

  router.get(
    '/dashboard/admin/events',
    auth,
    requireRole('ADMIN'),
    asyncHandler(async (req, res) => {
      const limit = Math.min(Number(req.query.limit ?? 100), 500);
      const rows = await many(
        ctx.pool,
        'SELECT event_id, type, payload, correlation_id, occurred_at FROM events_log ORDER BY recorded_at DESC LIMIT $1',
        [limit],
      );
      res.json({ events: rows });
    }),
  );

  router.get(
    '/dashboard/admin/services',
    auth,
    requireRole('ADMIN'),
    asyncHandler(async (_req, res) => {
      const started = Date.now();
      const results = await Promise.all(
        serviceUrls().map(async ({ name, url }) => {
          const t0 = Date.now();
          try {
            const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) });
            const body = (await response.json()) as { status?: string; uptime?: number };
            return {
              name,
              status: response.ok ? 'UP' : 'DOWN',
              latencyMs: Date.now() - t0,
              uptimeSeconds: body.uptime ?? null,
            };
          } catch {
            return { name, status: 'DOWN' as const, latencyMs: Date.now() - t0, uptimeSeconds: null };
          }
        }),
      );
      res.json({
        services: results,
        checkedAt: new Date().toISOString(),
        totalMs: Date.now() - started,
        allUp: results.every((r) => r.status === 'UP'),
      });
    }),
  );

  return router;
}

/** Read model: chaque evenement metier est journalise (idempotent). */
export async function registerDashboardConsumers(ctx: ServiceContext): Promise<void> {
  await ctx.bus.subscribe(
    '*',
    async (event: DomainEvent) => {
      await processOnce(ctx.pool, event, async () => {
        await ctx.pool.query(
          `INSERT INTO events_log(event_id, type, payload, correlation_id, producer, occurred_at)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (event_id) DO NOTHING`,
          [
            event.id,
            event.type,
            JSON.stringify(event.payload),
            event.correlationId,
            event.producer,
            event.occurredAt,
          ],
        );
        ctx.metrics.eventsConsumed.inc({ type: event.type, result: 'ok' });
      });
    },
    { queue: 'q.dashboard-service.all-events' },
  );
}
