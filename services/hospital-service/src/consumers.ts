import {
  createEvent,
  enqueueOutbox,
  flushOutbox,
  many,
  one,
  processOnce,
  withTransaction,
  type DomainEvent,
  type DonneursSelectionnesPayload,
  type ReponseRecuePayload,
  type ServiceContext,
} from '@sos/shared';
import type { UrgenceRow, UrgenceWithCounts } from './app';
import { emitResponse, emitUrgenceUpdate } from './realtime';
import { toUrgenceDto } from './app';

interface ApplyResult {
  confirmed: boolean;
  covered: boolean;
  urgence: UrgenceRow | null;
}

/**
 * Reponse d'un donneur + confirmation atomique.
 *
 * Le verrou FOR UPDATE sur la ligne d'urgence serialise les confirmations:
 * deux donneurs ne peuvent pas obtenir la meme place, meme en concurrence.
 */
export async function applyDonorResponse(
  ctx: ServiceContext,
  payload: ReponseRecuePayload,
): Promise<ApplyResult> {
  let event: DomainEvent | null = null;

  const result = await withTransaction(ctx.pool, async (client) => {
    const urgence = await one<UrgenceRow>(
      client,
      'SELECT * FROM urgences WHERE id = $1 FOR UPDATE',
      [payload.urgenceId],
    );
    if (!urgence) return { confirmed: false, covered: false, urgence: null };

    // Une reponse tardive ne peut pas ecraser un statut CONFIRMED.
    await client.query(
      `INSERT INTO urgency_responses(urgency_id, donor_id, status)
       VALUES ($1,$2,$3)
       ON CONFLICT (urgency_id, donor_id) DO UPDATE
         SET status = EXCLUDED.status, updated_at = now()
         WHERE urgency_responses.status IN ('CONTACTED','COMING')`,
      [payload.urgenceId, payload.donorId, payload.answer === 'COMING' ? 'COMING' : 'DECLINED'],
    );

    let confirmed = false;
    const targetStatus = urgence.status;

    if (payload.answer === 'COMING' && targetStatus === 'OPEN' && urgence.bags_confirmed < urgence.bags_needed) {
      const reservation = await client.query(
        `UPDATE urgency_responses SET status = 'CONFIRMED', updated_at = now()
         WHERE urgency_id = $1 AND donor_id = $2 AND status = 'COMING'
         RETURNING id`,
        [payload.urgenceId, payload.donorId],
      );

      if (reservation.rowCount === 1) {
        confirmed = true;
        const updated = await client.query(
          `UPDATE urgences SET bags_confirmed = bags_confirmed + 1
           WHERE id = $1 RETURNING *`,
          [payload.urgenceId],
        );
        const fresh = updated.rows[0] as UrgenceRow;

        if (fresh.bags_confirmed >= fresh.bags_needed) {
          const covered = await client.query(
            `UPDATE urgences SET status = 'COVERED', covered_at = now()
             WHERE id = $1 AND status = 'OPEN' RETURNING id`,
            [payload.urgenceId],
          );
          if (covered.rowCount === 1) {
            const confirmedDonors = await many<{ donor_id: string }>(
              client,
              `SELECT donor_id FROM urgency_responses WHERE urgency_id = $1 AND status = 'CONFIRMED'`,
              [payload.urgenceId],
            );
            const others = await many<{ donor_id: string }>(
              client,
              `SELECT donor_id FROM urgency_responses
               WHERE urgency_id = $1 AND status IN ('CONTACTED','COMING') AND donor_id <> $2`,
              [payload.urgenceId, payload.donorId],
            );
            event = createEvent(
              'besoin.couvert',
              {
                urgenceId: payload.urgenceId,
                hospitalId: payload.hospitalId,
                bagsNeeded: fresh.bags_needed,
                confirmedCount: fresh.bags_confirmed,
                confirmedDonorIds: confirmedDonors.map((d) => d.donor_id),
                notSelectedDonorIds: others.map((d) => d.donor_id),
                coveredAt: new Date().toISOString(),
              },
              { producer: 'hospital-service', correlationId: payload.urgenceId },
            );
            await enqueueOutbox(client, [event]);
          }
        }
      }
    }

    const refreshed = await one<UrgenceRow>(client, 'SELECT * FROM urgences WHERE id = $1', [payload.urgenceId]);
    return {
      confirmed,
      covered: refreshed?.status === 'COVERED',
      urgence: refreshed,
    };
  });

  if (event) {
    await flushOutbox(ctx.pool, ctx.bus, [(event as DomainEvent).id]);
    ctx.metrics.eventsPublished.inc({ type: 'besoin.couvert' });
  }

  if (result.urgence) {
    const counts = await one<UrgenceWithCounts>(
      ctx.pool,
      `SELECT u.*,
         (SELECT count(*) FROM urgency_responses r WHERE r.urgency_id = u.id)::text AS contacted,
         (SELECT count(*) FROM urgency_responses r WHERE r.urgency_id = u.id AND r.status = 'COMING')::text AS coming,
         (SELECT count(*) FROM urgency_responses r WHERE r.urgency_id = u.id AND r.status = 'CONFIRMED')::text AS confirmed,
         (SELECT count(*) FROM urgency_responses r WHERE r.urgency_id = u.id AND r.status = 'DECLINED')::text AS declined
       FROM urgences u WHERE u.id = $1`,
      [result.urgence.id],
    );
    emitResponse(result.urgence.hospital_id, {
      type: 'donor_response',
      urgenceId: result.urgence.id,
      donorId: payload.donorId,
      answer: payload.answer,
      confirmed: result.confirmed,
      urgence: counts ? toUrgenceDto(counts) : null,
    });
  }

  return result;
}

export async function registerHospitalConsumers(ctx: ServiceContext): Promise<void> {
  // --- 1. Donneurs selectionnes par le matching: on cree les lignes de suivi.
  await ctx.bus.subscribe(
    'donneurs.selectionnes',
    async (event: DomainEvent) => {
      await processOnce(ctx.pool, event, async () => {
        const payload = event.payload as DonneursSelectionnesPayload;
        await withTransaction(ctx.pool, async (client) => {
          for (const donor of payload.selected) {
            await client.query(
              `INSERT INTO urgency_responses(urgency_id, donor_id, status, distance_km, rank)
               VALUES ($1,$2,'CONTACTED',$3,$4)
               ON CONFLICT (urgency_id, donor_id) DO NOTHING`,
              [payload.urgenceId, donor.donorId, donor.distanceKm, donor.rank],
            );
          }
          await client.query('UPDATE urgences SET radius_km = $2 WHERE id = $1', [
            payload.urgenceId,
            payload.radiusKm,
          ]);
        });

        const urgence = await one<UrgenceRow>(ctx.pool, 'SELECT * FROM urgences WHERE id = $1', [payload.urgenceId]);
        if (urgence) {
          emitUrgenceUpdate(urgence.hospital_id, {
            type: 'alerts_sent',
            urgenceId: urgence.id,
            contacted: payload.selected.length,
            radiusKm: payload.radiusKm,
          });
        }
        ctx.metrics.eventsConsumed.inc({ type: event.type, result: 'ok' });
      });
    },
    { queue: 'q.hospital-service.donneurs-selectionnes' },
  );

  // --- 2. Reponse d'un donneur: confirmation atomique.
  await ctx.bus.subscribe(
    'reponse.recue',
    async (event: DomainEvent) => {
      await processOnce(ctx.pool, event, async () => {
        await applyDonorResponse(ctx, event.payload as ReponseRecuePayload);
        ctx.metrics.eventsConsumed.inc({ type: event.type, result: 'ok' });
      });
    },
    { queue: 'q.hospital-service.reponse-recue' },
  );

  // --- 3. Besoin couvert: etat final coherent (rejeu idempotent).
  await ctx.bus.subscribe(
    'besoin.couvert',
    async (event: DomainEvent) => {
      await processOnce(ctx.pool, event, async () => {
        const payload = event.payload as { urgenceId: string };
        await ctx.pool.query(
          `UPDATE urgences SET status = 'COVERED', covered_at = COALESCE(covered_at, now())
           WHERE id = $1 AND status = 'OPEN'`,
          [payload.urgenceId],
        );
        ctx.metrics.eventsConsumed.inc({ type: event.type, result: 'ok' });
      });
    },
    { queue: 'q.hospital-service.besoin-couvert' },
  );
}
