import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { verifyToken, type TokenPayload } from '@sos/shared';

/**
 * Diffusion temps reel vers les tableaux de bord hospitaliers.
 * Un hopital ne recoit que les evenements de son propre "room".
 */
let io: Server | null = null;

export function attachRealtime(httpServer: HttpServer, jwtSecret: string): Server {
  io = new Server(httpServer, {
    path: '/socket.io',
    cors: { origin: true, credentials: true },
  });

  io.use((socket, next) => {
    try {
      const token =
        (socket.handshake.auth?.token as string | undefined) ??
        (socket.handshake.headers.authorization ?? '').toString().replace(/^Bearer\s+/i, '');
      if (!token) return next(new Error('UNAUTHENTICATED'));
      const payload: TokenPayload = verifyToken(token, jwtSecret);
      if (payload.role !== 'HOSPITAL' && payload.role !== 'ADMIN') return next(new Error('FORBIDDEN'));
      socket.data.user = payload;
      return next();
    } catch {
      return next(new Error('INVALID_TOKEN'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as TokenPayload;
    if (user.role === 'HOSPITAL' && user.ref) socket.join(`hospital:${user.ref}`);
    if (user.role === 'ADMIN') socket.join('admins');
  });

  return io;
}

export function emitUrgenceUpdate(hospitalId: string, payload: Record<string, unknown>): void {
  io?.to(`hospital:${hospitalId}`).emit('urgence:update', payload);
  io?.to('admins').emit('urgence:update', payload);
}

export function emitResponse(hospitalId: string, payload: Record<string, unknown>): void {
  io?.to(`hospital:${hospitalId}`).emit('urgence:response', payload);
  io?.to('admins').emit('urgence:response', payload);
}

export async function closeRealtime(): Promise<void> {
  await io?.close();
  io = null;
}

export function realtimeReady(): boolean {
  return io !== null;
}
