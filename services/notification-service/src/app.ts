import { Router } from 'express';
import {
  HttpError,
  asyncHandler,
  authenticate,
  createLogger,
  env,
  many,
  one,
  processOnce,
  requireRole,
  type AuthedRequest,
  type BesoinCouvertPayload,
  type DomainEvent,
  type DonneursSelectionnesPayload,
  type ServiceContext,
} from '@sos/shared';
import { createSimulatedTransport, type Channel, type ChannelTransport } from './channels';

type NotificationRow = {
  id: string;
  donor_id: string;
  urgency_id: string | null;
  type: string;
  channel: string;
  status: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  attempts: number;
  error: string | null;
  latency_ms: number | null;
  created_at: string;
  sent_at: string | null;
  read_at: string | null;
};

function toDto(row: NotificationRow) {
  return {
    id: row.id,
    urgencyId: row.urgency_id,
    type: row.type,
    channel: row.channel,
    status: row.status,
    title: row.title,
    body: row.body,
    payload: row.payload,
    attempts: row.attempts,
    error: row.error,
    latencyMs: row.latency_ms,
    createdAt: row.created_at,
    sentAt: row.sent_at,
    readAt: row.read_at,
  };
}

export interface NotificationDeps {
  transport?: ChannelTransport;
  channels?: Channel[];
}

function transportFor(ctx: ServiceContext, deps: NotificationDeps): ChannelTransport {
  if (deps.transport) return deps.transport;
  const mode = env('NOTIFICATION_EMAIL_MODE', 'simulated');
  return createSimulatedTransport(createLogger('notification-transport'), mode);
}

/** Cree puis "envoie" une notification (3 tentatives, statut final persiste). */
export async function deliverNotification(
  ctx: ServiceContext,
  transport: ChannelTransport,
  input: {
    donorId: string;
    urgencyId?: string | null;
    type: 'URGENT_NEED' | 'NEED_COVERED' | 'INFO';
    channel: Channel;
    title: string;
    body: string;
    payload?: Record<string, unknown>;
    latencyMs?: number | null;
  },
): Promise<NotificationRow | null> {
  const inserted = await one<NotificationRow>(
    ctx.pool,
    `INSERT INTO notifications(donor_id, urgency_id, type, channel, title, body, payload, latency_ms, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'QUEUED')
     ON CONFLICT DO NOTHING RETURNING *`,
    [
      input.donorId,
      input.urgencyId ?? null,
      input.type,
      input.channel,
      input.title,
      input.body,
      JSON.stringify(input.payload ?? {}),
      input.latencyMs ?? null,
    ],
  );
  if (!inserted) return null; // doublon (idempotence)

  let lastError = '';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const result = await transport.deliver({
        channel: input.channel,
        donorId: input.donorId,
        title: input.title,
        body: input.body,
        urgencyId: input.urgencyId ?? undefined,
      });
      if (result.ok) {
        const sent = await one<NotificationRow>(
          ctx.pool,
          `UPDATE notifications SET status = 'SENT', sent_at = now(), attempts = $2, error = NULL
           WHERE id = $1 RETURNING *`,
          [inserted.id, attempt],
        );
        if (input.latencyMs !== null && input.latencyMs !== undefined) {
          ctx.metrics.notificationLatency.observe({ channel: input.channel }, input.latencyMs / 1000);
        }
        return sent;
      }
      lastError = result.error ?? 'DELIVERY_FAILED';
    } catch (err) {
      lastError = (err as Error).message;
    }
    await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
  }

  const failed = await one<NotificationRow>(
    ctx.pool,
    `UPDATE notifications SET status = 'FAILED', attempts = 3, error = $2 WHERE id = $1 RETURNING *`,
    [inserted.id, lastError],
  );
  ctx.logger.error({ notificationId: inserted.id, lastError }, 'Notification en echec apres 3 tentatives');
  return failed;
}

export function notificationRoutes(ctx: ServiceContext, deps: NotificationDeps = {}): Router {
  const router = Router();
  const auth = authenticate(() => ctx.config.jwtSecret);
  const transport = transportFor(ctx, deps);

  router.get(
    '/notifications/me',
    auth,
    requireRole('DONOR'),
    asyncHandler(async (req: AuthedRequest, res) => {
      const rows = await many<NotificationRow>(
        ctx.pool,
        `SELECT * FROM notifications WHERE donor_id = $1 ORDER BY created_at DESC LIMIT 100`,
        [req.user!.sub],
      );
      res.json({
        notifications: rows.map(toDto),
        unreadCount: rows.filter((row) => !row.read_at).length,
      });
    }),
  );

  router.post(
    '/notifications/me/read-all',
    auth,
    requireRole('DONOR'),
    asyncHandler(async (req: AuthedRequest, res) => {
      const result = await ctx.pool.query(
        'UPDATE notifications SET read_at = now() WHERE donor_id = $1 AND read_at IS NULL',
        [req.user!.sub],
      );
      res.json({ updated: result.rowCount ?? 0 });
    }),
  );

  router.post(
    '/notifications/me/:id/read',
    auth,
    requireRole('DONOR'),
    asyncHandler(async (req: AuthedRequest, res) => {
      const row = await one<NotificationRow>(
        ctx.pool,
        'UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND donor_id = $2 RETURNING *',
        [req.params.id, req.user!.sub],
      );
      if (!row) throw new HttpError(404, 'NOTIFICATION_NOT_FOUND');
      res.json({ notification: toDto(row) });
    }),
  );

  router.get(
    '/admin/notifications',
    auth,
    requireRole('ADMIN'),
    asyncHandler(async (req, res) => {
      const status = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : null;
      const limit = Math.min(Number(req.query.limit ?? 100), 500);
      const rows = await many<NotificationRow>(
        ctx.pool,
        `SELECT * FROM notifications WHERE ($1::text IS NULL OR status = $1)
         ORDER BY created_at DESC LIMIT $2`,
        [status, limit],
      );
      res.json({ notifications: rows.map(toDto) });
    }),
  );

  router.get(
    '/admin/notifications/stats',
    auth,
    requireRole('ADMIN'),
    asyncHandler(async (_req, res) => {
      const [byStatus, byChannel, latency] = await Promise.all([
        many<{ status: string; count: string }>(
          ctx.pool,
          'SELECT status, count(*)::text AS count FROM notifications GROUP BY status',
        ),
        many<{ channel: string; count: string }>(
          ctx.pool,
          'SELECT channel, count(*)::text AS count FROM notifications GROUP BY channel',
        ),
        one<{ avg_ms: string | null; max_ms: string | null; p95_ms: string | null }>(
          ctx.pool,
          `SELECT round(avg(latency_ms))::text AS avg_ms,
                  max(latency_ms)::text AS max_ms,
                  round(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms))::text AS p95_ms
           FROM notifications WHERE latency_ms IS NOT NULL`,
        ),
      ]);
      res.json({
        byStatus: byStatus.map((r) => ({ status: r.status, count: Number(r.count) })),
        byChannel: byChannel.map((r) => ({ channel: r.channel, count: Number(r.count) })),
        latency: {
          avgMs: latency?.avg_ms ? Number(latency.avg_ms) : null,
          maxMs: latency?.max_ms ? Number(latency.max_ms) : null,
          p95Ms: latency?.p95_ms ? Number(latency.p95_ms) : null,
        },
        transport: env('NOTIFICATION_EMAIL_MODE', 'simulated'),
      });
    }),
  );

  router.post(
    '/admin/notifications/:id/retry',
    auth,
    requireRole('ADMIN'),
    asyncHandler(async (req, res) => {
      const row = await one<NotificationRow>(ctx.pool, 'SELECT * FROM notifications WHERE id = $1', [
        req.params.id,
      ]);
      if (!row) throw new HttpError(404, 'NOTIFICATION_NOT_FOUND');
      const result = await transport.deliver({
        channel: row.channel as Channel,
        donorId: row.donor_id,
        title: row.title,
        body: row.body,
        urgencyId: row.urgency_id ?? undefined,
      });
      const updated = await one<NotificationRow>(
        ctx.pool,
        `UPDATE notifications SET status = $2, sent_at = CASE WHEN $2 = 'SENT' THEN now() ELSE sent_at END,
           attempts = attempts + 1, error = $3 WHERE id = $1 RETURNING *`,
        [row.id, result.ok ? 'SENT' : 'FAILED', result.ok ? null : result.error ?? 'DELIVERY_FAILED'],
      );
      res.json({ notification: toDto(updated!) });
    }),
  );

  return router;
}

export async function registerNotificationConsumers(
  ctx: ServiceContext,
  deps: NotificationDeps = {},
): Promise<void> {
  const transport = transportFor(ctx, deps);
  const channels = deps.channels ?? (['EMAIL', 'SMS', 'WEB'] as Channel[]);

  // --- Nouvelles urgences: une alerte par canal pour chaque donneur selectionne.
  await ctx.bus.subscribe(
    'donneurs.selectionnes',
    async (event: DomainEvent) => {
      await processOnce(ctx.pool, event, async () => {
        const payload = event.payload as DonneursSelectionnesPayload;
        const base = new Date(payload.requestedAt).getTime();
        const latencyMs = Number.isFinite(base) ? Math.max(0, Date.now() - base) : null;

        for (const donor of payload.selected) {
          const title =
            payload.priority === 'CRITICAL'
              ? `URGENCE VITALE : ${payload.bloodGroup} a ${donor.distanceKm} km`
              : `Besoin urgent : ${payload.bloodGroup} a ${donor.distanceKm} km`;
          const body =
            `${payload.hospitalName} (${payload.city}) a besoin de ${payload.bagsNeeded} poche(s) ` +
            `de ${payload.bloodGroup}. Vous etes compatible et a ${donor.distanceKm} km. ` +
            `Confirmez votre venue dans l'application SOS Sang.`;
          for (const channel of channels) {
            await deliverNotification(ctx, transport, {
              donorId: donor.donorId,
              urgencyId: payload.urgenceId,
              type: 'URGENT_NEED',
              channel,
              title,
              body,
              payload: {
                hospitalName: payload.hospitalName,
                bloodGroup: payload.bloodGroup,
                bagsNeeded: payload.bagsNeeded,
                distanceKm: donor.distanceKm,
                priority: payload.priority,
                deadlineAt: payload.createdAt,
              },
              latencyMs,
            });
          }
        }
        ctx.metrics.eventsConsumed.inc({ type: event.type, result: 'ok' });
      });
    },
    { queue: 'q.notification-service.donneurs-selectionnes' },
  );

  // --- Besoin couvert: informer les autres donneurs de ne plus se deplacer.
  await ctx.bus.subscribe(
    'besoin.couvert',
    async (event: DomainEvent) => {
      await processOnce(ctx.pool, event, async () => {
        const payload = event.payload as BesoinCouvertPayload;
        const base = new Date(payload.coveredAt).getTime();
        const latencyMs = Number.isFinite(base) ? Math.max(0, Date.now() - base) : null;
        for (const donorId of payload.notSelectedDonorIds ?? []) {
          await deliverNotification(ctx, transport, {
            donorId,
            urgencyId: payload.urgenceId,
            type: 'NEED_COVERED',
            channel: 'WEB',
            title: 'Besoin deja couvert',
            body:
              'Merci : le besoin pour cette urgence est couvert. Vous pouvez annuler votre deplacement ' +
              'si vous n etes pas encore parti.',
            payload: { bagsNeeded: payload.bagsNeeded, confirmedCount: payload.confirmedCount },
            latencyMs,
          });
        }
        ctx.metrics.eventsConsumed.inc({ type: event.type, result: 'ok' });
      });
    },
    { queue: 'q.notification-service.besoin-couvert' },
  );
}
