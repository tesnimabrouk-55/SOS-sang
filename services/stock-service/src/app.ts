import { Router } from 'express';
import { z } from 'zod';
import {
  BLOOD_GROUPS,
  HttpError,
  asyncHandler,
  authenticate,
  internalOnly,
  many,
  one,
  requireRole,
  validate,
  withTransaction,
  type AuthedRequest,
  type ServiceContext,
} from '@sos/shared';
import { env } from '@sos/shared';

type StockRow = {
  hospital_id: string;
  blood_group: string;
  units: number;
  threshold: number;
  updated_at: string;
};

export function stockRoutes(ctx: ServiceContext): Router {
  const router = Router();
  const auth = authenticate(() => ctx.config.jwtSecret);
  const hospitalAuth = [auth, requireRole('HOSPITAL')];
  const internal = internalOnly(() => env('INTERNAL_API_TOKEN', 'dev-internal-token-change-me'));

  async function listStocks(hospitalId: string) {
    const rows = await many<StockRow>(ctx.pool, 'SELECT * FROM stocks WHERE hospital_id = $1', [hospitalId]);
    const byGroup = new Map(rows.map((row) => [row.blood_group, row]));
    return BLOOD_GROUPS.map((group) => {
      const row = byGroup.get(group);
      return {
        bloodGroup: group,
        units: row?.units ?? 0,
        threshold: row?.threshold ?? 3,
        low: (row?.units ?? 0) < (row?.threshold ?? 3),
        updatedAt: row?.updated_at ?? null,
      };
    });
  }

  router.get(
    '/stock/me',
    ...hospitalAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const stocks = await listStocks(req.user!.sub);
      res.json({
        stocks,
        lowCount: stocks.filter((s) => s.low).length,
        totalUnits: stocks.reduce((sum, s) => sum + s.units, 0),
      });
    }),
  );

  router.put(
    '/stock/me/:bloodGroup',
    ...hospitalAuth,
    validate(z.object({ units: z.number().int().min(0).max(9999), threshold: z.number().int().min(0).max(100).optional() })),
    asyncHandler(async (req: AuthedRequest, res) => {
      const bloodGroup = String(req.params.bloodGroup).toUpperCase();
      if (!BLOOD_GROUPS.includes(bloodGroup as never)) {
        throw new HttpError(400, 'INVALID_BLOOD_GROUP', 'Groupe sanguin invalide');
      }
      const { units, threshold } = req.body as { units: number; threshold?: number };
      const hospitalId = req.user!.sub;

      await withTransaction(ctx.pool, async (client) => {
        const existing = await one<StockRow>(
          client,
          'SELECT * FROM stocks WHERE hospital_id = $1 AND blood_group = $2',
          [hospitalId, bloodGroup],
        );
        const delta = units - (existing?.units ?? 0);
        await client.query(
          `INSERT INTO stocks(hospital_id, blood_group, units, threshold, updated_at)
           VALUES ($1,$2,$3,COALESCE($4,3),now())
           ON CONFLICT (hospital_id, blood_group)
           DO UPDATE SET units = $3, threshold = COALESCE($4, stocks.threshold), updated_at = now()`,
          [hospitalId, bloodGroup, units, threshold ?? null],
        );
        if (delta !== 0) {
          await client.query(
            `INSERT INTO stock_movements(hospital_id, blood_group, delta, reason, actor_id)
             VALUES ($1,$2,$3,'MANUAL_SET',$4)`,
            [hospitalId, bloodGroup, delta, req.user!.sub],
          );
        }
      });

      res.json({ stocks: await listStocks(hospitalId) });
    }),
  );

  router.post(
    '/stock/me/:bloodGroup/adjust',
    ...hospitalAuth,
    validate(z.object({ delta: z.number().int().min(-999).max(999), reason: z.string().max(120).optional() })),
    asyncHandler(async (req: AuthedRequest, res) => {
      const bloodGroup = String(req.params.bloodGroup).toUpperCase();
      if (!BLOOD_GROUPS.includes(bloodGroup as never)) {
        throw new HttpError(400, 'INVALID_BLOOD_GROUP', 'Groupe sanguin invalide');
      }
      const { delta, reason } = req.body as { delta: number; reason?: string };
      const hospitalId = req.user!.sub;

      const updated = await withTransaction(ctx.pool, async (client) => {
        const row = await one<StockRow>(
          client,
          `INSERT INTO stocks(hospital_id, blood_group, units, threshold)
           VALUES ($1,$2,GREATEST(0,$3),3)
           ON CONFLICT (hospital_id, blood_group)
           DO UPDATE SET units = GREATEST(0, stocks.units + $3), updated_at = now()
           RETURNING *`,
          [hospitalId, bloodGroup, delta],
        );
        await client.query(
          `INSERT INTO stock_movements(hospital_id, blood_group, delta, reason, actor_id)
           VALUES ($1,$2,$3,$4,$5)`,
          [hospitalId, bloodGroup, delta, reason ?? 'MANUAL', req.user!.sub],
        );
        return row!;
      });

      res.json({ stock: { bloodGroup: updated.blood_group, units: updated.units }, stocks: await listStocks(hospitalId) });
    }),
  );

  router.get(
    '/stock/me/history',
    ...hospitalAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const rows = await many(
        ctx.pool,
        `SELECT id, blood_group, delta, reason, created_at FROM stock_movements
         WHERE hospital_id = $1 ORDER BY created_at DESC LIMIT 100`,
        [req.user!.sub],
      );
      res.json({ movements: rows });
    }),
  );

  router.get(
    '/internal/stocks/:hospitalId',
    internal,
    asyncHandler(async (req, res) => {
      res.json({ stocks: await listStocks(req.params.hospitalId) });
    }),
  );

  return router;
}
