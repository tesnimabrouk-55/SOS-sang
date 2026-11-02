import { distanceKm, type BloodGroup, type EligibilityResult } from '@sos/shared';

/**
 * Regle de classement (documentee, stable, testee):
 *
 * 1. FILTRES ELIMINATOIRES
 *    - groupe sanguin compatible avec le receveur (matrice GR, module @sos/shared/blood)
 *    - disponible (is_available = true) et consentement notifications
 *    - eligibilite calculee par le donor-service = true
 *    - coordonnees presentes (sinon distance non calculable)
 *    - pas deja repondu a cette urgence (gere par hospital-service)
 *
 * 2. TRI
 *    - distance croissante (Haversine, km) — critere primaire
 *    - puis score de fiabilite decroissant — critere secondaire
 *
 * 3. SCORE DE FIABILITE (0..100)
 *    fiabilite = 40 * min(1, dons / 10)
 *              + 30 * (reponses / alertes recues)
 *              + 30 * (venues / reponses)
 *    Les donneurs sans historique obtiennent 0 (neutre, pas penalisant au tri
 *    primaire par distance).
 */
export interface Candidate {
  id: string;
  userId: string;
  bloodGroup: BloodGroup;
  city: string;
  lat: number;
  lng: number;
  lastDonationDate: string | null;
  totalDonations: number;
  alertsReceived: number;
  alertsAnswered: number;
  alertsComing: number;
  eligibility: EligibilityResult;
  createdAt?: string;
}

export interface RankedCandidate extends Candidate {
  distanceKm: number;
  reliabilityScore: number;
  rank: number;
}

export function reliabilityScore(candidate: Candidate): number {
  const donations = Math.min(1, candidate.totalDonations / 10);
  const responseRate = candidate.alertsReceived > 0 ? candidate.alertsAnswered / candidate.alertsReceived : 0;
  const comingRate = candidate.alertsAnswered > 0 ? candidate.alertsComing / candidate.alertsAnswered : 0;
  return Math.round(40 * donations + 30 * Math.min(1, responseRate) + 30 * Math.min(1, comingRate));
}

export interface RankOptions {
  lat: number;
  lng: number;
  radiusKm: number;
  limit: number;
}

export function rankCandidates(candidates: Candidate[], options: RankOptions): RankedCandidate[] {
  const withDistance = candidates
    .map((candidate) => ({
      candidate,
      distance: distanceKm({ lat: options.lat, lng: options.lng }, { lat: candidate.lat, lng: candidate.lng }),
    }))
    .filter((entry) => entry.distance <= options.radiusKm);

  withDistance.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    return reliabilityScore(b.candidate) - reliabilityScore(a.candidate);
  });

  return withDistance.slice(0, options.limit).map((entry, index) => ({
    ...entry.candidate,
    distanceKm: entry.distance,
    reliabilityScore: reliabilityScore(entry.candidate),
    rank: index + 1,
  }));
}

/**
 * Extension progressive du rayon: on renvoie le premier rayon qui fournit
 * suffisamment de candidats (4 par poche demandee, borne par MAX_ALERTS).
 */
export function selectWithRadiusExpansion(
  candidates: Candidate[],
  options: { lat: number; lng: number; bagsNeeded: number; radii: number[]; maxAlerts: number },
): { selected: RankedCandidate[]; radiusKm: number; insufficient: boolean } {
  const target = Math.min(options.maxAlerts, Math.max(3, options.bagsNeeded * 4));
  const radii = [...new Set(options.radii)].sort((a, b) => a - b);
  let best: RankedCandidate[] = [];
  let bestRadius = radii[radii.length - 1] ?? 0;

  for (const radiusKm of radii) {
    const ranked = rankCandidates(candidates, {
      lat: options.lat,
      lng: options.lng,
      radiusKm,
      limit: options.maxAlerts,
    });
    if (ranked.length > best.length) {
      best = ranked;
      bestRadius = radiusKm;
    }
    if (ranked.length >= target) {
      return { selected: ranked, radiusKm, insufficient: false };
    }
  }

  return {
    selected: best,
    radiusKm: bestRadius,
    insufficient: best.length < options.bagsNeeded,
  };
}
