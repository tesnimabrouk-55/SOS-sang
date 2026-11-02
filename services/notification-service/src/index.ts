import path from 'node:path';
import { buildService, env, envInt, startOutboxRelay } from '@sos/shared';
import { notificationRoutes, registerNotificationConsumers } from './app';

export interface RunningService {
  close(): Promise<void>;
}

export async function start(): Promise<RunningService> {
  const service = await buildService({
    name: 'notification-service',
    schema: env('NOTIFICATION_DB_SCHEMA', 'notification'),
    migrationsDir: path.resolve(__dirname, '..', 'migrations'),
    routes: (ctx) => notificationRoutes(ctx),
    consumers: (ctx) => registerNotificationConsumers(ctx),
  });

  const stopRelay = startOutboxRelay(service.ctx.pool, service.ctx.bus, service.ctx.logger);
  const server = await service.listen(envInt('NOTIFICATION_PORT', 4005));

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
    console.error('notification-service: demarrage impossible', err);
    process.exit(1);
  });
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));
}
