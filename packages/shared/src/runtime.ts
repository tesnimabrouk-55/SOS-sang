import express, { type Express, type Router } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import type { Pool } from 'pg';
import path from 'node:path';
import type { Server } from 'node:http';
import { createLogger, type Logger } from './logger';
import { createMetrics, type ServiceMetrics } from './metrics';
import { createServicePool } from './db';
import { createBus, type EventBus } from './bus';
import { createCache, type Cache } from './cache';
import { errorHandler, notFound, requestId } from './http';
import { env, envInt, jwtSecret, loadEnv } from './env';

export interface ServiceContext {
  name: string;
  pool: Pool;
  bus: EventBus;
  cache: Cache;
  logger: Logger;
  metrics: ServiceMetrics;
  config: {
    jwtSecret: string;
    eligibility: {
      minIntervalDays: number;
      minAge: number;
      maxAge: number;
      minWeightKg: number;
    };
    publicBaseUrl: string;
  };
}

export interface BuildOptions {
  name: string;
  schema: string;
  /** Chemin absolu des migrations SQL du service. */
  migrationsDir: string;
  routes: (ctx: ServiceContext) => Router;
  /** Consommateurs d'evenements: executes avant l'ouverture du port. */
  consumers?: (ctx: ServiceContext) => Promise<void> | void;
  /** Routes supplementaires hors prefixe /api (ex: /metrics). */
  extra?: (app: Express, ctx: ServiceContext) => void;
  /** true si le service peut demarrer sans AMQP/RabbitMQ (dev). */
  allowMemoryBus?: boolean;
}

export interface BuiltService {
  ctx: ServiceContext;
  app: Express;
  listen(port: number): Promise<Server>;
  close(): Promise<void>;
}

function resolveMigrations(dir: string): string {
  return path.isAbsolute(dir) ? dir : path.resolve(process.cwd(), dir);
}

export async function buildService(options: BuildOptions): Promise<BuiltService> {
  loadEnv();
  const logger = createLogger(options.name);
  const metrics = createMetrics(options.name);

  const connectionString = env('DATABASE_URL', 'postgres://postgres:postgres@localhost:5432/postgres');
  const pool = await createServicePool({
    connectionString,
    schema: options.schema,
    migrationsDir: resolveMigrations(options.migrationsDir),
    logger,
  });

  const bus = await createBus({
    amqpUrl: env('AMQP_URL', ''),
    logger,
    service: options.name,
    allowMemory: options.allowMemoryBus !== false,
  });
  const cache = await createCache({ redisUrl: env('REDIS_URL', ''), logger });

  const ctx: ServiceContext = {
    name: options.name,
    pool,
    bus,
    cache,
    logger,
    metrics,
    config: {
      jwtSecret: jwtSecret(),
      eligibility: {
        minIntervalDays: envInt('ELIGIBILITY_MIN_INTERVAL_DAYS', 90),
        minAge: envInt('ELIGIBILITY_MIN_AGE', 18),
        maxAge: envInt('ELIGIBILITY_MAX_AGE', 65),
        minWeightKg: envInt('ELIGIBILITY_MIN_WEIGHT_KG', 50),
      },
      publicBaseUrl: env('PUBLIC_BASE_URL', 'http://localhost:5173'),
    },
  };

  const app = express();
  app.disable('x-powered-by');
  // Derriere la gateway Node (un seul saut). Un 'true' aveugle permettrait de contourner
  // la limitation de debit basee sur l'IP via un en-tete X-Forwarded-For falsifie.
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: false }));
  const allowedOrigins = env('CORS_ORIGINS', 'http://localhost:5173,http://localhost:8080').split(',');
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) return cb(null, true);
        return cb(new Error('Origine non autorisee'));
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '256kb' }));
  app.use(requestId());
  app.use(metrics.middleware());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: options.name, uptime: process.uptime() });
  });
  app.get('/ready', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      const busOk = await bus.health();
      if (!busOk) throw new Error('bus indisponible');
      res.json({ status: 'ready', service: options.name });
    } catch (err) {
      res.status(503).json({ status: 'not-ready', service: options.name, error: (err as Error).message });
    }
  });
  app.get('/metrics', metrics.handler());

  if (options.consumers) {
    await options.consumers(ctx);
  }

  app.use('/api', options.routes(ctx));
  options.extra?.(app, ctx);
  app.use(notFound());
  app.use(errorHandler(options.name));

  let server: Server | undefined;
  return {
    ctx,
    app,
    async listen(port: number) {
      server = await new Promise<Server>((resolve) => {
        const s = app.listen(port, () => resolve(s));
      });
      logger.info({ port, service: options.name }, 'Service demarre');
      return server;
    },
    async close() {
      await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
      await bus.close();
      await cache.close();
      await pool.end();
    },
  };
}

export { env, envInt };
