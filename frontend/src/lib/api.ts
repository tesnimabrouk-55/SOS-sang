/**
 * Client HTTP unique de l'application.
 * - Toutes les requetes passent par l'API gateway (/api en dev via le proxy Vite, Nginx en Docker).
 * - Le jeton JWT est conserve dans le stockage local et envoye en en-tete Authorization.
 * - Toute reponse 401 declenche la deconnexion locale (evenement consomme par AuthProvider).
 */
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';
const TOKEN_KEY = 'sos.token';

export type Role = 'DONOR' | 'HOSPITAL' | 'ADMIN';

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  fullName: string;
  phone: string | null;
  status: 'ACTIVE' | 'PENDING' | 'REJECTED' | 'DELETED' | 'INCOMPLETE';
  mustChangePassword: boolean;
  createdAt: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const tokenStore = {
  get: (): string | null => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export const UNAUTHENTICATED_EVENT = 'sos:unauthenticated';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Service injoignable. Verifiez votre connexion puis reessayez.');
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: any = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const err = payload?.error ?? {};
    if (response.status === 401 && token) {
      tokenStore.clear();
      window.dispatchEvent(new Event(UNAUTHENTICATED_EVENT));
    }
    throw new ApiError(
      response.status,
      err.code ?? `HTTP_${response.status}`,
      err.message ?? 'Une erreur est survenue. Merci de reessayer.',
      err.details,
    );
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
};

/* ------------------------------------------------------------------ types partages */

export interface DonorProfile {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  city: string;
  bloodGroup: string;
  location: { lat: number; lng: number } | null;
  locationConsent: boolean;
  notificationsConsent: boolean;
  isAvailable: boolean;
  birthDate: string | null;
  weightKg: number | null;
  lastDonationDate: string | null;
  totalDonations: number;
  alertsReceived: number;
  alertsAnswered: number;
  alertsComing: number;
  createdAt: string;
  eligibility: Eligibility;
}

export interface Eligibility {
  eligible: boolean;
  blockers: string[];
  warnings: string[];
  nextEligibleOn: string | null;
  daysUntilEligible: number | null;
  ruleVersion: string;
  computedAt: string;
  disclaimerFr: string;
}

export interface EligibilityRule {
  minIntervalDays: number;
  minAge: number;
  maxAge: number;
  minWeightKg: number;
  version: string;
  requireMedicalData: boolean;
}

export interface DonorNotification {
  id: string;
  urgencyId: string;
  type: 'URGENT_NEED' | 'NEED_COVERED' | 'THANK_YOU';
  channel: 'EMAIL' | 'SMS' | 'WEB';
  status: 'PENDING' | 'SENT' | 'FAILED' | 'READ';
  title: string;
  body: string;
  payload: Record<string, any>;
  attempts: number;
  error: string | null;
  latencyMs: number | null;
  createdAt: string;
  sentAt: string | null;
  readAt: string | null;
}

export interface CompatibleUrgence {
  id: string;
  hospitalId: string;
  hospitalName: string;
  bloodGroup: string;
  bagsNeeded: number;
  bagsConfirmed: number;
  priority: 'CRITICAL' | 'HIGH' | 'NORMAL';
  city: string;
  lat: number;
  lng: number;
  deadlineAt: string;
  status: string;
  createdAt: string;
  distanceKm: number | null;
}

export interface Urgence {
  id: string;
  hospitalId: string;
  bloodGroup: string;
  bagsNeeded: number;
  bagsConfirmed: number;
  priority: 'CRITICAL' | 'HIGH' | 'NORMAL';
  deadlineAt: string;
  city: string;
  location: { lat: number; lng: number } | null;
  notes: string | null;
  radiusKm: number;
  status: 'OPEN' | 'COVERED' | 'CLOSED' | 'CANCELLED';
  contactPhone: string | null;
  createdAt: string;
  coveredAt: string | null;
  closedAt: string | null;
  counts?: { contacted: number; coming: number; confirmed: number; declined: number };
}

export interface UrgenceResponseRow {
  donorId: string;
  donorName?: string;
  donorCity?: string;
  donorBloodGroup?: string;
  donorPhone?: string | null;
  status: 'CONTACTED' | 'COMING' | 'CONFIRMED' | 'DECLINED' | 'CANCELLED';
  distanceKm: number | null;
  rank: number | null;
  updatedAt: string;
}

export interface StockRow {
  bloodGroup: string;
  units: number;
  threshold: number;
  low: boolean;
  updatedAt: string;
}

export interface HospitalProfile {
  id: string;
  name: string;
  contactName: string;
  email: string;
  phone: string | null;
  city: string;
  address: string | null;
  location: { lat: number; lng: number } | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: string;
}

export const BLOOD_GROUPS = ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'] as const;

/** Matrice de compatibilite globules rouges (donneur -> receveur), pour l'affichage public. */
export const RBC_TABLE: Record<string, string[]> = {
  'O-': ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'],
  'O+': ['O+', 'A+', 'B+', 'AB+'],
  'A-': ['A-', 'A+', 'AB-', 'AB+'],
  'A+': ['A+', 'AB+'],
  'B-': ['B-', 'B+', 'AB-', 'AB+'],
  'B+': ['B+', 'AB+'],
  'AB-': ['AB-', 'AB+'],
  'AB+': ['AB+'],
};
