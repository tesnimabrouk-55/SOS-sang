import type { Channel, ConsumeMessage } from 'amqplib';
import type { Pool } from 'pg';
import type { DomainEvent, EventType } from './events';
import type { Logger } from './logger';

export type EventHandler = (event: DomainEvent) => Promise<void>;

export interface SubscribeOptions {
  /** Nom de file durable. En RabbitMQ: q.<service>.<event>. */
  queue: string;
  /** Nombre de tentatives avant mise en file morte (DLQ). */
  maxAttempts?: number;
}

export interface EventBus {
  readonly kind: 'memory' | 'rabbitmq';
  publish(event: DomainEvent): Promise<void>;
  subscribe(topic: EventType | '*', handler: EventHandler, options: SubscribeOptions): Promise<void>;
  health(): Promise<boolean>;
  close(): Promise<void>;
  /** Attend la fin des traitements en cours (bus memoire, tests). */
  drain?(): Promise<void>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const EVENTS_EXCHANGE = 'sos.events';
export const RETRY_EXCHANGE = 'sos.retry';
export const DLX_EXCHANGE = 'sos.dlx';

/**
 * Bus memoire: utiliser UNIQUEMENT en developpement et dans les tests
 * mono-processus. Aucune durabilite, aucune distribution.
 */
export class MemoryBus implements EventBus {
  readonly kind = 'memory' as const;
  private handlers = new Map<string, { handler: EventHandler; maxAttempts: number }[]>();
  readonly published: DomainEvent[] = [];
  readonly failures: { event: DomainEvent; error: string }[] = [];

  async publish(event: DomainEvent): Promise<void> {
    this.published.push(event);
    const targets = [...(this.handlers.get(event.type) ?? []), ...(this.handlers.get('*') ?? [])];
    // Traitement sequentiel et attendu: comportement deterministe pour les tests.
    for (const target of targets) {
      let attempt = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        try {
          await target.handler(event);
          break;
        } catch (err) {
          attempt += 1;
          if (attempt >= target.maxAttempts) {
            this.failures.push({ event, error: (err as Error).message });
            break;
          }
          await sleep(20 * attempt);
        }
      }
    }
  }

  async subscribe(topic: EventType | '*', handler: EventHandler, options: SubscribeOptions): Promise<void> {
    const list = this.handlers.get(topic) ?? [];
    list.push({ handler, maxAttempts: options.maxAttempts ?? 5 });
    this.handlers.set(topic, list);
  }

  async health(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {
    this.handlers.clear();
  }

  async drain(): Promise<void> {
    await sleep(0);
  }
}

/**
 * Bus RabbitMQ: exchange topic durable, files durables par consommateur,
 * accuse de reception manuelle, re-livraison avec delai puis DLQ.
 */
/** Sous-ensemble de l'API amqplib reellement utilise (typé localement). */
interface AmqpConnection {
  createChannel(): Promise<Channel>;
  close(): Promise<void>;
  on(event: string, listener: (arg: Error) => void): void;
}

export class RabbitBus implements EventBus {
  readonly kind = 'rabbitmq' as const;
  private connection?: AmqpConnection;
  private channel?: Channel;
  private consuming: { queue: string; tag: string }[] = [];

  constructor(private readonly url: string, private readonly logger: Logger) {}

  async connect(): Promise<void> {
    const amqp = await import('amqplib');
    const connection = (await amqp.connect(this.url)) as unknown as AmqpConnection;
    this.connection = connection;
    connection.on('error', (err: Error) => this.logger.error({ err }, 'Erreur connexion RabbitMQ'));
    connection.on('close', () => this.logger.warn('Connexion RabbitMQ fermee'));

    const channel = await connection.createChannel();
    this.channel = channel;
    await channel.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true });
    await channel.assertExchange(RETRY_EXCHANGE, 'direct', { durable: true });
    await channel.assertExchange(DLX_EXCHANGE, 'fanout', { durable: true });
    const dlq = await channel.assertQueue('sos.dlq', { durable: true });
    await channel.bindQueue(dlq.queue, DLX_EXCHANGE, '');
    this.logger.info({ exchange: EVENTS_EXCHANGE }, 'Bus RabbitMQ pret');
  }

  private ensureChannel(): Channel {
    if (!this.channel) throw new Error('Bus RabbitMQ non connecte');
    return this.channel;
  }

  async publish(event: DomainEvent): Promise<void> {
    const channel = this.ensureChannel();
    const options = {
      persistent: true,
      messageId: event.id,
      contentType: 'application/json',
      timestamp: Date.now(),
      type: event.type,
      appId: event.producer,
      headers: { 'x-attempt': 0, correlationId: event.correlationId },
    };
    const ok = channel.publish(EVENTS_EXCHANGE, event.type, Buffer.from(JSON.stringify(event)), options);
    if (!ok) {
      await new Promise<void>((resolve) => channel.once('drain', () => resolve()));
    }
  }

  async subscribe(topic: EventType | '*', handler: EventHandler, options: SubscribeOptions): Promise<void> {
    const channel = this.ensureChannel();
    const routingKey = topic === '*' ? '#' : topic;
    const maxAttempts = options.maxAttempts ?? 5;

    // File principale: en cas de nack -> exchange de retry (delai) -> retour.
    await channel.assertQueue(`${options.queue}.retry`, {
      durable: true,
      arguments: {
        'x-message-ttl': 5_000,
        'x-dead-letter-exchange': EVENTS_EXCHANGE,
        'x-dead-letter-routing-key': routingKey === '#' ? '' : routingKey,
      },
    });
    await channel.bindQueue(`${options.queue}.retry`, RETRY_EXCHANGE, `${options.queue}.retry`);

    const main = await channel.assertQueue(options.queue, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': RETRY_EXCHANGE,
        'x-dead-letter-routing-key': `${options.queue}.retry`,
      },
    });
    await channel.bindQueue(main.queue, EVENTS_EXCHANGE, routingKey);
    await channel.prefetch(10);

    const { consumerTag } = await channel.consume(main.queue, async (message: ConsumeMessage | null) => {
      if (!message) return;
      let event: DomainEvent;
      try {
        event = JSON.parse(message.content.toString('utf8')) as DomainEvent;
      } catch {
        this.logger.error('Message illisible recu, direction DLQ');
        channel.publish(DLX_EXCHANGE, '', message.content, { persistent: true });
        channel.ack(message);
        return;
      }

      const attempt = Number(message.properties.headers?.['x-attempt'] ?? 0);
      try {
        await handler(event);
        channel.ack(message);
      } catch (err) {
        const error = (err as Error).message;
        this.logger.error({ err, event: event.type, eventId: event.id, attempt }, 'Echec traitement evenement');
        if (attempt + 1 >= maxAttempts) {
          channel.publish(
            DLX_EXCHANGE,
            '',
            Buffer.from(JSON.stringify({ event, error, attempts: attempt + 1 })),
            { persistent: true },
          );
          channel.ack(message);
        } else {
          // Re-publication avec compteur de tentatives puis ack (pas de boucle chaude).
          channel.publish(EVENTS_EXCHANGE, event.type, Buffer.from(JSON.stringify(event)), {
            persistent: true,
            messageId: event.id,
            contentType: 'application/json',
            headers: { 'x-attempt': attempt + 1, correlationId: event.correlationId },
          });
          channel.ack(message);
        }
      }
    });

    this.consuming.push({ queue: main.queue, tag: consumerTag });
    this.logger.info({ queue: main.queue, topic }, 'Consommateur enregistre');
  }

  async health(): Promise<boolean> {
    try {
      return Boolean(this.channel && this.connection);
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    try {
      const channel = this.channel;
      if (channel) {
        for (const c of this.consuming) await channel.cancel(c.tag).catch(() => undefined);
        await channel.close();
      }
      await this.connection?.close();
    } catch (err) {
      this.logger.warn({ err }, 'Fermeture RabbitMQ partielle');
    }
  }
}

const globalBus = globalThis as unknown as { __sosSharedBus?: MemoryBus };

/**
 * Bus memoire partage par tous les services d'un MEME processus.
 * Utilise uniquement par le mode "embedded" (dev sans Docker) et les tests:
 * il n'y a aucune distribution ni durabilite, contrairement a RabbitMQ.
 */
export function sharedMemoryBus(): MemoryBus {
  globalBus.__sosSharedBus ??= new MemoryBus();
  return globalBus.__sosSharedBus;
}

export async function createBus(opts: {
  amqpUrl?: string;
  logger: Logger;
  service: string;
  allowMemory?: boolean;
}): Promise<EventBus> {
  const { amqpUrl, logger } = opts;
  if (amqpUrl) {
    const bus = new RabbitBus(amqpUrl, logger);
    await bus.connect();
    return bus;
  }
  if (opts.allowMemory === false) {
    throw new Error('AMQP_URL est obligatoire dans cet environnement');
  }
  logger.warn(
    { service: opts.service },
    'AMQP_URL absent: bus memoire utilise (dev/tests uniquement, pas de distribution inter-processus)',
  );
  if (process.env.SHARED_MEMORY_BUS === 'true') return sharedMemoryBus();
  return new MemoryBus();
}

/**
 * Persiste un evenement dans la transaction metier (outbox pattern).
 * A appeler avec le client de la transaction en cours.
 */
export async function enqueueOutbox(
  client: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  events: DomainEvent[],
): Promise<void> {
  for (const event of events) {
    await client.query(
      `INSERT INTO outbox(id, type, payload) VALUES ($1,$2,$3)
       ON CONFLICT (id) DO NOTHING`,
      [event.id, event.type, JSON.stringify(event)],
    );
  }
}

/**
 * Publie immediatement les evenements qui viennent d'etre commites.
 * En cas d'echec, le relay outbox les reprendra: aucun evenement metier n'est perdu.
 */
export async function flushOutbox(pool: Pool, bus: EventBus, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { rows } = await pool.query<{ id: string; payload: DomainEvent }>(
    'SELECT id, payload FROM outbox WHERE id = ANY($1::text[]) AND published_at IS NULL',
    [ids],
  );
  for (const row of rows) {
    try {
      await bus.publish(row.payload);
      await pool.query('UPDATE outbox SET published_at = now(), attempts = attempts + 1 WHERE id = $1', [row.id]);
    } catch {
      // Le relay reprendra: on ne bloque pas la requete utilisateur.
    }
  }
}

/**
 * Relay outbox: publie les evenements persistes non encore emis.
 * Garantit qu'un evenement metier commite n'est pas perdu si le broker est indisponible.
 */
export function startOutboxRelay(pool: Pool, bus: EventBus, logger: Logger, intervalMs = 500): () => void {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const { rows } = await pool.query<{ id: string; payload: DomainEvent }>(
        `SELECT id, payload FROM outbox WHERE published_at IS NULL ORDER BY created_at LIMIT 50`,
      );
      for (const row of rows) {
        try {
          await bus.publish(row.payload);
          await pool.query('UPDATE outbox SET published_at = now(), attempts = attempts + 1 WHERE id = $1', [row.id]);
        } catch (err) {
          await pool.query(
            'UPDATE outbox SET attempts = attempts + 1, last_error = $2 WHERE id = $1',
            [row.id, (err as Error).message],
          );
          logger.error({ err, eventId: row.id }, 'Publication outbox en echec');
          break;
        }
      }
    } catch (err) {
      logger.error({ err }, 'Relay outbox en erreur');
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
