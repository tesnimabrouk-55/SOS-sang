import pino, { type Logger } from 'pino';

export function createLogger(service: string): Logger {
  return pino({
    name: service,
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'warn'),
    base: { service },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: ['req.headers.authorization', 'password', 'passwordHash', '*.password', '*.token'],
      censor: '[redacted]',
    },
  });
}

export type { Logger };
