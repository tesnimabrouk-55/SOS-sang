import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Logger } from './logger';

export interface DbOptions {
  connectionString: string;
  schema: string;
  migrationsDir: string;
  logger?: Logger;
  max?: number;
}

/**
 * Verrou par base: certains moteurs embarques (PGlite) exposent plusieurs
 * connexions TCP sur UNE SEULE session PostgreSQL. Le `search_path` y est donc
 * global: il faut serialiser "SET search_path + requete" pour garantir que
 * chaque service reste dans son schema. En PostgreSQL classique
 * (SINGLE_SESSION_DB absent), ce verrou n'est pas utilise.
 */
// Stockage sur globalThis: si le module est charge deux fois (bundler, tsx,
// double resolution ESM/CJS), le verrou reste unique pour le processus.
const globalState = globalThis as unknown as { __sosSessionQueues?: Map<string, Promise<unknown>> };
const sessionQueues = (globalState.__sosSessionQueues ??= new Map<string, Promise<unknown>>());

function withSessionLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = sessionQueues.get(key) ?? Promise.resolve();
  const run = previous.then(task, task) as Promise<T>;
  sessionQueues.set(
    key,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

interface SessionInfo {
  key: string;
  schema: string;
  singleSession: boolean;
}

function sessionOf(pool: Pool): SessionInfo | undefined {
  return (pool as unknown as { __session?: SessionInfo }).__session;
}

/**
 * Chaque microservice possede son propre schema (ou sa propre base) PostgreSQL:
 * il est seul proprietaire de ses tables. Aucun service ne lit le schema d'un
 * autre: la communication passe par l'API ou par les evenements.
 */
export async function createServicePool(options: DbOptions): Promise<Pool> {
  const { connectionString, schema, migrationsDir, logger, max = 10 } = options;

  if (!/^[a-z][a-z0-9_]{1,30}$/.test(schema)) {
    throw new Error(`Nom de schema invalide: ${schema}`);
  }

  const bootstrap = new Pool({ connectionString, max: 1 });
  try {
    await bootstrap.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  } finally {
    await bootstrap.end();
  }

  const pool = new Pool({
    connectionString,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: `sos-${schema}`,
  });

  const singleSession = process.env.SINGLE_SESSION_DB === 'true';
  const session: SessionInfo = { key: connectionString, schema, singleSession };
  (pool as unknown as { __session?: SessionInfo }).__session = session;
  const setPath = `SET search_path TO "${schema}", public`;

  // PostgreSQL classique: chaque connexion recoit son search_path.
  // En mode session unique, le search_path est pose juste avant chaque requete
  // (voir plus bas): inutile et risque de double execution au connect.
  if (!singleSession) {
    pool.on('connect', (client) => {
      client.query(setPath).catch((err) => logger?.error({ err, schema }, 'Impossible de definir le search_path'));
    });
  }
  pool.on('error', (err) => logger?.error({ err }, 'Erreur inattendue du pool PostgreSQL'));

  if (singleSession) {
    // Session unique partagee: verrou + search_path avant CHAQUE requete.
    const originalQuery = pool.query.bind(pool) as (...args: unknown[]) => Promise<unknown>;
    (pool as unknown as { query: unknown }).query = (text: unknown, values?: unknown) =>
      withSessionLock(connectionString, async () => {
        await originalQuery(setPath);
        if (typeof text === 'string') return originalQuery(text, values);
        return originalQuery(text);
      });
  }

  await migrate(pool, schema, migrationsDir, logger);
  return pool;
}

export async function migrate(
  pool: Pool,
  schema: string,
  migrationsDir: string,
  logger?: Logger,
): Promise<void> {
  const session = sessionOf(pool);
  const body = async (): Promise<void> => {
    const client = await pool.connect();
    try {
      // Une seule connexion pour toute la migration: etat coherent.
      await client.query(`SET search_path TO "${schema}", public`);

      // Garde-fou: une migration doit s'executer dans le schema du service.
      const current = await client.query<{ s: string }>('SELECT current_schema() AS s');
      if (current.rows[0] && current.rows[0].s !== schema) {
        throw new Error(
          `Schema actif inattendu (${current.rows[0].s}) pour les migrations du service "${schema}". ` +
            'Verifiez DATABASE_URL / SINGLE_SESSION_DB.',
        );
      }

      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          name TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);

      let files: string[] = [];
      try {
        files = (await fs.readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
      } catch {
        logger?.warn({ migrationsDir }, 'Aucun dossier de migrations trouve');
        return;
      }

      const appliedRes = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
      const applied = new Set(appliedRes.rows.map((r) => r.name));

      for (const file of files) {
        if (applied.has(file)) continue;
        const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
        try {
          await client.query('BEGIN');
          await client.query(sql);
          // Idempotent: certains moteurs/proxies peuvent rejouer une instruction.
          await client.query('INSERT INTO schema_migrations(name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [file]);
          await client.query('COMMIT');
          logger?.info({ file, schema }, 'Migration appliquee');
        } catch (err) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw new Error(`Echec de la migration ${file} (schema ${schema}): ${(err as Error).message}`);
        }
      }
    } finally {
      client.release();
    }
  };

  return session?.singleSession ? withSessionLock(session.key, body) : body();
}

export async function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const session = sessionOf(pool);
  const run = async (): Promise<T> => {
    const client = await pool.connect();
    try {
      // Le verrou (mode session unique) couvre toute la transaction: aucune
      // autre requete ne peut changer le search_path entre deux instructions.
      await client.query(`SET search_path TO "${session?.schema ?? 'public'}", public`);
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  };
  return session?.singleSession ? withSessionLock(session.key, run) : run();
}

export async function one<T extends QueryResultRow>(
  pool: Pool | PoolClient,
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const res = await pool.query<T>(sql, params);
  return res.rows[0] ?? null;
}

export async function many<T extends QueryResultRow>(
  pool: Pool | PoolClient,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await pool.query<T>(sql, params);
  return res.rows;
}

/** Table d'idempotence cote consommateur (une par schema de service). */
export const IDEMPOTENCY_DDL = `
  CREATE TABLE IF NOT EXISTS processed_events (
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`;

/**
 * Execute un handler une seule fois par event.id.
 * L'insertion est faite AVANT le traitement: deux consommateurs concurrents ne
 * peuvent pas traiter le meme message. En cas d'erreur, la ligne est supprimee
 * pour permettre la nouvelle livraison.
 */
export async function processOnce(
  pool: Pool,
  event: { id: string; type: string },
  handler: () => Promise<void>,
): Promise<boolean> {
  const inserted = await pool.query(
    'INSERT INTO processed_events(event_id, event_type) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING event_id',
    [event.id, event.type],
  );
  if (inserted.rowCount === 0) return false;
  try {
    await handler();
    return true;
  } catch (err) {
    await pool.query('DELETE FROM processed_events WHERE event_id = $1', [event.id]).catch(() => undefined);
    throw err;
  }
}

/** Outbox: persiste l'evenement dans la transaction metier puis le publie. */
export const OUTBOX_DDL = `
  CREATE TABLE IF NOT EXISTS outbox (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ,
    attempts INT NOT NULL DEFAULT 0,
    last_error TEXT
  );
  CREATE INDEX IF NOT EXISTS outbox_unpublished_idx ON outbox(created_at) WHERE published_at IS NULL;
`;
