import { config as loadDotenv } from 'dotenv';

let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  loadDotenv({ path: process.env.ENV_FILE || '.env' });
  loaded = true;
}

export function env(key: string, fallback?: string): string {
  loadEnv();
  const value = process.env[key];
  if (value === undefined || value === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Variable d'environnement manquante: ${key}`);
  }
  return value;
}

export function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function envList(key: string, fallback: string[] = []): string[] {
  const raw = process.env[key];
  if (!raw) return fallback;
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

/** Secret JWT: jamais de valeur par defaut en production. */
export function jwtSecret(): string {
  loadEnv();
  const secret = process.env.JWT_SECRET ?? '';
  if (secret.length < 16) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET doit etre defini (>= 16 caracteres) en production');
    }
    return 'dev-only-insecure-secret-change-me';
  }
  return secret;
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}
