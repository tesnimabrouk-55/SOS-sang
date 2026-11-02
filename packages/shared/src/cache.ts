import type { Logger } from './logger';

export interface Cache {
  readonly kind: 'memory' | 'redis';
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  incr(key: string, ttlSeconds?: number): Promise<number>;
  health(): Promise<boolean>;
  close(): Promise<void>;
}

/** Cache memoire: dev/tests mono-processus uniquement. */
export class MemoryCache implements Cache {
  readonly kind = 'memory' as const;
  private store = new Map<string, { value: unknown; expiresAt: number | null }>();

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async incr(key: string, ttlSeconds?: number): Promise<number> {
    const current = (await this.get<number>(key)) ?? 0;
    const next = current + 1;
    await this.set(key, next, ttlSeconds);
    return next;
  }

  async health(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {
    this.store.clear();
  }
}

/** Cache Redis (mode cible). */
export class RedisCache implements Cache {
  readonly kind = 'redis' as const;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any;

  constructor(private readonly url: string, private readonly logger: Logger) {}

  async connect(): Promise<void> {
    const { default: Redis } = await import('ioredis');
    this.client = new Redis(this.url, { maxRetriesPerRequest: 2, lazyConnect: false });
    this.client.on('error', (err: Error) => this.logger.error({ err }, 'Erreur Redis'));
    this.client.on('connect', () => this.logger.info('Redis connecte'));
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const payload = JSON.stringify(value);
    if (ttlSeconds) await this.client.set(key, payload, 'EX', ttlSeconds);
    else await this.client.set(key, payload);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async incr(key: string, ttlSeconds?: number): Promise<number> {
    const next = await this.client.incr(key);
    if (next === 1 && ttlSeconds) await this.client.expire(key, ttlSeconds);
    return next;
  }

  async health(): Promise<boolean> {
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.client?.quit().catch(() => undefined);
  }
}

export async function createCache(opts: { redisUrl?: string; logger: Logger }): Promise<Cache> {
  if (opts.redisUrl) {
    const cache = new RedisCache(opts.redisUrl, opts.logger);
    await cache.connect();
    return cache;
  }
  opts.logger.warn('REDIS_URL absent: cache memoire utilise (dev/tests uniquement)');
  return new MemoryCache();
}
