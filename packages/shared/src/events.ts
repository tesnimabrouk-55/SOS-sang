import type { BloodGroup } from './blood';

/**
 * Contrat d'evenements asynchrones (RabbitMQ en cible, bus memoire en dev).
 * Chaque message porte un identifiant unique et sert a l'idempotence des consommateurs.
 */
export const EVENT_TYPES = [
  'urgence.creee',
  'donneurs.selectionnes',
  'reponse.recue',
  'besoin.couvert',
  'don.effectue',
  'urgence.cloturee',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export interface DomainEvent<T = unknown> {
  /** Identifiant unique du message (idempotence). */
  id: string;
  type: EventType;
  version: number;
  occurredAt: string;
  /** Identifiant de correlation: urgenceId pour le flux principal. */
  correlationId: string;
  producer: string;
  payload: T;
}

export interface UrgenceCreeePayload {
  urgenceId: string;
  hospitalId: string;
  hospitalName: string;
  bloodGroup: BloodGroup;
  bagsNeeded: number;
  priority: 'CRITICAL' | 'HIGH' | 'NORMAL';
  deadlineAt: string;
  city: string;
  lat: number;
  lng: number;
  createdAt: string;
  /** Horodatage de la requete HTTP d'origine: sert a mesurer le delai de notification. */
  requestedAt: string;
}

export interface SelectedDonor {
  donorId: string;
  userId: string;
  bloodGroup: BloodGroup;
  distanceKm: number;
  reliabilityScore: number;
  lastDonationDate: string | null;
  rank: number;
}

export interface DonneursSelectionnesPayload {
  urgenceId: string;
  hospitalId: string;
  hospitalName: string;
  bloodGroup: BloodGroup;
  bagsNeeded: number;
  priority: UrgenceCreeePayload['priority'];
  city: string;
  lat: number;
  lng: number;
  radiusKm: number;
  selected: SelectedDonor[];
  excluded: { total: number; byReason: Record<string, number> };
  requestedAt: string;
  createdAt: string;
}

export interface ReponseRecuePayload {
  urgenceId: string;
  donorId: string;
  hospitalId: string;
  answer: 'COMING' | 'CANNOT';
  respondedAt: string;
}

export interface BesoinCouvertPayload {
  urgenceId: string;
  hospitalId: string;
  bagsNeeded: number;
  confirmedCount: number;
  confirmedDonorIds: string[];
  notSelectedDonorIds?: string[];
  coveredAt: string;
}

export interface DonEffectuePayload {
  urgenceId: string;
  hospitalId: string;
  donorId: string;
  bags: number;
  recordedAt: string;
}

export function createEvent<T>(
  type: EventType,
  payload: T,
  opts: { producer: string; correlationId: string; id?: string; occurredAt?: string },
): DomainEvent<T> {
  return {
    id: opts.id ?? randomId(),
    type,
    version: 1,
    occurredAt: opts.occurredAt ?? new Date().toISOString(),
    correlationId: opts.correlationId,
    producer: opts.producer,
    payload,
  };
}

export function randomId(): string {
  // RFC4122 v4 sans dependance externe.
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isDomainEvent(value: unknown): value is DomainEvent {
  if (!value || typeof value !== 'object') return false;
  const evt = value as Record<string, unknown>;
  return typeof evt.id === 'string' && typeof evt.type === 'string' && typeof evt.payload === 'object';
}
