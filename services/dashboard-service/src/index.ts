import path from 'node:path';
import { buildService, env, envInt } from '@sos/shared';
import { dashboardRoutes, registerDashboardConsumers } from './app';

export interface RunningService {
  close(): Promise<void>;
}

export async function start(): Promise<RunningService> {
  const service = await buildService({
    name: 'dashboard-service',
    schema: env('DASHBOARD_DB_SCHEMA', 'dashboard'),
    migrationsDir: path.resolve(__dirname, '..', 'migrations'),
    routes: (ctx) => dashboardRoutes(ctx),
    consumers: (ctx) => registerDashboardConsumers(ctx),
  });

  const server = await service.listen(envInt('DASHBOARD_PORT', 4007));

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
    console.error('dashboard-service: demarrage impossible', err);
    process.exit(1);
  });
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));
}
