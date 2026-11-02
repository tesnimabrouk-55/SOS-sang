import { Router } from 'express';
import { z } from 'zod';
import {
  BLOOD_GROUPS,
  HttpError,
  asyncHandler,
  authenticate,
  createEvent,
  enqueueOutbox,
  env,
  flushOutbox,
  internalOnly,
  many,
  one,
  requireRole,
  validate,
  withTransaction,
  type AuthedRequest,
  type ServiceContext,
} from '@sos/shared';
import { emitUrgenceUpdate } from './realtime';

export type HospitalRow = {
  id: string;
  user_id: string;
  name: string;
  contact_name: string;
  email: string;
  phone: string | null;
  city: string;
  address: string;
  lat: number | null;
  lng: number | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  created_at: string;
};

export type UrgenceRow = {
  id: string;
  hospital_id: string;
  blood_group: string;
  bags_needed: number;
  bags_confirmed: number;
  priority: 'CRITICAL' | 'HIGH' | 'NORMAL';
  deadline_at: string;
  city: string;
  lat: number;
  lng: number;
  notes: string | null;
  radius_km: number;
  status: 'OPEN' | 'COVERED' | 'CLOSED' | 'CANCELLED';
  contact_phone: string | null;
  created_at: string;
  covered_at: string | null;
  closed_at: string | null;
};

export type UrgenceWithCounts = UrgenceRow & {
  contacted: string;
  coming: string;
  confirmed: string;
  declined: string;
};

const URGENCE_SELECT = `
  SELECT u.*,
    (SELECT count(*) FROM urgency_responses r WHERE r.urgency_id = u.id)::text AS contacted,
    (SELECT count(*) FROM urgency_responses r WHERE r.urgency_id = u.id AND r.status = 'COMING')::text AS coming,
    (SELECT count(*) FROM urgency_responses r WHERE r.urgency_id = u.id AND r.status = 'CONFIRMED')::text AS confirmed,
    (SELECT count(*) FROM urgency_responses r WHERE r.urgency_id = u.id AND r.status = 'DECLINED')::text AS declined
  FROM urgences u
`;

export function toUrgenceDto(row: UrgenceWithCounts) {
  return {
    id: row.id,
    hospitalId: row.hospital_id,
    bloodGroup: row.blood_group,
    bagsNeeded: row.bags_needed,
    bagsConfirmed: row.bags_confirmed,
    priority: row.priority,
    deadlineAt: row.deadline_at,
    city: row.city,
    location: { lat: row.lat, lng: row.lng },
    notes: row.notes,
    radiusKm: row.radius_km,
    status: row.status,
    contactPhone: row.contact_phone,
    createdAt: row.created_at,
    coveredAt: row.covered_at,
    closedAt: row.closed_at,
    counts: {
      contacted: Number(row.contacted ?? 0),
      coming: Number(row.coming ?? 0),
      confirmed: Number(row.confirmed ?? 0),
      declined: Number(row.declined ?? 0),
    },
  };
}

function toHospitalDto(row: HospitalRow) {
  return {
    id: row.id,
    name: row.name,
    contactName: row.contact_name,
    email: row.email,
    phone: row.phone,
    city: row.city,
    address: row.address,
    location: row.lat !== null && row.lng !== null ? { lat: row.lat, lng: row.lng } : null,
    status: row.status,
    createdAt: row.created_at,
  };
}

const createUrgenceSchema = z.object({
  bloodGroup: z.enum(BLOOD_GROUPS as unknown as [string, ...string[]]),
  bagsNeeded: z.number().int().min(1).max(50),
  priority: z.enum(['CRITICAL', 'HIGH', 'NORMAL']),
  deadlineAt: z.string().min(10),
  city: z.string().min(1).max(80).optional(),
  notes: z.string().max(500).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  contactPhone: z.string().max(30).optional(),
});

export function internalToken(): string {
  return env('INTERNAL_API_TOKEN', 'dev-internal-token-change-me');
}

export function hospitalRoutes(ctx: ServiceContext): Router {
  const router = Router();
  const auth = authenticate(() => ctx.config.jwtSecret);
  const hospitalAuth = [auth, requireRole('HOSPITAL')];
  const internal = internalOnly(internalToken);

  async function loadHospital(userId: string): Promise<HospitalRow> {
    const row = await one<HospitalRow>(
      ctx.pool,
      'SELECT * FROM hospitals WHERE user_id = $1 AND deleted_at IS NULL',
      [userId],
    );
    if (!row) throw new HttpError(404, 'HOSPITAL_NOT_FOUND', 'Etablissement introuvable');
    return row;
  }

  /** Un compte non valide ne peut pas declencher d'urgence. */
  async function requireApproved(userId: string): Promise<HospitalRow> {
    const hospital = await loadHospital(userId);
    if (hospital.status !== 'APPROVED') {
      throw new HttpError(403, 'HOSPITAL_NOT_APPROVED', "Compte etablissement en attente de validation");
    }
    return hospital;
  }

  // ------------------------------------------------------------------ profil
  router.get(
    '/hospitals/me',
    ...hospitalAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const hospital = await loadHospital(req.user!.sub);
      res.json({ hospital: toHospitalDto(hospital) });
    }),
  );

  router.patch(
    '/hospitals/me',
    ...hospitalAuth,
    validate(
      z.object({
        name: z.string().min(2).max(120).optional(),
        contactName: z.string().min(2).max(120).optional(),
        phone: z.string().min(6).max(30).optional(),
        city: z.string().min(1).max(80).optional(),
        address: z.string().min(3).max(200).optional(),
        lat: z.number().min(-90).max(90).optional(),
        lng: z.number().min(-180).max(180).optional(),
      }),
    ),
    asyncHandler(async (req: AuthedRequest, res) => {
      const hospital = await loadHospital(req.user!.sub);
      const body = req.body as Record<string, unknown>;
      const map: Record<string, string> = {
        name: 'name',
        contactName: 'contact_name',
        phone: 'phone',
        city: 'city',
        address: 'address',
        lat: 'lat',
        lng: 'lng',
      };
      const entries = Object.entries(body).filter(([key]) => map[key] !== undefined);
      if (!entries.length) throw new HttpError(400, 'NOTHING_TO_UPDATE');
      const sets = entries.map(([key], i) => `${map[key]} = $${i + 2}`);
      const updated = await one<HospitalRow>(
        ctx.pool,
        `UPDATE hospitals SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`,
        [hospital.id, ...entries.map(([, value]) => value)],
      );
      res.json({ hospital: toHospitalDto(updated!) });
    }),
  );

  // ------------------------------------------------------------------ tableau de bord
  router.get(
    '/hospitals/me/dashboard',
    ...hospitalAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const hospital = await loadHospital(req.user!.sub);
      const [counts, latest] = await Promise.all([
        one<{ active: string; open: string; covered: string; closed: string; cancelled: string }>(
          ctx.pool,
          `SELECT
             count(*) FILTER (WHERE status IN ('OPEN','COVERED'))::text AS active,
             count(*) FILTER (WHERE status = 'OPEN')::text AS open,
             count(*) FILTER (WHERE status = 'COVERED')::text AS covered,
             count(*) FILTER (WHERE status = 'CLOSED')::text AS closed,
             count(*) FILTER (WHERE status = 'CANCELLED')::text AS cancelled
           FROM urgences WHERE hospital_id = $1`,
          [hospital.id],
        ),
        many<UrgenceWithCounts>(
          ctx.pool,
          `${URGENCE_SELECT} WHERE u.hospital_id = $1 ORDER BY u.created_at DESC LIMIT 5`,
          [hospital.id],
        ),
      ]);
      res.json({
        hospital: toHospitalDto(hospital),
        counts: {
          active: Number(counts?.active ?? 0),
          open: Number(counts?.open ?? 0),
          covered: Number(counts?.covered ?? 0),
          closed: Number(counts?.closed ?? 0),
          cancelled: Number(counts?.cancelled ?? 0),
        },
        latest: latest.map(toUrgenceDto),
      });
    }),
  );

  // ------------------------------------------------------------------ urgences
  router.get(
    '/hospitals/me/urgences',
    ...hospitalAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const hospital = await loadHospital(req.user!.sub);
      const status = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : null;
      const rows = await many<UrgenceWithCounts>(
        ctx.pool,
        `${URGENCE_SELECT} WHERE u.hospital_id = $1 AND ($2::text IS NULL OR u.status = $2)
         ORDER BY u.created_at DESC LIMIT 100`,
        [hospital.id, status],
      );
      res.json({ urgences: rows.map(toUrgenceDto) });
    }),
  );

  router.post(
    '/hospitals/me/urgences',
    ...hospitalAuth,
    validate(createUrgenceSchema),
    asyncHandler(async (req: AuthedRequest, res) => {
      const hospital = await requireApproved(req.user!.sub);
      const body = req.body as z.infer<typeof createUrgenceSchema>;
      const requestedAt = new Date().toISOString();
      const deadline = new Date(body.deadlineAt);
      if (Number.isNaN(deadline.getTime())) throw new HttpError(400, 'INVALID_DEADLINE', 'Date limite invalide');
      if (deadline.getTime() < Date.now() - 60_000) {
        throw new HttpError(400, 'DEADLINE_IN_PAST', 'La date limite doit etre dans le futur');
      }
      const lat = body.lat ?? hospital.lat;
      const lng = body.lng ?? hospital.lng;
      if (lat === null || lng === null || lat === undefined || lng === undefined) {
        throw new HttpError(400, 'LOCATION_REQUIRED', "L'etablissement doit renseigner sa localisation");
      }

      const urgencyId = crypto.randomUUID();
      const event = createEvent(
        'urgence.creee',
        {
          urgenceId: urgencyId,
          hospitalId: hospital.id,
          hospitalName: hospital.name,
          bloodGroup: body.bloodGroup,
          bagsNeeded: body.bagsNeeded,
          priority: body.priority,
          deadlineAt: deadline.toISOString(),
          city: body.city ?? hospital.city,
          lat,
          lng,
          createdAt: new Date().toISOString(),
          requestedAt,
        },
        { producer: 'hospital-service', correlationId: urgencyId, id: crypto.randomUUID() },
      );

      const created = await withTransaction(ctx.pool, async (client) => {
        const row = await one<UrgenceRow>(
          client,
          `INSERT INTO urgences(id, hospital_id, blood_group, bags_needed, priority, deadline_at, city, lat, lng,
             notes, contact_phone)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [
            urgencyId, hospital.id, body.bloodGroup, body.bagsNeeded, body.priority, deadline.toISOString(),
            body.city ?? hospital.city, lat, lng, body.notes ?? null, body.contactPhone ?? hospital.phone,
          ],
        );
        await enqueueOutbox(client, [event]);
        return row!;
      });

      await flushOutbox(ctx.pool, ctx.bus, [event.id]);
      ctx.metrics.eventsPublished.inc({ type: event.type });

      const withCounts = await one<UrgenceWithCounts>(ctx.pool, `${URGENCE_SELECT} WHERE u.id = $1`, [urgencyId]);
      emitUrgenceUpdate(hospital.id, { type: 'created', urgence: toUrgenceDto(withCounts!) });
      res.status(201).json({ urgence: toUrgenceDto(withCounts!), requestedAt });
    }),
  );

  router.get(
    '/hospitals/me/urgences/:id',
    ...hospitalAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const hospital = await loadHospital(req.user!.sub);
      const urgence = await one<UrgenceWithCounts>(
        ctx.pool,
        `${URGENCE_SELECT} WHERE u.id = $1 AND u.hospital_id = $2`,
        [req.params.id, hospital.id],
      );
      if (!urgence) throw new HttpError(404, 'URGENCE_NOT_FOUND', 'Urgence introuvable');

      const responses = await many<{
        donor_id: string; status: string; distance_km: number | null; rank: number | null; updated_at: string;
      }>(
        ctx.pool,
        `SELECT donor_id, status, distance_km, rank, updated_at FROM urgency_responses
         WHERE urgency_id = $1 ORDER BY (status = 'CONFIRMED') DESC, distance_km ASC NULLS LAST LIMIT 200`,
        [req.params.id],
      );
      res.json({
        urgence: toUrgenceDto(urgence),
        responses: responses.map((r) => ({
          donorId: r.donor_id,
          status: r.status,
          distanceKm: r.distance_km,
          rank: r.rank,
          updatedAt: r.updated_at,
        })),
      });
    }),
  );

  router.post(
    '/hospitals/me/urgences/:id/close',
    ...hospitalAuth,
    validate(
      z.object({
        donations: z
          .array(z.object({ donorId: z.string().uuid(), bags: z.number().int().min(1).max(10) }))
          .max(50)
          .optional()
          .default([]),
      }),
    ),
    asyncHandler(async (req: AuthedRequest, res) => {
      const hospital = await loadHospital(req.user!.sub);
      const body = req.body as { donations: { donorId: string; bags: number }[] };
      const urgencyId = req.params.id;

      const result = await withTransaction(ctx.pool, async (client) => {
        const urgence = await one<UrgenceRow>(
          client,
          'SELECT * FROM urgences WHERE id = $1 AND hospital_id = $2 FOR UPDATE',
          [urgencyId, hospital.id],
        );
        if (!urgence) throw new HttpError(404, 'URGENCE_NOT_FOUND');
        if (urgence.status === 'CLOSED' || urgence.status === 'CANCELLED') {
          throw new HttpError(409, 'ALREADY_CLOSED', 'Cette urgence est deja cloturee');
        }

        const events = [];
        for (const donation of body.donations) {
          await client.query(
            `INSERT INTO urgency_donations(urgency_id, donor_id, bags) VALUES ($1,$2,$3)`,
            [urgencyId, donation.donorId, donation.bags],
          );
          await client.query(
            `UPDATE urgency_responses SET status = 'CONFIRMED', updated_at = now()
             WHERE urgency_id = $1 AND donor_id = $2`,
            [urgencyId, donation.donorId],
          );
          events.push(
            createEvent(
              'don.effectue',
              {
                urgenceId: urgencyId,
                hospitalId: hospital.id,
                hospitalName: hospital.name,
                donorId: donation.donorId,
                bags: donation.bags,
                recordedAt: new Date().toISOString(),
              },
              { producer: 'hospital-service', correlationId: urgencyId },
            ),
          );
        }

        await client.query(
          `UPDATE urgences SET status = 'CLOSED', closed_at = now() WHERE id = $1`,
          [urgencyId],
        );
        events.push(
          createEvent(
            'urgence.cloturee',
            {
              urgencyId,
              urgenceId: urgencyId,
              hospitalId: hospital.id,
              status: 'CLOSED',
              bloodGroup: urgence.blood_group,
              bagsNeeded: urgence.bags_needed,
              bagsConfirmed: urgence.bags_confirmed,
              priority: urgence.priority,
              closedAt: new Date().toISOString(),
            },
            { producer: 'hospital-service', correlationId: urgencyId },
          ),
        );
        await enqueueOutbox(client, events);
        return { events };
      });

      await flushOutbox(ctx.pool, ctx.bus, result.events.map((e) => e.id));
      ctx.metrics.eventsPublished.inc({ type: 'don.effectue' }, result.events.length);
      const withCounts = await one<UrgenceWithCounts>(ctx.pool, `${URGENCE_SELECT} WHERE u.id = $1`, [urgencyId]);
      emitUrgenceUpdate(hospital.id, { type: 'closed', urgence: toUrgenceDto(withCounts!) });
      res.json({ urgence: toUrgenceDto(withCounts!) });
    }),
  );

  router.post(
    '/hospitals/me/urgences/:id/cancel',
    ...hospitalAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const hospital = await loadHospital(req.user!.sub);
      const urgence = await one<UrgenceRow>(
        ctx.pool,
        'SELECT * FROM urgences WHERE id = $1 AND hospital_id = $2',
        [req.params.id, hospital.id],
      );
      if (!urgence) throw new HttpError(404, 'URGENCE_NOT_FOUND');
      if (urgence.status === 'CLOSED') throw new HttpError(409, 'ALREADY_CLOSED', 'Urgence deja cloturee');
      const cancelled = createEvent(
        'urgence.cloturee',
        {
          urgencyId: urgence.id,
          hospitalId: hospital.id,
          status: 'CANCELLED',
          bloodGroup: urgence.blood_group,
          bagsNeeded: urgence.bags_needed,
          bagsConfirmed: urgence.bags_confirmed,
          priority: urgence.priority,
          closedAt: new Date().toISOString(),
        },
        { producer: 'hospital-service', correlationId: urgence.id },
      );
      await withTransaction(ctx.pool, async (client) => {
        await client.query(
          `UPDATE urgences SET status = 'CANCELLED', closed_at = now() WHERE id = $1`,
          [urgence.id],
        );
        await enqueueOutbox(client, [cancelled]);
      });
      await flushOutbox(ctx.pool, ctx.bus, [cancelled.id]);
      const withCounts = await one<UrgenceWithCounts>(ctx.pool, `${URGENCE_SELECT} WHERE u.id = $1`, [urgence.id]);
      emitUrgenceUpdate(hospital.id, { type: 'cancelled', urgence: toUrgenceDto(withCounts!) });
      res.json({ urgence: toUrgenceDto(withCounts!) });
    }),
  );

  // ------------------------------------------------------------------ statistiques
  router.get(
    '/hospitals/me/stats',
    ...hospitalAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const hospital = await loadHospital(req.user!.sub);
      const [byStatus, byGroup, timing, responses] = await Promise.all([
        many<{ status: string; count: string }>(
          ctx.pool,
          'SELECT status, count(*)::text AS count FROM urgences WHERE hospital_id = $1 GROUP BY status',
          [hospital.id],
        ),
        many<{ blood_group: string; count: string }>(
          ctx.pool,
          'SELECT blood_group, count(*)::text AS count FROM urgences WHERE hospital_id = $1 GROUP BY blood_group',
          [hospital.id],
        ),
        one<{ avg_seconds: string | null }>(
          ctx.pool,
          `SELECT round(avg(extract(epoch FROM (covered_at - created_at))))::text AS avg_seconds
           FROM urgences WHERE hospital_id = $1 AND covered_at IS NOT NULL`,
          [hospital.id],
        ),
        many<{ status: string; count: string }>(
          ctx.pool,
          `SELECT r.status, count(*)::text AS count FROM urgency_responses r
           JOIN urgences u ON u.id = r.urgency_id WHERE u.hospital_id = $1 GROUP BY r.status`,
          [hospital.id],
        ),
      ]);
      res.json({
        byStatus: byStatus.map((r) => ({ status: r.status, count: Number(r.count) })),
        byBloodGroup: byGroup.map((r) => ({ bloodGroup: r.blood_group, count: Number(r.count) })),
        avgCoverSeconds: timing?.avg_seconds ? Number(timing.avg_seconds) : null,
        responses: responses.map((r) => ({ status: r.status, count: Number(r.count) })),
      });
    }),
  );

  // ------------------------------------------------------------------ routes internes
  router.post(
    '/internal/hospitals',
    internal,
    validate(
      z.object({
        id: z.string().uuid(),
        userId: z.string().uuid(),
        name: z.string().min(2),
        contactName: z.string().min(2),
        email: z.string().email(),
        phone: z.string().optional(),
        city: z.string().min(1),
        address: z.string().min(3),
        lat: z.number().optional(),
        lng: z.number().optional(),
      }),
    ),
    asyncHandler(async (req, res) => {
      const body = req.body as {
        id: string;
        userId: string;
        name: string;
        contactName: string;
        email: string;
        phone?: string;
        city: string;
        address: string;
        lat?: number;
        lng?: number;
      };
      const existing = await one<HospitalRow>(ctx.pool, 'SELECT * FROM hospitals WHERE id = $1', [body.id]);
      if (existing) {
        res.status(409).json({ error: { code: 'ALREADY_EXISTS', message: 'Etablissement deja cree' } });
        return;
      }
      await ctx.pool.query(
        `INSERT INTO hospitals(id, user_id, name, contact_name, email, phone, city, address, lat, lng, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'PENDING')`,
        [
          body.id, body.userId, body.name, body.contactName, body.email, body.phone ?? null, body.city,
          body.address, body.lat ?? null, body.lng ?? null,
        ],
      );
      res.status(201).json({ hospital: { id: body.id, status: 'PENDING' } });
    }),
  );

  router.patch(
    '/internal/hospitals/:id/status',
    internal,
    validate(z.object({ status: z.enum(['APPROVED', 'REJECTED', 'PENDING']) })),
    asyncHandler(async (req, res) => {
      const updated = await one<HospitalRow>(
        ctx.pool,
        'UPDATE hospitals SET status = $2, updated_at = now() WHERE id = $1 RETURNING *',
        [req.params.id, (req.body as { status: string }).status],
      );
      if (!updated) throw new HttpError(404, 'HOSPITAL_NOT_FOUND');
      res.json({ hospital: toHospitalDto(updated) });
    }),
  );

  router.delete(
    '/internal/hospitals/:id',
    internal,
    asyncHandler(async (req, res) => {
      await ctx.pool.query(
        `UPDATE hospitals SET deleted_at = now(), name = 'Etablissement supprime', email = concat('deleted+', id, '@invalid.local'),
           phone = NULL, contact_name = 'Compte supprime' WHERE id = $1`,
        [req.params.id],
      );
      res.status(204).end();
    }),
  );

  router.get(
    '/internal/urgences/open',
    internal,
    asyncHandler(async (_req, res) => {
      const rows = await many<UrgenceWithCounts & { hospital_name: string }>(
        ctx.pool,
        `SELECT u.*, h.name AS hospital_name,
           (SELECT count(*) FROM urgency_responses r WHERE r.urgency_id = u.id)::text AS contacted,
           (SELECT count(*) FROM urgency_responses r WHERE r.urgency_id = u.id AND r.status = 'COMING')::text AS coming,
           (SELECT count(*) FROM urgency_responses r WHERE r.urgency_id = u.id AND r.status = 'CONFIRMED')::text AS confirmed,
           (SELECT count(*) FROM urgency_responses r WHERE r.urgency_id = u.id AND r.status = 'DECLINED')::text AS declined
         FROM urgences u JOIN hospitals h ON h.id = u.hospital_id
         WHERE u.status IN ('OPEN','COVERED') AND u.deadline_at > now() - interval '6 hours'
         ORDER BY u.created_at DESC LIMIT 100`,
      );
      res.json({
        urgences: rows.map((row) => ({
          id: row.id,
          hospitalId: row.hospital_id,
          hospitalName: row.hospital_name,
          bloodGroup: row.blood_group,
          bagsNeeded: row.bags_needed,
          bagsConfirmed: row.bags_confirmed,
          priority: row.priority,
          city: row.city,
          lat: row.lat,
          lng: row.lng,
          deadlineAt: row.deadline_at,
          status: row.status,
          createdAt: row.created_at,
        })),
      });
    }),
  );

  router.get(
    '/internal/urgences/:id',
    internal,
    asyncHandler(async (req, res) => {
      const row = await one<UrgenceRow>(ctx.pool, 'SELECT * FROM urgences WHERE id = $1', [req.params.id]);
      if (!row) throw new HttpError(404, 'URGENCE_NOT_FOUND');
      res.json({
        urgence: {
          id: row.id,
          hospitalId: row.hospital_id,
          bloodGroup: row.blood_group,
          bagsNeeded: row.bags_needed,
          bagsConfirmed: row.bags_confirmed,
          status: row.status,
          deadlineAt: row.deadline_at,
        },
      });
    }),
  );

  return router;
}
