import path from 'node:path';
import { buildService, env, envInt } from '@sos/shared';
import { stockRoutes } from './app';

export interface RunningService {
  close(): Promise<void>;
}

export async function start(): Promise<RunningService> {
  const service = await buildService({
    name: 'stock-service',
    schema: env('STOCK_DB_SCHEMA', 'stock'),
    migrationsDir: path.resolve(__dirname, '..', 'migrations'),
    routes: (ctx) => stockRoutes(ctx),
  });

  const server = await service.listen(envInt('STOCK_PORT', 4006));

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
    console.error('stock-service: demarrage impossible', err);
    process.exit(1);
  });
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));
}
