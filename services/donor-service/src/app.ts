import { Router } from 'express';
import { z } from 'zod';
import {
  BLOOD_GROUPS,
  DEFAULT_ELIGIBILITY_RULE,
  HttpError,
  asyncHandler,
  authenticate,
  canDonateTo,
  distanceKm,
  enqueueOutbox,
  evaluateEligibility,
  flushOutbox,
  internalOnly,
  processOnce,
  requireRole,
  validate,
  withTransaction,
  createEvent,
  env,
  many,
  one,
  type AuthedRequest,
  type DomainEvent,
  type EligibilityResult,
  type EligibilityRule,
  type ServiceContext,
} from '@sos/shared';

export type DonorRow = {
  id: string;
  user_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  city: string;
  blood_group: string;
  lat: number | null;
  lng: number | null;
  location_consent: boolean;
  notifications_consent: boolean;
  is_available: boolean;
  birth_date: string | null;
  weight_kg: string | null;
  last_donation_date: string | null;
  total_donations: number;
  alerts_received: number;
  alerts_answered: number;
  alerts_coming: number;
  created_at: string;
}

const bloodGroupEnum = z.enum(BLOOD_GROUPS as unknown as [string, ...string[]]);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const updateSchema = z
  .object({
    firstName: z.string().min(1).max(60).optional(),
    lastName: z.string().min(1).max(60).optional(),
    phone: z.string().min(6).max(30).optional(),
    city: z.string().min(1).max(80).optional(),
    bloodGroup: bloodGroupEnum.optional(),
    birthDate: dateSchema.nullable().optional(),
    weightKg: z.number().min(30).max(250).nullable().optional(),
    lastDonationDate: dateSchema.nullable().optional(),
    locationConsent: z.boolean().optional(),
    notificationsConsent: z.boolean().optional(),
    lat: z.number().min(-90).max(90).nullable().optional(),
    lng: z.number().min(-180).max(180).nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'Aucun champ a mettre a jour' });

const internalCreateSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  email: z.string().email(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().optional(),
  city: z.string().min(1),
  bloodGroup: bloodGroupEnum,
  birthDate: dateSchema.optional(),
  weightKg: z.number().optional(),
  locationConsent: z.boolean().optional(),
  notificationsConsent: z.boolean().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  lastDonationDate: dateSchema.optional(),
});

export function internalToken(): string {
  return env('INTERNAL_API_TOKEN', 'dev-internal-token-change-me');
}

export async function currentRule(ctx: ServiceContext): Promise<EligibilityRule> {
  const base: EligibilityRule = {
    ...DEFAULT_ELIGIBILITY_RULE,
    minIntervalDays: ctx.config.eligibility.minIntervalDays,
    minAge: ctx.config.eligibility.minAge,
    maxAge: ctx.config.eligibility.maxAge,
    minWeightKg: ctx.config.eligibility.minWeightKg,
    version: 'env-' + ctx.config.eligibility.minIntervalDays,
  };
  const row = await one<{ value: Partial<EligibilityRule> }>(
    ctx.pool,
    "SELECT value FROM settings WHERE key = 'eligibility_rule'",
  );
  return row ? { ...base, ...row.value, version: row.value.version ?? base.version } : base;
}

export function eligibilityFor(row: DonorRow, rule: EligibilityRule): EligibilityResult {
  return evaluateEligibility(
    { birthDate: row.birth_date, weightKg: row.weight_kg ? Number(row.weight_kg) : null, lastDonationDate: row.last_donation_date },
    rule,
  );
}

function toDto(row: DonorRow, rule: EligibilityRule) {
  return {
    id: row.id,
    userId: row.user_id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    city: row.city,
    bloodGroup: row.blood_group,
    // La position precise n'est exposee qu'au proprietaire du profil, et seulement avec consentement.
    location: row.location_consent && row.lat !== null && row.lng !== null
      ? { lat: row.lat, lng: row.lng }
      : null,
    locationConsent: row.location_consent,
    notificationsConsent: row.notifications_consent,
    isAvailable: row.is_available,
    birthDate: row.birth_date,
    weightKg: row.weight_kg ? Number(row.weight_kg) : null,
    lastDonationDate: row.last_donation_date,
    totalDonations: row.total_donations,
    alertsReceived: row.alerts_received,
    alertsAnswered: row.alerts_answered,
    alertsComing: row.alerts_coming,
    createdAt: row.created_at,
    eligibility: eligibilityFor(row, rule),
  };
}

async function getDonor(ctx: ServiceContext, userId: string): Promise<DonorRow> {
  const row = await one<DonorRow>(ctx.pool, 'SELECT * FROM donors WHERE user_id = $1 AND deleted_at IS NULL', [userId]);
  if (!row) throw new HttpError(404, 'DONOR_NOT_FOUND', 'Profil donneur introuvable');
  return row;
}

export function donorRoutes(ctx: ServiceContext): Router {
  const router = Router();
  const auth = authenticate(() => ctx.config.jwtSecret);
  const donorOnly = [auth, requireRole('DONOR')];
  const internal = internalOnly(internalToken);
  const fetchImpl = fetch;

  // ------------------------------------------------------------------ profil
  router.get(
    '/donors/me',
    ...donorOnly,
    asyncHandler(async (req: AuthedRequest, res) => {
      const rule = await currentRule(ctx);
      const row = await getDonor(ctx, req.user!.sub);
      res.json({ donor: toDto(row, rule) });
    }),
  );

  router.patch(
    '/donors/me',
    ...donorOnly,
    validate(updateSchema),
    asyncHandler(async (req: AuthedRequest, res) => {
      const body = req.body as z.infer<typeof updateSchema>;
      const row = await getDonor(ctx, req.user!.sub);

      if (body.locationConsent === false) {
        // Retrait du consentement: effacement des coordonnees (minimisation).
        body.lat = null;
        body.lng = null;
      }
      const columns: Record<string, unknown> = {
        first_name: body.firstName,
        last_name: body.lastName,
        phone: body.phone,
        city: body.city,
        blood_group: body.bloodGroup,
        birth_date: body.birthDate,
        weight_kg: body.weightKg,
        last_donation_date: body.lastDonationDate,
        location_consent: body.locationConsent,
        notifications_consent: body.notificationsConsent,
        lat: body.lat,
        lng: body.lng,
      };
      const entries = Object.entries(columns).filter(([, value]) => value !== undefined);
      if (!entries.length) throw new HttpError(400, 'NOTHING_TO_UPDATE');
      const sets = entries.map(([key], index) => `${key} = $${index + 2}`);
      const values = entries.map(([, value]) => value);
      const updated = await one<DonorRow>(
        ctx.pool,
        `UPDATE donors SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`,
        [row.id, ...values],
      );
      const rule = await currentRule(ctx);
      res.json({ donor: toDto(updated!, rule) });
    }),
  );

  router.post(
    '/donors/me/availability',
    ...donorOnly,
    validate(z.object({ isAvailable: z.boolean() })),
    asyncHandler(async (req: AuthedRequest, res) => {
      const { isAvailable } = req.body as { isAvailable: boolean };
      const row = await getDonor(ctx, req.user!.sub);
      const updated = await one<DonorRow>(
        ctx.pool,
        'UPDATE donors SET is_available = $2, updated_at = now() WHERE id = $1 RETURNING *',
        [row.id, isAvailable],
      );
      res.json({ donor: toDto(updated!, await currentRule(ctx)) });
    }),
  );

  router.post(
    '/donors/me/location',
    ...donorOnly,
    validate(z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), consent: z.literal(true) })),
    asyncHandler(async (req: AuthedRequest, res) => {
      const { lat, lng } = req.body as { lat: number; lng: number };
      const row = await getDonor(ctx, req.user!.sub);
      const updated = await one<DonorRow>(
        ctx.pool,
        `UPDATE donors SET lat = $2, lng = $3, location_consent = true, updated_at = now()
         WHERE id = $1 RETURNING *`,
        [row.id, lat, lng],
      );
      res.json({ donor: toDto(updated!, await currentRule(ctx)) });
    }),
  );

  router.get(
    '/donors/me/eligibility',
    ...donorOnly,
    asyncHandler(async (req: AuthedRequest, res) => {
      const rule = await currentRule(ctx);
      const row = await getDonor(ctx, req.user!.sub);
      res.json({ eligibility: eligibilityFor(row, rule), rule });
    }),
  );

  // ------------------------------------------------------------------ historique
  router.get(
    '/donors/me/history',
    ...donorOnly,
    asyncHandler(async (req: AuthedRequest, res) => {
      const row = await getDonor(ctx, req.user!.sub);
      const [donations, responses] = await Promise.all([
        many(ctx.pool, 'SELECT * FROM donations WHERE donor_id = $1 ORDER BY donated_on DESC LIMIT 100', [row.id]),
        many(
          ctx.pool,
          'SELECT * FROM alert_responses WHERE donor_id = $1 ORDER BY created_at DESC LIMIT 100',
          [row.id],
        ),
      ]);
      res.json({
        donations: donations.map((d) => ({
          id: (d as { id: string }).id,
          hospitalName: (d as { hospital_name: string }).hospital_name,
          urgencyId: (d as { urgency_id: string | null }).urgency_id,
          donatedOn: (d as { donated_on: string }).donated_on,
          bags: (d as { bags: number }).bags,
        })),
        responses: responses.map((r) => ({
          id: (r as { id: string }).id,
          urgencyId: (r as { urgency_id: string }).urgency_id,
          answer: (r as { answer: string }).answer,
          createdAt: (r as { created_at: string }).created_at,
        })),
      });
    }),
  );

  // ------------------------------------------------------------------ urgences compatibles
  router.get(
    '/donors/me/compatible-urgences',
    ...donorOnly,
    asyncHandler(async (req: AuthedRequest, res) => {
      const row = await getDonor(ctx, req.user!.sub);
      let urgences: {
        id: string; hospitalId: string; hospitalName: string; bloodGroup: string; bagsNeeded: number;
        bagsConfirmed: number; priority: string; city: string; lat: number; lng: number;
        deadlineAt: string; createdAt: string;
      }[] = [];
      try {
        const response = await fetchImpl(`${env('HOSPITAL_SERVICE_URL', 'http://localhost:4003')}/api/internal/urgences/open`, {
          headers: { 'x-internal-token': internalToken() },
          signal: AbortSignal.timeout(3000),
        });
        if (response.ok) {
          const data = (await response.json()) as { urgences: typeof urgences };
          urgences = data.urgences;
        }
      } catch (err) {
        ctx.logger.warn({ err }, 'Service hopital indisponible pour les urgences compatibles');
      }

      const compatible = urgences
        .filter((urgence) => canDonateTo(row.blood_group as never, urgence.bloodGroup as never))
        .map((urgence) => ({
          ...urgence,
          distanceKm:
            row.lat !== null && row.lng !== null ? distanceKm({ lat: row.lat, lng: row.lng }, urgence) : null,
        }))
        .sort((a, b) => (a.distanceKm ?? 9e9) - (b.distanceKm ?? 9e9));

      res.json({ urgences: compatible, degraded: urgences.length === 0 });
    }),
  );

  // ------------------------------------------------------------------ reponse a une alerte
  router.post(
    '/donors/me/responses',
    ...donorOnly,
    validate(z.object({ urgenceId: z.string().uuid(), answer: z.enum(['COMING', 'CANNOT']) })),
    asyncHandler(async (req: AuthedRequest, res) => {
      const { urgenceId, answer } = req.body as { urgenceId: string; answer: 'COMING' | 'CANNOT' };
      const row = await getDonor(ctx, req.user!.sub);

      let hospitalId = '';
      let urgenceStatus = 'OPEN';
      try {
        const response = await fetchImpl(
          `${env('HOSPITAL_SERVICE_URL', 'http://localhost:4003')}/api/internal/urgences/${urgenceId}`,
          { headers: { 'x-internal-token': internalToken() }, signal: AbortSignal.timeout(3000) },
        );
        if (!response.ok) throw new HttpError(404, 'URGENCE_NOT_FOUND', 'Urgence introuvable');
        const data = (await response.json()) as { urgence: { hospitalId: string; status: string } };
        hospitalId = data.urgence.hospitalId;
        urgenceStatus = data.urgence.status;
      } catch (err) {
        if (err instanceof HttpError) throw err;
        throw new HttpError(503, 'HOSPITAL_SERVICE_UNAVAILABLE', 'Service hopital indisponible');
      }
      if (!['OPEN', 'COVERED'].includes(urgenceStatus)) {
        throw new HttpError(409, 'URGENCE_CLOSED', "Cette urgence n'accepte plus de reponses");
      }

      const event = createEvent(
        'reponse.recue',
        { urgenceId, donorId: row.id, hospitalId, answer, respondedAt: new Date().toISOString() },
        { producer: 'donor-service', correlationId: urgenceId },
      );

      const inserted = await withTransaction(ctx.pool, async (client) => {
        const result = await client.query(
          `INSERT INTO alert_responses(urgency_id, hospital_id, donor_id, answer)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (urgency_id, donor_id) DO NOTHING
           RETURNING id`,
          [urgenceId, hospitalId, row.id, answer],
        );
        if (result.rowCount === 0) return false;
        await client.query(
          `UPDATE donors SET alerts_answered = alerts_answered + 1,
             alerts_coming = alerts_coming + $2, updated_at = now() WHERE id = $1`,
          [row.id, answer === 'COMING' ? 1 : 0],
        );
        if (answer === 'CANNOT') {
          // Pas de nouvel evenement: la reponse negative est tracee localement.
        }
        await enqueueOutbox(client, [event]);
        return true;
      });

      if (!inserted) throw new HttpError(409, 'ALREADY_ANSWERED', 'Vous avez deja repondu a cette alerte');
      await flushOutbox(ctx.pool, ctx.bus, [event.id]);
      ctx.metrics.eventsPublished.inc({ type: event.type });
      res.status(201).json({ ok: true, answer });
    }),
  );

  // ------------------------------------------------------------------ regles d'eligibilite (admin)
  router.get(
    '/donors/rules',
    auth,
    requireRole('ADMIN'),
    asyncHandler(async (_req, res) => {
      res.json({ rule: await currentRule(ctx) });
    }),
  );

  router.put(
    '/donors/rules',
    auth,
    requireRole('ADMIN'),
    validate(
      z.object({
        minIntervalDays: z.number().int().min(30).max(365),
        minAge: z.number().int().min(16).max(40),
        maxAge: z.number().int().min(50).max(80),
        minWeightKg: z.number().int().min(40).max(80),
      }),
    ),
    asyncHandler(async (req: AuthedRequest, res) => {
      const body = req.body as { minIntervalDays: number; minAge: number; maxAge: number; minWeightKg: number };
      const value = { ...body, version: `db-${Date.now()}`, requireMedicalData: false };
      await ctx.pool.query(
        `INSERT INTO settings(key, value, updated_by) VALUES ('eligibility_rule', $1, $2)
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now(), updated_by = $2`,
        [JSON.stringify(value), req.user!.sub],
      );
      res.json({ rule: await currentRule(ctx) });
    }),
  );

  // ------------------------------------------------------------------ routes internes
  router.post(
    '/internal/donors',
    internal,
    validate(internalCreateSchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof internalCreateSchema>;
      const existing = await one<DonorRow>(ctx.pool, 'SELECT * FROM donors WHERE id = $1', [body.id]);
      if (existing) {
        res.status(409).json({ error: { code: 'ALREADY_EXISTS', message: 'Profil deja cree' } });
        return;
      }
      const created = await one<DonorRow>(
        ctx.pool,
        `INSERT INTO donors(id, user_id, first_name, last_name, email, phone, city, blood_group, lat, lng,
            location_consent, notifications_consent, birth_date, weight_kg, last_donation_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING *`,
        [
          body.id, body.userId, body.firstName, body.lastName, body.email, body.phone ?? null, body.city,
          body.bloodGroup, body.lat ?? null, body.lng ?? null,
          Boolean(body.locationConsent && body.lat !== undefined && body.lng !== undefined),
          body.notificationsConsent ?? true, body.birthDate ?? null, body.weightKg ?? null,
          body.lastDonationDate ?? null,
        ],
      );
      res.status(201).json({ donor: { id: created!.id } });
    }),
  );

  router.delete(
    '/internal/donors/:id',
    internal,
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      // Suppression des donnees personnelles; les agregats anonymes sont conserves.
      await ctx.pool.query(
        `UPDATE donors SET deleted_at = now(), is_available = false, email = concat('deleted+', id, '@invalid.local'),
           phone = NULL, lat = NULL, lng = NULL, location_consent = false, first_name = 'Compte',
           last_name = 'supprime', updated_at = now()
         WHERE id = $1`,
        [id],
      );
      res.status(204).end();
    }),
  );

  /**
   * Candidats pour le matching: filtres de base uniquement.
   * L'eligibilite est calculee ici (le service donneur est proprietaire de la regle),
   * le classement par distance/fiabilite appartient au matching-service.
   */
  router.get(
    '/internal/donors',
    internal,
    asyncHandler(async (req, res) => {
      const recipient = String(req.query.bloodGroup ?? '');
      if (!BLOOD_GROUPS.includes(recipient as never)) throw new HttpError(400, 'INVALID_BLOOD_GROUP');
      const donors = [...BLOOD_GROUPS].filter((g) => canDonateTo(g, recipient as never));
      const rule = await currentRule(ctx);
      const rows = await many<DonorRow>(
        ctx.pool,
        `SELECT * FROM donors
         WHERE deleted_at IS NULL AND is_available = true AND notifications_consent = true
           AND blood_group = ANY($1::text[])`,
        [donors],
      );
      const withEligibility = rows.map((row) => {
        const eligibility = eligibilityFor(row, rule);
        return {
          id: row.id,
          userId: row.user_id,
          bloodGroup: row.blood_group,
          city: row.city,
          lat: row.lat,
          lng: row.lng,
          lastDonationDate: row.last_donation_date,
          totalDonations: row.total_donations,
          alertsReceived: row.alerts_received,
          alertsAnswered: row.alerts_answered,
          alertsComing: row.alerts_coming,
          createdAt: row.created_at,
          eligibility,
        };
      });
      res.json({
        donors: withEligibility.filter((d) => d.lat !== null && d.lng !== null),
        excluded: {
          withoutLocation: withEligibility.filter((d) => d.lat === null || d.lng === null).length,
          ineligible: withEligibility.filter(
            (d) => d.lat !== null && d.lng !== null && !d.eligibility.eligible,
          ).length,
        },
        ruleVersion: rule.version,
      });
    }),
  );

  return router;
}

/** Consommateur: enregistre les dons effectivement realises. */
export async function registerDonorConsumers(ctx: ServiceContext): Promise<void> {
  // Alerte recue: compteur de fiabilite (utilise par le classement du matching).
  await ctx.bus.subscribe(
    'donneurs.selectionnes',
    async (event: DomainEvent) => {
      await processOnce(ctx.pool, event, async () => {
        const payload = event.payload as { selected: { donorId: string }[] };
        const ids = payload.selected.map((d) => d.donorId);
        if (ids.length) {
          await ctx.pool.query(
            `UPDATE donors SET alerts_received = alerts_received + 1 WHERE id = ANY($1::uuid[])`,
            [ids],
          );
        }
        ctx.metrics.eventsConsumed.inc({ type: event.type, result: 'ok' });
      });
    },
    { queue: 'q.donor-service.donneurs-selectionnes' },
  );

  await ctx.bus.subscribe(
    'don.effectue',
    async (event: DomainEvent) => {
      await processOnce(ctx.pool, event, async () => {
        const payload = event.payload as {
          urgenceId: string;
          hospitalId: string;
          hospitalName?: string;
          donorId: string;
          bags: number;
          recordedAt: string;
        };
        await withTransaction(ctx.pool, async (client) => {
          await client.query(
            `INSERT INTO donations(donor_id, hospital_id, hospital_name, urgency_id, donated_on, bags)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [
              payload.donorId,
              payload.hospitalId,
              payload.hospitalName ?? 'Hopital',
              payload.urgenceId,
              payload.recordedAt.slice(0, 10),
              payload.bags,
            ],
          );
          await client.query(
            `UPDATE donors SET total_donations = total_donations + 1,
               last_donation_date = GREATEST(COALESCE(last_donation_date, DATE '1900-01-01'), $2::date),
               updated_at = now()
             WHERE id = $1`,
            [payload.donorId, payload.recordedAt.slice(0, 10)],
          );
        });
        ctx.metrics.eventsConsumed.inc({ type: event.type, result: 'ok' });
      });
    },
    { queue: 'q.donor-service.don-effectue' },
  );
}
