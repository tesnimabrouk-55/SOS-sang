import type { BloodGroup } from './blood';

export type UserRole = 'DONOR' | 'HOSPITAL' | 'ADMIN';

export interface TokenPayload {
  sub: string;
  role: UserRole;
  email: string;
  name: string;
  /** Identifiant metier: donorId pour un donneur, hospitalId pour un hopital. */
  ref?: string;
}

export const ROLES: readonly UserRole[] = ['DONOR', 'HOSPITAL', 'ADMIN'] as const;

export function isRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
