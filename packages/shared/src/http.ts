import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodSchema } from 'zod';
import { verifyToken } from './auth';
import type { TokenPayload, UserRole } from './roles';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
    readonly details?: unknown,
  ) {
    super(message ?? code);
  }
}

export interface AuthedRequest extends Request {
  user?: TokenPayload;
}

export function asyncHandler<T extends Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req as T, res, next)).catch(next);
  };
}

export function authenticate(getSecret: () => string): RequestHandler {
  return (req: AuthedRequest, _res, next) => {
    const header = req.header('authorization') ?? '';
    const [scheme, token] = header.split(' ');
    if (!token || scheme?.toLowerCase() !== 'bearer') {
      return next(new HttpError(401, 'UNAUTHENTICATED', "Jeton d'authentification manquant"));
    }
    try {
      req.user = verifyToken(token, getSecret());
      return next();
    } catch {
      return next(new HttpError(401, 'INVALID_TOKEN', 'Jeton invalide ou expire'));
    }
  };
}

export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req: AuthedRequest, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'UNAUTHENTICATED'));
    if (!roles.includes(req.user.role)) {
      return next(new HttpError(403, 'FORBIDDEN', "Role insuffisant pour cette action"));
    }
    return next();
  };
}

/**
 * Routes internes (service a service). Elles ne sont jamais exposees par la gateway.
 * Protection par jeton partage + absence de CORS navigateur.
 */
export function internalOnly(getToken: () => string): RequestHandler {
  return (req, _res, next) => {
    const provided = req.header('x-internal-token') ?? '';
    const expected = getToken();
    if (!provided || provided !== expected) {
      return next(new HttpError(403, 'INTERNAL_ONLY', 'Route reservee aux services internes'));
    }
    return next();
  };
}

export function validate(
  schema: ZodSchema,
  source: 'body' | 'query' | 'params' = 'body',
): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(new HttpError(400, 'VALIDATION_ERROR', 'Donnees invalides', result.error.issues));
    }
    // Remplace par la valeur parsee (coercition, stripping des champs inconnus).
    (req as unknown as Record<string, unknown>)[source] = result.data;
    return next();
  };
}

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}

export function errorHandler(serviceName: string): (
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
) => void {
  return (err, req, res, _next) => {
    const requestId = String(req.headers['x-request-id'] ?? '');
    if (err instanceof ZodError) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Donnees invalides', details: err.issues, requestId },
      });
      return;
    }
    if (err instanceof HttpError) {
      res.status(err.status).json({
        error: { code: err.code, message: err.message, details: err.details, requestId },
      });
      return;
    }
    const anyErr = err as { status?: number; code?: string; message?: string };
    if (anyErr?.code === '23505') {
      res.status(409).json({ error: { code: 'CONFLICT', message: 'Ressource en conflit', requestId } });
      return;
    }
    // eslint-disable-next-line no-console
    console.error(`[${serviceName}] erreur non geree:`, anyErr?.message ?? err);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Erreur interne du service', requestId },
    });
  };
}

export function notFound(): RequestHandler {
  return (_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'Route inconnue'));
}

export function requestId(): RequestHandler {
  return (req, res, next) => {
    const id = String(req.headers['x-request-id'] ?? '') || crypto.randomUUID();
    req.headers['x-request-id'] = id;
    res.setHeader('x-request-id', id);
    next();
  };
}
