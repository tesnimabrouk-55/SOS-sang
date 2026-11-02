import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Test de bout en bout contre la pile reellement demarree (`npm run dev`).
 * Lancement : SOS_E2E=1 npm test
 * Sans la variable, tout le bloc est ignore : aucune assertion inventee.
 */
const BASE = process.env.SOS_API_URL ?? 'http://localhost:8080';
const RUN = process.env.SOS_E2E === '1';
const PASSWORD = 'Demo!Passw0rd';

interface Session {
  email: string;
  token: string;
  id: string;
}

async function login(email: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login ${email} -> ${res.status}`);
  const data = (await res.json()) as { token: string };
  return data.token;
}

async function call<T>(path: string, token: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}

async function waitFor<T>(fn: () => Promise<T | null>, timeoutMs = 10_000, stepMs = 250): Promise<T | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return null;
}

describe.skipIf(!RUN)('parcours complet SOS Sang (API reelle)', () => {
  let hospitalToken = '';
  let adminToken = '';
  let urgenceId = '';
  let responders: Session[] = [];

  beforeAll(async () => {
    hospitalToken = await login('hopital.central@sos-sang.local');
    adminToken = await login('admin@sos-sang.local');

    // Selection dynamique : un don enregistre rend un donneur ineligible pendant
    // le delai configure, donc le test ne peut pas dependre d'un compte fixe.
    for (let i = 1; i <= 10; i += 1) {
      const email = `donneur${i}@sos-sang.local`;
      let token = '';
      try {
        token = await login(email);
      } catch {
        continue;
      }
      const me = await call<{ donor: { id: string; isAvailable: boolean; eligibility: { eligible: boolean } } }>(
        '/api/donors/me',
        token,
      );
      if (me.status === 200 && me.body.donor.isAvailable && me.body.donor.eligibility.eligible) {
        responders.push({ email, token, id: me.body.donor.id });
      }
    }
    expect(responders.length).toBeGreaterThanOrEqual(4);
    responders = responders.slice(0, 4);
  }, 60_000);

  it('refuse les acces non authentifies et les mauvais roles', async () => {
    const anon = await fetch(`${BASE}/api/donors/me`);
    expect(anon.status).toBe(401);

    expect((await call('/api/admin/users', responders[0].token)).status).toBe(403);
    expect((await call('/api/hospitals/me', responders[0].token)).status).toBe(403);
    expect((await call('/api/dashboard/admin/overview', hospitalToken)).status).toBe(403);
    expect((await call('/api/admin/users', adminToken)).status).toBe(200);
  });

  it('declare une urgence et notifie les donneurs en moins de 10 secondes', async () => {
    const startedAt = Date.now();
    const created = await call<{ urgence: { id: string } }>('/api/hospitals/me/urgences', hospitalToken, {
      method: 'POST',
      body: JSON.stringify({
        // AB+ accepte tous les donneurs : le scenario reste valable quel que soit
        // l'historique de dons des comptes de demonstration.
        bloodGroup: 'AB+',
        bagsNeeded: 2,
        priority: 'CRITICAL',
        deadlineAt: new Date(Date.now() + 4 * 3600_000).toISOString(),
        notes: 'Test automatise de bout en bout.',
      }),
    });
    expect(created.status).toBe(201);
    urgenceId = created.body.urgence.id;

    const notified = await waitFor(async () => {
      const res = await call<{ notifications: Array<{ urgencyId: string; channel: string }> }>(
        '/api/notifications/me',
        responders[0].token,
      );
      return res.body.notifications.find((n) => n.urgencyId === urgenceId) ?? null;
    }, 10_000);

    const elapsed = Date.now() - startedAt;
    // eslint-disable-next-line no-console
    console.log(`[mesure] declaration -> notification : ${elapsed} ms`);
    expect(notified).not.toBeNull();
    expect(elapsed).toBeLessThan(10_000);
  });

  it('confirme exactement le nombre de poches, sans doublon', async () => {
    const answers = await Promise.all(
      responders.map(({ token }) =>
        call<{ ok: boolean }>('/api/donors/me/responses', token, {
          method: 'POST',
          body: JSON.stringify({ urgenceId, answer: 'COMING' }),
        }),
      ),
    );
    for (const answer of answers) expect([200, 201]).toContain(answer.status);

    const detail = await waitFor(async () => {
      const res = await call<{
        urgence: { status: string; bagsConfirmed: number; bagsNeeded: number };
        responses: Array<{ status: string }>;
      }>(`/api/hospitals/me/urgences/${urgenceId}`, hospitalToken);
      return res.body.urgence.bagsConfirmed >= 2 ? res.body : null;
    }, 12_000);

    expect(detail).not.toBeNull();
    expect(detail!.urgence.bagsConfirmed).toBe(2);
    expect(detail!.urgence.bagsNeeded).toBe(2);
    expect(detail!.urgence.status).toBe('COVERED');
    expect(detail!.responses.filter((r) => r.status === 'CONFIRMED')).toHaveLength(2);
  });

  it('informe les autres donneurs que le besoin est couvert', async () => {
    const notified = await waitFor(async () => {
      const res = await call<{ notifications: Array<{ urgencyId: string; type: string; status: string }> }>(
        '/api/admin/notifications?limit=200',
        adminToken,
      );
      const rows = (res.body.notifications ?? []).filter(
        (n) => n.urgencyId === urgenceId && n.type === 'NEED_COVERED',
      );
      return rows.length > 0 ? rows : null;
    }, 10_000);

    expect(notified).not.toBeNull();
    expect(notified!.every((n) => n.status === 'SENT')).toBe(true);
  });

  it('cloture l urgence et enregistre les dons effectues', async () => {
    const detail = await call<{ responses: Array<{ donorId: string; status: string }> }>(
      `/api/hospitals/me/urgences/${urgenceId}`,
      hospitalToken,
    );
    const confirmed = detail.body.responses.filter((r) => r.status === 'CONFIRMED');
    expect(confirmed.length).toBeGreaterThan(0);

    const closed = await call<{ urgence: { status: string } }>(
      `/api/hospitals/me/urgences/${urgenceId}/close`,
      hospitalToken,
      { method: 'POST', body: JSON.stringify({ donations: confirmed.map((r) => ({ donorId: r.donorId, bags: 1 })) }) },
    );
    expect([200, 201]).toContain(closed.status);

    const after = await call<{ urgence: { status: string } }>(`/api/hospitals/me/urgences/${urgenceId}`, hospitalToken);
    expect(after.body.urgence.status).toBe('CLOSED');

    const confirmedIds = new Set(confirmed.map((r) => r.donorId));
    const donor = responders.find((r) => confirmedIds.has(r.id));
    expect(donor).toBeDefined();

    const history = await waitFor(async () => {
      const res = await call<{ donations: unknown[] }>('/api/donors/me/history', donor!.token);
      return res.body.donations.length > 0 ? res.body : null;
    }, 8_000);
    expect(history).not.toBeNull();
  });

  it('gere les stocks par groupe et journalise les mouvements', async () => {
    const before = await call<{ stocks: Array<{ bloodGroup: string; units: number }> }>('/api/stock/me', hospitalToken);
    const target = before.body.stocks.find((s) => s.bloodGroup === 'AB-');
    expect(target).toBeDefined();

    const put = await call('/api/stock/me/AB-', hospitalToken, {
      method: 'PUT',
      body: JSON.stringify({ units: 5, threshold: 2 }),
    });
    expect([200, 201]).toContain(put.status);

    const adjust = await call('/api/stock/me/AB-/adjust', hospitalToken, {
      method: 'POST',
      body: JSON.stringify({ delta: 2, reason: 'test automatise' }),
    });
    expect([200, 201]).toContain(adjust.status);

    const after = await call<{ stocks: Array<{ bloodGroup: string; units: number }> }>('/api/stock/me', hospitalToken);
    expect(after.body.stocks.find((s) => s.bloodGroup === 'AB-')?.units).toBe(7);

    // Restauration pour ne pas polluer la demonstration.
    await call('/api/stock/me/AB-', hospitalToken, {
      method: 'PUT',
      body: JSON.stringify({ units: target!.units }),
    });
  });

  it('expose un etat de sante coherent des services', async () => {
    const res = await call<{ allUp: boolean; services: Array<{ name: string; status: string }> }>(
      '/api/dashboard/admin/services',
      adminToken,
    );
    expect(res.status).toBe(200);
    expect(res.body.services.length).toBeGreaterThanOrEqual(7);
    expect(res.body.allUp).toBe(true);
  });
});
