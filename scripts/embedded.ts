/**
 * Mode "embedded": execute toute la plateforme SANS Docker.
 *
 * - PostgreSQL: PGlite (PostgreSQL 17 compile en WebAssembly) expose sur TCP via
 *   le protocole Postgres natif. Les services se connectent avec le client `pg`
 *   standard: le code SQL est identique a la cible Docker.
 * - Redis / RabbitMQ: NON disponibles dans ce mode. Un cache memoire et un bus
 *   memoire partage (meme processus Node) les remplacent. C'est un mode de
 *   developpement/test uniquement: aucune durabilite, aucune distribution.
 * - Les 7 microservices restent des applications HTTP distinctes (ports 4001-4007),
 *   et la gateway les atteint via HTTP.
 *
 * Pour l'architecture cible (PostgreSQL + Redis + RabbitMQ reels), utiliser
 * `docker compose up` (voir README).
 */
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';

// Les services sont compiles en CommonJS: on les charge via require (tsx transpile le TS).
const requireService = createRequire(import.meta.url);

const PG_PORT = Number(process.env.EMBEDDED_PG_PORT ?? 5433);
const DATA_DIR = process.env.EMBEDDED_PG_DIR ?? path.resolve(process.cwd(), '.pglite');

async function main(): Promise<void> {
  process.env.NODE_ENV = process.env.NODE_ENV ?? 'development';
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'dev-embedded-secret-change-me-please';
  process.env.DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${PG_PORT}/postgres`;
  // Pas de broker ni de cache reseau dans ce mode (voir avertissement ci-dessus).
  process.env.AMQP_URL = '';
  process.env.REDIS_URL = '';
  process.env.SHARED_MEMORY_BUS = 'true';
// Profil de developpement uniquement : le seed cree une dizaine de comptes et les
// tests se connectent plusieurs fois. En production/Docker, les valeurs par defaut
// du service d'authentification (10 connexions / 20 inscriptions par fenetre) restent appliquees.
process.env.RATE_LIMIT_LOGIN_MAX = process.env.RATE_LIMIT_LOGIN_MAX ?? '120';
process.env.RATE_LIMIT_REGISTER_MAX = process.env.RATE_LIMIT_REGISTER_MAX ?? '120';
  // PGlite: une seule session PG derriere plusieurs connexions TCP.
  process.env.SINGLE_SESSION_DB = 'true';
  process.env.CORS_ORIGINS = process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:8080';
  process.env.AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL ?? 'http://localhost:4001';
  process.env.DONOR_SERVICE_URL = process.env.DONOR_SERVICE_URL ?? 'http://localhost:4002';
  process.env.HOSPITAL_SERVICE_URL = process.env.HOSPITAL_SERVICE_URL ?? 'http://localhost:4003';
  process.env.MATCHING_SERVICE_URL = process.env.MATCHING_SERVICE_URL ?? 'http://localhost:4004';
  process.env.NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL ?? 'http://localhost:4005';
  process.env.STOCK_SERVICE_URL = process.env.STOCK_SERVICE_URL ?? 'http://localhost:4006';
  process.env.DASHBOARD_SERVICE_URL = process.env.DASHBOARD_SERVICE_URL ?? 'http://localhost:4007';

  if (process.env.EMBEDDED_RESET === 'true') {
    await fs.rm(DATA_DIR, { recursive: true, force: true });
    // eslint-disable-next-line no-console
    console.log(`[embedded] base reinitialisee (${DATA_DIR})`);
  }

  const db = await PGlite.create({ dataDir: DATA_DIR });
  const server = new PGLiteSocketServer({ db, port: PG_PORT, host: '127.0.0.1', maxConnections: 40 });
  await server.start();
  // eslint-disable-next-line no-console
  console.log(`[embedded] PostgreSQL (PGlite/WASM) sur 127.0.0.1:${PG_PORT} — data: ${DATA_DIR} `);

  // Demarrage sequentiel: auth d'abord (les autres services n'en dependent pas au boot).
  // Demarrage SEQUENTIEL: une seule initialisation de schema a la fois.
  const modules = [
    '../services/auth-service/src/index.ts',
    '../services/donor-service/src/index.ts',
    '../services/hospital-service/src/index.ts',
    '../services/matching-service/src/index.ts',
    '../services/notification-service/src/index.ts',
    '../services/stock-service/src/index.ts',
    '../services/dashboard-service/src/index.ts',
    '../gateway/src/index.ts',
  ] as const;
  for (const mod of modules) {
    const loaded = requireService(mod) as { start: () => Promise<unknown> };
    await loaded.start();
  }

  // eslint-disable-next-line no-console
  console.log(
    [
      '',
      '  SOS Sang — pile locale demarree',
      '  API gateway : http://localhost:8080',
      '  Frontend    : npm run dev:web  (http://localhost:5173)',
      '  Donnees demo: npm run seed',
      '  Arret       : Ctrl+C',
      '',
    ].join('\n'),
  );

  const shutdown = async () => {
    await server.stop().catch(() => undefined);
    await db.close().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[embedded] demarrage impossible:', err);
  process.exit(1);
});
