import path from 'node:path';
import { buildService, env, envInt, jwtSecret, startOutboxRelay } from '@sos/shared';
import { hospitalRoutes } from './app';
import { registerHospitalConsumers } from './consumers';
import { attachRealtime, closeRealtime } from './realtime';

export interface RunningService {
  close(): Promise<void>;
}

export async function start(): Promise<RunningService> {
  const service = await buildService({
    name: 'hospital-service',
    schema: env('HOSPITAL_DB_SCHEMA', 'hospital'),
    migrationsDir: path.resolve(__dirname, '..', 'migrations'),
    routes: (ctx) => hospitalRoutes(ctx),
    consumers: (ctx) => registerHospitalConsumers(ctx),
  });

  const stopRelay = startOutboxRelay(service.ctx.pool, service.ctx.bus, service.ctx.logger);
  const server = await service.listen(envInt('HOSPITAL_PORT', 4003));
  attachRealtime(server, jwtSecret());

  return {
    async close() {
      stopRelay();
      await closeRealtime();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await service.close();
    },
  };
}

if (require.main === module) {
  start().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('hospital-service: demarrage impossible', err);
    process.exit(1);
  });
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));
}
