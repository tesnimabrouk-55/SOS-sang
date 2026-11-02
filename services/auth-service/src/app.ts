import { Router } from 'express';
import { z } from 'zod';
import {
  BLOOD_GROUPS,
  HttpError,
  asyncHandler,
  authenticate,
  env,
  envInt,
  evaluateEligibility,
  hashPassword,
  generatePassword,
  internalOnly,
  one,
  passwordIssues,
  requireRole,
  signToken,
  validate,
  verifyPassword,
  withTransaction,
  processOnce,
  type AuthedRequest,
  type ServiceContext,
  type TokenPayload,
} from '@sos/shared';
import { rateLimit } from 'express-rate-limit';

const bloodGroupEnum = z.enum(BLOOD_GROUPS as unknown as [string, ...string[]]);

const donorRegistration = z.object({
  email: z.string().email().max(160),
  password: z.string().min(10).max(128),
  firstName: z.string().min(1).max(60),
  lastName: z.string().min(1).max(60),
  phone: z.string().min(6).max(30),
  city: z.string().min(1).max(80),
  bloodGroup: bloodGroupEnum,
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  weightKg: z.number().min(30).max(250).optional(),
  locationConsent: z.boolean().optional().default(false),
  notificationsConsent: z.boolean().optional().default(true),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  lastDonationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const hospitalRegistration = z.object({
  email: z.string().email().max(160),
  password: z.string().min(10).max(128),
  hospitalName: z.string().min(2).max(120),
  contactName: z.string().min(2).max(120),
  phone: z.string().min(6).max(30),
  city: z.string().min(1).max(80),
  address: z.string().min(3).max(200),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

const loginSchema = z.object({
  email: z.string().email().max(160),
  password: z.string().min(1).max(128),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(10).max(128),
});

type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  role: 'DONOR' | 'HOSPITAL' | 'ADMIN';
  full_name: string;
  phone: string | null;
  status: string;
  must_change_password: boolean;
  created_at: string;
}

export interface AuthDeps {
  ctx: ServiceContext;
  /** Appels internes aux services propriétaires des profils. */
  fetchImpl?: typeof fetch;
}

/** Appel interne avec nouvelles tentatives (idempotent cote destinataire). */
async function internalCall(
  fetchImpl: typeof fetch,
  url: string,
  body: unknown,
  logger: ServiceContext['logger'],
  attempts = 3,
): Promise<void> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-token': env('INTERNAL_API_TOKEN', 'dev-internal-token-change-me'),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok || res.status === 409) return; // 409 = profil deja cree (idempotent)
      lastError = new Error(`HTTP ${res.status} sur ${url}`);
    } catch (err) {
      lastError = err as Error;
    }
    if (attempt < attempts) await new Promise((r) => setTimeout(r, 200 * attempt));
  }
  logger.error({ url, err: lastError }, 'Appel interne en echec apres nouvelles tentatives');
  throw new HttpError(503, 'PROFILE_SERVICE_UNAVAILABLE', 'Service de profil indisponible, reessayez');
}

function publicUser(row: UserRow) {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    fullName: row.full_name,
    phone: row.phone,
    status: row.status,
    mustChangePassword: row.must_change_password,
    createdAt: row.created_at,
  };
}

async function audit(
  ctx: ServiceContext,
  req: AuthedRequest,
  action: string,
  targetType: string | null,
  targetId: string | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await ctx.pool.query(
    `INSERT INTO audit_log(actor_id, actor_role, action, target_type, target_id, metadata, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [req.user?.sub ?? null, req.user?.role ?? null, action, targetType, targetId, metadata, req.ip],
  );
}

export function authRoutes(ctx: ServiceContext, deps: { fetchImpl?: typeof fetch } = {}): Router {
  const router = Router();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const auth = authenticate(() => ctx.config.jwtSecret);

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: envInt('RATE_LIMIT_LOGIN_MAX', 10),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Trop de tentatives, reessayez plus tard' } },
  });

  const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: envInt('RATE_LIMIT_REGISTER_MAX', 20),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Trop de creations de compte, reessayez plus tard' } },
  });

  // ---------------------------------------------------------------- inscription donneur
  router.post(
    '/auth/register/donor',
    registerLimiter,
    validate(donorRegistration),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof donorRegistration>;
      const issues = passwordIssues(body.password);
      if (issues.length) throw new HttpError(400, 'WEAK_PASSWORD', 'Mot de passe trop faible', issues);

      const existing = await one<{ id: string }>(ctx.pool, 'SELECT id FROM users WHERE lower(email) = lower($1)', [
        body.email,
      ]);
      if (existing) throw new HttpError(409, 'EMAIL_TAKEN', 'Cette adresse e-mail est deja utilisee');

      const passwordHash = await hashPassword(body.password);
      const fullName = `${body.firstName} ${body.lastName}`.trim();

      const user = await withTransaction(ctx.pool, async (client) => {
        const inserted = await one<UserRow>(
          client,
          `INSERT INTO users(email, password_hash, role, full_name, phone, status)
           VALUES ($1,$2,'DONOR',$3,$4,'ACTIVE') RETURNING *`,
          [body.email, passwordHash, fullName, body.phone],
        );
        if (!inserted) throw new HttpError(500, 'USER_CREATE_FAILED');
        return inserted;
      });

      try {
        await internalCall(
          fetchImpl,
          `${env('DONOR_SERVICE_URL', 'http://localhost:4002')}/api/internal/donors`,
          {
            id: user.id,
            userId: user.id,
            email: body.email,
            firstName: body.firstName,
            lastName: body.lastName,
            phone: body.phone,
            city: body.city,
            bloodGroup: body.bloodGroup,
            birthDate: body.birthDate,
            weightKg: body.weightKg,
            locationConsent: body.locationConsent,
            notificationsConsent: body.notificationsConsent,
            lat: body.lat,
            lng: body.lng,
            lastDonationDate: body.lastDonationDate,
          },
          ctx.logger,
        );
      } catch (err) {
        // Compensation: pas de compte orphelin sans profil.
        await ctx.pool.query('DELETE FROM users WHERE id = $1', [user.id]);
        throw err;
      }

      await audit(ctx, { ...req, user: { sub: user.id, role: 'DONOR', email: user.email, name: fullName } } as AuthedRequest,
        'DONOR_REGISTERED', 'user', user.id);

      const token = signToken(
        { sub: user.id, role: 'DONOR', email: user.email, name: fullName, ref: user.id },
        ctx.config.jwtSecret,
        env('JWT_EXPIRES_IN', '12h'),
      );
      res.status(201).json({ token, user: publicUser(user) });
    }),
  );

  // ---------------------------------------------------------------- inscription hopital
  router.post(
    '/auth/register/hospital',
    registerLimiter,
    validate(hospitalRegistration),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof hospitalRegistration>;
      const issues = passwordIssues(body.password);
      if (issues.length) throw new HttpError(400, 'WEAK_PASSWORD', 'Mot de passe trop faible', issues);

      const existing = await one<{ id: string }>(ctx.pool, 'SELECT id FROM users WHERE lower(email) = lower($1)', [
        body.email,
      ]);
      if (existing) throw new HttpError(409, 'EMAIL_TAKEN', 'Cette adresse e-mail est deja utilisee');

      const passwordHash = await hashPassword(body.password);
      const user = await one<UserRow>(
        ctx.pool,
        `INSERT INTO users(email, password_hash, role, full_name, phone, status)
         VALUES ($1,$2,'HOSPITAL',$3,$4,'PENDING') RETURNING *`,
        [body.email, passwordHash, body.contactName, body.phone],
      );
      if (!user) throw new HttpError(500, 'USER_CREATE_FAILED');

      try {
        await internalCall(
          fetchImpl,
          `${env('HOSPITAL_SERVICE_URL', 'http://localhost:4003')}/api/internal/hospitals`,
          {
            id: user.id,
            userId: user.id,
            name: body.hospitalName,
            contactName: body.contactName,
            email: body.email,
            phone: body.phone,
            city: body.city,
            address: body.address,
            lat: body.lat,
            lng: body.lng,
          },
          ctx.logger,
        );
      } catch (err) {
        await ctx.pool.query('DELETE FROM users WHERE id = $1', [user.id]);
        throw err;
      }

      await audit(
        ctx,
        { ...req, user: { sub: user.id, role: 'HOSPITAL', email: user.email, name: user.full_name } } as AuthedRequest,
        'HOSPITAL_REGISTERED',
        'user',
        user.id,
        { hospitalName: body.hospitalName },
      );

      const token = signToken(
        { sub: user.id, role: 'HOSPITAL', email: user.email, name: body.contactName, ref: user.id },
        ctx.config.jwtSecret,
        env('JWT_EXPIRES_IN', '12h'),
      );
      res.status(201).json({
        token,
        user: publicUser(user),
        message: "Compte cree. Il doit etre valide par un administrateur avant l'acces complet.",
      });
    }),
  );

  // ---------------------------------------------------------------- connexion
  router.post(
    '/auth/login',
    loginLimiter,
    validate(loginSchema),
    asyncHandler(async (req, res) => {
      const { email, password } = req.body as z.infer<typeof loginSchema>;
      const attemptsKey = `login:fail:${email.toLowerCase()}`;
      const failures = (await ctx.cache.get<number>(attemptsKey)) ?? 0;
      if (failures >= 8) {
        throw new HttpError(429, 'ACCOUNT_LOCKED', 'Trop de tentatives echouees, reessayez dans 15 minutes');
      }

      const user = await one<UserRow>(ctx.pool, 'SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
      const ok = user ? await verifyPassword(password, user.password_hash) : false;

      if (!user || !ok) {
        await ctx.cache.set(attemptsKey, failures + 1, 15 * 60);
        await audit(ctx, { ...req, user: undefined } as AuthedRequest, 'LOGIN_FAILED', 'email', email);
        throw new HttpError(401, 'INVALID_CREDENTIALS', 'Identifiants invalides');
      }

      if (user.status === 'DELETED') throw new HttpError(401, 'ACCOUNT_DELETED', 'Ce compte a ete supprime');
      if (user.status === 'REJECTED') {
        throw new HttpError(403, 'ACCOUNT_REJECTED', "Ce compte a ete refuse par l'administrateur");
      }
      if (user.status === 'PENDING') {
        throw new HttpError(403, 'HOSPITAL_PENDING', "Compte en attente de validation par un administrateur");
      }

      await ctx.cache.del(attemptsKey);
      const token = signToken(
        { sub: user.id, role: user.role, email: user.email, name: user.full_name, ref: user.id },
        ctx.config.jwtSecret,
        env('JWT_EXPIRES_IN', '12h'),
      );
      await audit(
        ctx,
        { ...req, user: { sub: user.id, role: user.role, email: user.email, name: user.full_name } } as AuthedRequest,
        'LOGIN_SUCCESS',
        'user',
        user.id,
      );
      res.json({ token, user: publicUser(user) });
    }),
  );

  // ---------------------------------------------------------------- profil / mot de passe
  router.get(
    '/auth/me',
    auth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const user = await one<UserRow>(ctx.pool, 'SELECT * FROM users WHERE id = $1', [req.user!.sub]);
      if (!user) throw new HttpError(404, 'USER_NOT_FOUND');
      res.json({ user: publicUser(user) });
    }),
  );

  router.post(
    '/auth/logout',
    auth,
    asyncHandler(async (req: AuthedRequest, res) => {
      await audit(ctx, req, 'LOGOUT', 'user', req.user!.sub);
      res.status(204).end();
    }),
  );

  router.post(
    '/auth/password',
    auth,
    validate(changePasswordSchema),
    asyncHandler(async (req: AuthedRequest, res) => {
      const body = req.body as z.infer<typeof changePasswordSchema>;
      if (passwordIssues(body.newPassword).length) {
        throw new HttpError(400, 'WEAK_PASSWORD', 'Mot de passe trop faible', passwordIssues(body.newPassword));
      }
      const user = await one<UserRow>(ctx.pool, 'SELECT * FROM users WHERE id = $1', [req.user!.sub]);
      if (!user) throw new HttpError(404, 'USER_NOT_FOUND');
      if (!(await verifyPassword(body.currentPassword, user.password_hash))) {
        throw new HttpError(401, 'INVALID_CREDENTIALS', 'Mot de passe actuel incorrect');
      }
      await ctx.pool.query(
        'UPDATE users SET password_hash = $2, must_change_password = false, updated_at = now() WHERE id = $1',
        [user.id, await hashPassword(body.newPassword)],
      );
      await audit(ctx, req, 'PASSWORD_CHANGED', 'user', user.id);
      res.status(204).end();
    }),
  );

  // ---------------------------------------------------------------- suppression de compte
  router.delete(
    '/auth/me',
    auth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const user = await one<UserRow>(ctx.pool, 'SELECT * FROM users WHERE id = $1', [req.user!.sub]);
      if (!user) throw new HttpError(404, 'USER_NOT_FOUND');

      // anonymisation: l'e-mail est conserve hache pour eviter la re-creation accidentelle
      await ctx.pool.query(
        `UPDATE users SET status = 'DELETED', deleted_at = now(),
           email = concat('deleted+', id, '@invalid.local'),
           full_name = 'Compte supprime', phone = NULL, password_hash = $2
         WHERE id = $1`,
        [user.id, await hashPassword(generatePassword(32))],
      );

      const targetUrl =
        user.role === 'DONOR'
          ? `${env('DONOR_SERVICE_URL', 'http://localhost:4002')}/api/internal/donors/${user.id}`
          : `${env('HOSPITAL_SERVICE_URL', 'http://localhost:4003')}/api/internal/hospitals/${user.id}`;
      try {
        await fetchImpl(targetUrl, {
          method: 'DELETE',
          headers: { 'x-internal-token': env('INTERNAL_API_TOKEN', 'dev-internal-token-change-me') },
          signal: AbortSignal.timeout(3000),
        });
      } catch (err) {
        ctx.logger.error({ err, userId: user.id }, 'Purge des donnees de profil en echec (a rejouer)');
      }

      await audit(ctx, req, 'ACCOUNT_DELETED', 'user', user.id, { role: user.role });
      res.status(204).end();
    }),
  );

  // ---------------------------------------------------------------- administration
  const admin = [auth, requireRole('ADMIN')];

  // ---------------------------------------------------------------- amorcage interne
  // Permet aux outils de developpement (seed) de creer le premier administrateur
  // SANS acceder directement a la base: le service reste seul ecrivain.
  router.post(
    '/internal/admin/bootstrap',
    internalOnly(() => env('INTERNAL_API_TOKEN', 'dev-internal-token-change-me')),
    validate(z.object({ email: z.string().email(), password: z.string().min(10).max(128) })),
    asyncHandler(async (req, res) => {
      const { email, password } = req.body as { email: string; password: string };
      if (passwordIssues(password).length) {
        throw new HttpError(400, 'WEAK_PASSWORD', 'Mot de passe trop faible', passwordIssues(password));
      }
      const existing = await one<{ count: string }>(
        ctx.pool,
        "SELECT count(*)::text AS count FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE'",
      );
      const already = Number(existing?.count ?? 0);
      const user = await one<UserRow>(
        ctx.pool,
        `INSERT INTO users(email, password_hash, role, full_name, status, must_change_password)
         VALUES ($1,$2,'ADMIN','Administrateur SOS Sang','ACTIVE', false)
         ON CONFLICT (lower(email)) DO UPDATE SET role = 'ADMIN', status = 'ACTIVE', password_hash = $2
         RETURNING *`,
        [email, await hashPassword(password)],
      );
      await ctx.pool.query(
        `INSERT INTO audit_log(actor_role, action, target_type, metadata)
         VALUES ('SYSTEM','ADMIN_BOOTSTRAPPED','user',$1)`,
        [JSON.stringify({ email, source: 'internal', existingAdmins: already })],
      );
      res.status(already > 0 ? 200 : 201).json({ user: publicUser(user!), created: already === 0 });
    }),
  );

  router.get(
    '/admin/users',
    ...admin,
    asyncHandler(async (req, res) => {
      const role = typeof req.query.role === 'string' ? req.query.role : null;
      const status = typeof req.query.status === 'string' ? req.query.status : null;
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      const { rows } = await ctx.pool.query<UserRow>(
        `SELECT * FROM users
         WHERE ($1::text IS NULL OR role = $1)
           AND ($2::text IS NULL OR status = $2)
           AND ($3 = '' OR full_name ILIKE '%' || $3 || '%' OR email ILIKE '%' || $3 || '%')
         ORDER BY created_at DESC LIMIT 200`,
        [role, status, q],
      );
      res.json({
        users: rows.map((row) => ({ ...publicUser(row), lastLogin: null })),
        total: rows.length,
      });
    }),
  );

  router.patch(
    '/admin/users/:id/role',
    ...admin,
    validate(z.object({ role: z.enum(['DONOR', 'HOSPITAL', 'ADMIN']) })),
    asyncHandler(async (req: AuthedRequest, res) => {
      const { id } = req.params;
      const { role } = req.body as { role: 'DONOR' | 'HOSPITAL' | 'ADMIN' };
      if (id === req.user!.sub && role !== 'ADMIN') {
        throw new HttpError(400, 'SELF_DEMOTION', 'Vous ne pouvez pas retirer votre propre role administrateur');
      }
      const updated = await one<UserRow>(
        ctx.pool,
        `UPDATE users SET role = $2, updated_at = now() WHERE id = $1 RETURNING *`,
        [id, role],
      );
      if (!updated) throw new HttpError(404, 'USER_NOT_FOUND');
      await audit(ctx, req, 'ROLE_CHANGED', 'user', id, { role });
      res.json({ user: publicUser(updated) });
    }),
  );

  router.patch(
    '/admin/users/:id/suspend',
    ...admin,
    asyncHandler(async (req: AuthedRequest, res) => {
      const { id } = req.params;
      if (id === req.user!.sub) throw new HttpError(400, 'SELF_SUSPEND', 'Action impossible sur votre compte');
      const updated = await one<UserRow>(
        ctx.pool,
        `UPDATE users SET status = 'REJECTED', rejection_reason = 'Suspendu par administrateur', updated_at = now()
         WHERE id = $1 RETURNING *`,
        [id],
      );
      if (!updated) throw new HttpError(404, 'USER_NOT_FOUND');
      await audit(ctx, req, 'USER_SUSPENDED', 'user', id);
      res.json({ user: publicUser(updated) });
    }),
  );

  const decisionSchema = z.object({ reason: z.string().max(300).optional() });

  router.patch(
    '/admin/hospitals/:id/approve',
    ...admin,
    asyncHandler(async (req: AuthedRequest, res) => {
      const { id } = req.params;
      const updated = await one<UserRow>(
        ctx.pool,
        `UPDATE users SET status = 'ACTIVE', approved_at = now(), approved_by = $2, rejection_reason = NULL,
           updated_at = now() WHERE id = $1 AND role = 'HOSPITAL' RETURNING *`,
        [id, req.user!.sub],
      );
      if (!updated) throw new HttpError(404, 'HOSPITAL_NOT_FOUND');

      // Synchronisation du statut dans le service proprietaire (best effort + relance admin possible).
      await fetchImpl(`${env('HOSPITAL_SERVICE_URL', 'http://localhost:4003')}/api/internal/hospitals/${id}/status`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-internal-token': env('INTERNAL_API_TOKEN', 'dev-internal-token-change-me'),
        },
        body: JSON.stringify({ status: 'APPROVED' }),
        signal: AbortSignal.timeout(3000),
      }).catch((err) => ctx.logger.error({ err, id }, 'Synchronisation statut hopital en echec'));

      await audit(ctx, req, 'HOSPITAL_APPROVED', 'user', id);
      res.json({ user: publicUser(updated) });
    }),
  );

  router.patch(
    '/admin/hospitals/:id/reject',
    ...admin,
    validate(decisionSchema),
    asyncHandler(async (req: AuthedRequest, res) => {
      const { id } = req.params;
      const { reason } = req.body as z.infer<typeof decisionSchema>;
      const updated = await one<UserRow>(
        ctx.pool,
        `UPDATE users SET status = 'REJECTED', rejection_reason = $2, updated_at = now()
         WHERE id = $1 AND role = 'HOSPITAL' RETURNING *`,
        [id, reason ?? 'Refuse par administrateur'],
      );
      if (!updated) throw new HttpError(404, 'HOSPITAL_NOT_FOUND');

      await fetchImpl(`${env('HOSPITAL_SERVICE_URL', 'http://localhost:4003')}/api/internal/hospitals/${id}/status`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-internal-token': env('INTERNAL_API_TOKEN', 'dev-internal-token-change-me'),
        },
        body: JSON.stringify({ status: 'REJECTED' }),
        signal: AbortSignal.timeout(3000),
      }).catch((err) => ctx.logger.error({ err, id }, 'Synchronisation statut hopital en echec'));

      await audit(ctx, req, 'HOSPITAL_REJECTED', 'user', id, { reason });
      res.json({ user: publicUser(updated) });
    }),
  );

  router.get(
    '/admin/audit',
    ...admin,
    asyncHandler(async (req, res) => {
      const limit = Math.min(Number(req.query.limit ?? 100), 500);
      const { rows } = await ctx.pool.query(
        `SELECT id, actor_id, actor_role, action, target_type, target_id, metadata, ip, created_at
         FROM audit_log ORDER BY created_at DESC LIMIT $1`,
        [limit],
      );
      res.json({ entries: rows });
    }),
  );

  router.get(
    '/admin/stats',
    ...admin,
    asyncHandler(async (_req, res) => {
      const { rows } = await ctx.pool.query<{ role: string; status: string; count: string }>(
        'SELECT role, status, count(*)::text AS count FROM users GROUP BY role, status',
      );
      const totals: Record<string, number> = {};
      for (const row of rows) {
        totals[row.role] = (totals[row.role] ?? 0) + Number(row.count);
      }
      res.json({
        users: rows.map((r) => ({ role: r.role, status: r.status, count: Number(r.count) })),
        totals,
        pendingHospitals: rows
          .filter((r) => r.role === 'HOSPITAL' && r.status === 'PENDING')
          .reduce((sum, r) => sum + Number(r.count), 0),
      });
    }),
  );

  return router;
}

/**
 * Initialisation securisee du premier administrateur.
 * Aucun identifiant n'est code en dur: le mot de passe vient d'une variable
 * d'environnement injectee (secret manager) ou du script `npm run create-admin`.
 */
export async function ensureAdmin(ctx: ServiceContext): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim();
  const password = process.env.ADMIN_INITIAL_PASSWORD;
  const { rows } = await ctx.pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE'",
  );
  if (Number(rows[0]?.count ?? 0) > 0) return;

  if (!email || !password) {
    ctx.logger.warn(
      'Aucun administrateur actif. Definissez ADMIN_EMAIL + ADMIN_INITIAL_PASSWORD ou lancez "npm run create-admin".',
    );
    return;
  }
  if (passwordIssues(password).length) {
    ctx.logger.error('ADMIN_INITIAL_PASSWORD trop faible: administrateur non cree');
    return;
  }
  await ctx.pool.query(
    `INSERT INTO users(email, password_hash, role, full_name, status, must_change_password)
     VALUES ($1,$2,'ADMIN','Administrateur SOS Sang','ACTIVE', true)
     ON CONFLICT DO NOTHING`,
    [email, await hashPassword(password)],
  );
  ctx.logger.info({ email }, 'Administrateur initial cree (changement de mot de passe requis)');
  await ctx.pool.query(
    `INSERT INTO audit_log(actor_role, action, target_type, metadata)
     VALUES ('SYSTEM','ADMIN_BOOTSTRAPPED','user','{"source":"env"}')`,
  );
}

export type { TokenPayload };
export { evaluateEligibility, envInt };
