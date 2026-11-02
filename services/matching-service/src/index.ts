import path from 'node:path';
import { buildService, env, envInt, startOutboxRelay } from '@sos/shared';
import { matchingRoutes, registerMatchingConsumers } from './app';

export interface RunningService {
  close(): Promise<void>;
}

export async function start(): Promise<RunningService> {
  const service = await buildService({
    name: 'matching-service',
    schema: env('MATCHING_DB_SCHEMA', 'matching'),
    migrationsDir: path.resolve(__dirname, '..', 'migrations'),
    routes: (ctx) => matchingRoutes(ctx),
    consumers: (ctx) => registerMatchingConsumers(ctx),
  });

  const stopRelay = startOutboxRelay(service.ctx.pool, service.ctx.bus, service.ctx.logger);
  const server = await service.listen(envInt('MATCHING_PORT', 4004));

  return {
    async close() {
      stopRelay();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await service.close();
    },
  };
}

if (require.main === module) {
  start().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('matching-service: demarrage impossible', err);
    process.exit(1);
  });
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));
}
