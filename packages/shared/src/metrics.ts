import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

export interface ServiceMetrics {
  registry: Registry;
  httpDuration: Histogram<'method' | 'route' | 'status'>;
  httpTotal: Counter<'method' | 'route' | 'status'>;
  eventsPublished: Counter<'type'>;
  eventsConsumed: Counter<'type' | 'result'>;
  matchingDuration: Histogram<'result'>;
  notificationLatency: Histogram<'channel'>;
  middleware(): RequestHandler;
  handler(): RequestHandler;
}

export function createMetrics(service: string): ServiceMetrics {
  const registry = new Registry();
  registry.setDefaultLabels({ service });
  collectDefaultMetrics({ register: registry, prefix: 'sos_' });

  const httpDuration = new Histogram({
    name: 'sos_http_request_duration_seconds',
    help: 'Duree des requetes HTTP en secondes',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  });

  const httpTotal = new Counter({
    name: 'sos_http_requests_total',
    help: 'Nombre total de requetes HTTP',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [registry],
  });

  const eventsPublished = new Counter({
    name: 'sos_events_published_total',
    help: 'Evenements metier publies',
    labelNames: ['type'] as const,
    registers: [registry],
  });

  const eventsConsumed = new Counter({
    name: 'sos_events_consumed_total',
    help: 'Evenements metier consommes',
    labelNames: ['type', 'result'] as const,
    registers: [registry],
  });

  const matchingDuration = new Histogram({
    name: 'sos_matching_duration_seconds',
    help: 'Duree du calcul de matching',
    labelNames: ['result'] as const,
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    registers: [registry],
  });

  const notificationLatency = new Histogram({
    name: 'sos_notification_latency_seconds',
    help: "Delai entre la creation de l'urgence et l'envoi de la notification",
    labelNames: ['channel'] as const,
    buckets: [0.5, 1, 2, 3, 5, 8, 10, 20],
    registers: [registry],
  });

  return {
    registry,
    httpDuration,
    httpTotal,
    eventsPublished,
    eventsConsumed,
    matchingDuration,
    notificationLatency,
    middleware(): RequestHandler {
      return (req: Request, res: Response, next: NextFunction) => {
        const start = process.hrtime.bigint();
        res.on('finish', () => {
          const route = `${req.baseUrl || ''}${req.route?.path ?? req.path}` || 'unknown';
          const labels = { method: req.method, route, status: String(res.statusCode) };
          const seconds = Number(process.hrtime.bigint() - start) / 1e9;
          httpDuration.observe(labels, seconds);
          httpTotal.inc(labels);
        });
        next();
      };
    },
    handler(): RequestHandler {
      return async (_req, res) => {
        res.setHeader('content-type', registry.contentType);
        res.end(await registry.metrics());
      };
    },
  };
}
