import path from 'node:path';
import { buildService, env, envInt } from '@sos/shared';
import { authRoutes, ensureAdmin } from './app';

export interface RunningService {
  close(): Promise<void>;
}

export async function start(): Promise<RunningService> {
  const service = await buildService({
    name: 'auth-service',
    schema: env('AUTH_DB_SCHEMA', 'auth'),
    migrationsDir: path.resolve(__dirname, '..', 'migrations'),
    routes: (ctx) => authRoutes(ctx),
  });

  // Initialisation du premier administrateur (aucun secret dans le depot).
  await ensureAdmin(service.ctx);

  const server = await service.listen(envInt('AUTH_PORT', 4001));

  return {
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await service.close();
    },
  };
}

if (require.main === module) {
  start().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('auth-service: demarrage impossible', err);
    process.exit(1);
  });
  const shutdown = () => process.exit(0);
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
