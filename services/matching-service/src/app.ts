import { Router } from 'express';
import {
  HttpError,
  asyncHandler,
  authenticate,
  createEvent,
  enqueueOutbox,
  env,
  envInt,
  flushOutbox,
  many,
  processOnce,
  requireRole,
  withTransaction,
  type BloodGroup,
  type DomainEvent,
  type DonneursSelectionnesPayload,
  type ServiceContext,
  type UrgenceCreeePayload,
} from '@sos/shared';
import { rankCandidates, selectWithRadiusExpansion, type Candidate } from './matching';

export function radiiFromEnv(): number[] {
  return env('MATCHING_RADII_KM', '25,50,100,200')
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
}

interface DonorInternalResponse {
  donors: Candidate[];
  excluded: { withoutLocation: number; ineligible: number };
  ruleVersion: string;
}

async function fetchCandidates(ctx: ServiceContext, bloodGroup: string): Promise<DonorInternalResponse> {
  const url = `${env('DONOR_SERVICE_URL', 'http://localhost:4002')}/api/internal/donors?bloodGroup=${encodeURIComponent(bloodGroup)}`;
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: { 'x-internal-token': env('INTERNAL_API_TOKEN', 'dev-internal-token-change-me') },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} sur donor-service`);
      return (await res.json()) as DonorInternalResponse;
    } catch (err) {
      lastError = err as Error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
    }
  }
  ctx.logger.error({ err: lastError }, 'Recherche de donneurs impossible');
  throw new Error(`donor-service indisponible: ${lastError?.message}`);
}

export function matchingRoutes(ctx: ServiceContext): Router {
  const router = Router();
  const auth = authenticate(() => ctx.config.jwtSecret);

  router.get(
    '/matching/runs',
    auth,
    requireRole('ADMIN'),
    asyncHandler(async (req, res) => {
      const limit = Math.min(Number(req.query.limit ?? 50), 200);
      const rows = await many(
        ctx.pool,
        `SELECT id, urgence_id, blood_group, bags_needed, radius_km, candidates, selected,
                insufficient, duration_ms, excluded, created_at
         FROM matching_runs ORDER BY created_at DESC LIMIT $1`,
        [limit],
      );
      res.json({ runs: rows });
    }),
  );

  router.get(
    '/matching/runs/:urgenceId',
    auth,
    requireRole('ADMIN'),
    asyncHandler(async (req, res) => {
      const rows = await many(
        ctx.pool,
        'SELECT * FROM matching_runs WHERE urgence_id = $1 ORDER BY created_at DESC',
        [req.params.urgenceId],
      );
      if (!rows.length) throw new HttpError(404, 'RUN_NOT_FOUND', 'Aucun calcul pour cette urgence');
      res.json({ runs: rows });
    }),
  );

  router.get(
    '/matching/config',
    auth,
    requireRole('ADMIN'),
    asyncHandler(async (_req, res) => {
      res.json({
        radiiKm: radiiFromEnv(),
        maxAlerts: envInt('MATCHING_MAX_ALERTS', 40),
        ranking: [
          'distance croissante (Haversine)',
          'puis score de fiabilite decroissant (dons, taux de reponse, taux de venue)',
        ],
      });
    }),
  );

  return router;
}

/** Consommateur principal: urgence.creee -> selection -> donneurs.selectionnes. */
export async function registerMatchingConsumers(ctx: ServiceContext): Promise<void> {
  await ctx.bus.subscribe(
    'urgence.creee',
    async (event: DomainEvent) => {
      await processOnce(ctx.pool, event, async () => {
        const payload = event.payload as UrgenceCreeePayload;
        const startedAt = Date.now();
        const radii = radiiFromEnv();
        const maxAlerts = envInt('MATCHING_MAX_ALERTS', 40);

        const data = await fetchCandidates(ctx, payload.bloodGroup);

        const usable = data.donors.filter(
          (donor) => donor.eligibility?.eligible === true && donor.lat !== null && donor.lng !== null,
        );
        const ineligible = data.donors.filter((donor) => donor.eligibility?.eligible !== true).length;

        const { selected, radiusKm, insufficient } = selectWithRadiusExpansion(usable, {
          lat: payload.lat,
          lng: payload.lng,
          bagsNeeded: payload.bagsNeeded,
          radii,
          maxAlerts,
        });

        const maxRadius = radii[radii.length - 1] ?? 0;
        const inMaxRadius = rankCandidates(usable, {
          lat: payload.lat,
          lng: payload.lng,
          radiusKm: maxRadius,
          limit: Number.MAX_SAFE_INTEGER,
        }).length;
        const outsideRadius = Math.max(0, usable.length - inMaxRadius);

        const selectedPayload: DonneursSelectionnesPayload = {
          urgenceId: payload.urgenceId,
          hospitalId: payload.hospitalId,
          hospitalName: payload.hospitalName,
          bloodGroup: payload.bloodGroup as BloodGroup,
          bagsNeeded: payload.bagsNeeded,
          priority: payload.priority,
          city: payload.city,
          lat: payload.lat,
          lng: payload.lng,
          radiusKm,
          selected: selected.map((candidate) => ({
            donorId: candidate.id,
            userId: candidate.userId,
            bloodGroup: candidate.bloodGroup,
            distanceKm: candidate.distanceKm,
            reliabilityScore: candidate.reliabilityScore,
            lastDonationDate: candidate.lastDonationDate,
            rank: candidate.rank,
          })),
          excluded: {
            total: data.excluded.withoutLocation + ineligible + Math.max(0, outsideRadius),
            byReason: {
              noLocation: data.excluded.withoutLocation,
              ineligible,
              outsideRadius: Math.max(0, outsideRadius),
            },
          },
          requestedAt: payload.requestedAt,
          createdAt: payload.createdAt,
        };

        const outEvent = createEvent('donneurs.selectionnes', selectedPayload, {
          producer: 'matching-service',
          correlationId: payload.urgenceId,
        });
        const durationMs = Date.now() - startedAt;

        await withTransaction(ctx.pool, async (client) => {
          await client.query(
            `INSERT INTO matching_runs(urgence_id, blood_group, bags_needed, radius_km, candidates, selected,
               insufficient, duration_ms, excluded)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              payload.urgenceId,
              payload.bloodGroup,
              payload.bagsNeeded,
              radiusKm,
              selected.length,
              selected.length,
              insufficient,
              durationMs,
              JSON.stringify(selectedPayload.excluded),
            ],
          );
          await enqueueOutbox(client, [outEvent]);
        });

        await flushOutbox(ctx.pool, ctx.bus, [outEvent.id]);
        ctx.metrics.matchingDuration.observe({ result: insufficient ? 'insufficient' : 'ok' }, durationMs / 1000);
        ctx.metrics.eventsPublished.inc({ type: outEvent.type });
        ctx.metrics.eventsConsumed.inc({ type: event.type, result: 'ok' });
        ctx.logger.info(
          { urgenceId: payload.urgenceId, selected: selected.length, radiusKm, durationMs },
          'Selection de donneurs terminee',
        );
      });
    },
    { queue: 'q.matching-service.urgence-creee' },
  );
}
