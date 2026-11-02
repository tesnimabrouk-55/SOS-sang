import express, { type Request, type Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { createProxyMiddleware, type Options } from 'http-proxy-middleware';
import { createLogger, createMetrics, env, envInt } from '@sos/shared';

const logger = createLogger('gateway');
const metrics = createMetrics('gateway');

const TARGETS = {
  auth: env('AUTH_URL', 'http://localhost:4001'),
  donor: env('DONOR_URL', 'http://localhost:4002'),
  hospital: env('HOSPITAL_URL', 'http://localhost:4003'),
  matching: env('MATCHING_URL', 'http://localhost:4004'),
  notification: env('NOTIFICATION_URL', 'http://localhost:4005'),
  stock: env('STOCK_URL', 'http://localhost:4006'),
  dashboard: env('DASHBOARD_URL', 'http://localhost:4007'),
};

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: false }));

const origins = env('CORS_ORIGINS', 'http://localhost:5173,http://localhost:8080').split(',');
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || origins.includes(origin) || origins.includes('*')) return cb(null, true);
      return cb(new Error('Origine non autorisee'));
    },
    credentials: true,
  }),
);

app.use((req, res, next) => {
  const id = String(req.headers['x-request-id'] ?? '') || crypto.randomUUID();
  req.headers['x-request-id'] = id;
  res.setHeader('x-request-id', id);
  next();
});
app.use(metrics.middleware());

const globalLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Trop de requetes, reessayez dans une minute' } },
});
app.use(globalLimiter);

function proxy(target: string, _pathPrefix?: string, extra: Partial<Options> = {}) {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    xfwd: true,
    proxyTimeout: 15_000,
    timeout: 15_000,
    onProxyReq: (proxyReq, req) => {
      // Ne jamais laisser un client injecter des en-tetes internes.
      proxyReq.removeHeader('x-internal-token');
      proxyReq.removeHeader('x-user-id');
      proxyReq.removeHeader('x-user-role');
      const ip = req.socket.remoteAddress;
      if (ip) proxyReq.setHeader('x-forwarded-for', ip);
    },
    onError: (err, _req, res) => {
      logger.error({ err, target }, 'Erreur de proxy');
      if ('writeHead' in res && !res.headersSent) {
        (res as Response).writeHead(503, { 'content-type': 'application/json' });
        (res as Response).end(
          JSON.stringify({ error: { code: 'UPSTREAM_UNAVAILABLE', message: 'Service indisponible' } }),
        );
      }
    },
    ...extra,
  });
}

app.get('/api/health', async (_req, res) => {
  const entries = Object.entries(TARGETS);
  const results = await Promise.all(
    entries.map(async ([name, url]) => {
      const started = Date.now();
      try {
        const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) });
        return { name, status: response.ok ? 'UP' : 'DOWN', latencyMs: Date.now() - started };
      } catch {
        return { name, status: 'DOWN', latencyMs: Date.now() - started };
      }
    }),
  );
  const allUp = results.every((r) => r.status === 'UP');
  res.status(allUp ? 200 : 503).json({ status: allUp ? 'ok' : 'degraded', services: results });
});

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'gateway' }));
app.get('/metrics', metrics.handler());

// --- Routage. Ordre important: les sous-chemins admin sont plus specifiques.
app.use('/api/dashboard', proxy(TARGETS.dashboard, '/api/dashboard'));
app.use(
  ['/api/admin/overview', '/api/admin/services', '/api/admin/events'],
  proxy(TARGETS.dashboard, '/api/admin'),
);
app.use('/api/matching', proxy(TARGETS.matching, '/api/matching'));
app.use('/api/auth', proxy(TARGETS.auth, '/api/auth'));
app.use(['/api/admin/users', '/api/admin/hospitals', '/api/admin/audit', '/api/admin/stats'], proxy(TARGETS.auth, '/api'));
app.use('/api/admin/notifications', proxy(TARGETS.notification, '/api'));
app.use('/api/donors', proxy(TARGETS.donor, '/api/donors'));
app.use(['/api/hospitals', '/api/urgences'], proxy(TARGETS.hospital, '/api'));
app.use('/api/notifications', proxy(TARGETS.notification, '/api/notifications'));
app.use('/api/stock', proxy(TARGETS.stock, '/api/stock'));

// --- Temps reel: le handshake Socket.IO est proxifie vers hospital-service.
app.use(
  '/socket.io',
  proxy(TARGETS.hospital, '/socket.io', { ws: true }),
);

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route inconnue' } });
});

export interface RunningGateway {
  close(): Promise<void>;
}

export async function start(): Promise<RunningGateway> {
  const port = envInt('API_GATEWAY_PORT', 8080);
  const server = await new Promise<import('node:http').Server>((resolve) => {
    const s = app.listen(port, () => resolve(s));
  });
  logger.info({ port }, 'Gateway demarree');
  // eslint-disable-next-line no-console
  console.log(`[gateway] http://localhost:${port}`);
  return {
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

if (require.main === module) {
  start().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('gateway: demarrage impossible', err);
    process.exit(1);
  });
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));
}
