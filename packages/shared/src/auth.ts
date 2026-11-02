import jwt, { type SignOptions } from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import type { TokenPayload } from './roles';

const BCRYPT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signToken(payload: TokenPayload, secret: string, expiresIn = '12h'): string {
  if (!secret || secret.length < 16) {
    throw new Error('JWT_SECRET manquant ou trop court (min 16 caracteres)');
  }
  const options: SignOptions = { expiresIn: expiresIn as SignOptions['expiresIn'], issuer: 'sos-sang' };
  return jwt.sign(payload, secret, options);
}

export function verifyToken(token: string, secret: string): TokenPayload {
  const decoded = jwt.verify(token, secret, { issuer: 'sos-sang' });
  if (typeof decoded === 'string') throw new Error('Token invalide');
  const payload = decoded as jwt.JwtPayload & TokenPayload;
  if (!payload.sub || !payload.role || !payload.email) throw new Error('Token incomplet');
  return {
    sub: payload.sub,
    role: payload.role,
    email: payload.email,
    name: payload.name ?? '',
    ref: payload.ref,
  };
}

/** Politique de mot de passe minimale (validee cote serveur). */
export function passwordIssues(password: string): string[] {
  const issues: string[] = [];
  if (password.length < 10) issues.push('PASSWORD_TOO_SHORT');
  if (!/[a-z]/.test(password)) issues.push('PASSWORD_NO_LOWERCASE');
  if (!/[A-Z]/.test(password)) issues.push('PASSWORD_NO_UPPERCASE');
  if (!/[0-9]/.test(password)) issues.push('PASSWORD_NO_DIGIT');
  return issues;
}

export function generatePassword(length = 24): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#%*-_';
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}
