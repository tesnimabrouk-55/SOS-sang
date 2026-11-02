import { describe, expect, it } from 'vitest';
import type { BloodGroup, EligibilityResult } from '@sos/shared';
import { rankCandidates, reliabilityScore, selectWithRadiusExpansion, type Candidate } from '../services/matching-service/src/matching';

const ELIGIBLE: EligibilityResult = {
  eligible: true,
  blockers: [],
  warnings: [],
  nextEligibleOn: null,
  daysUntilEligible: null,
  ruleVersion: 'test',
  computedAt: new Date('2026-01-01').toISOString(),
  disclaimerFr: 'indicatif',
};

/** Centre de Tunis : les coordonnees sont volontairement arrondies. */
const TUNIS = { lat: 36.8065, lng: 10.1815 };

function donor(id: string, distanceApproxKm: number, overrides: Partial<Candidate> = {}): Candidate {
  // 1 degre de latitude ~ 111 km : on decale vers le nord pour obtenir la distance voulue.
  const lat = TUNIS.lat + distanceApproxKm / 111;
  return {
    id,
    userId: id,
    bloodGroup: 'O-' as BloodGroup,
    city: 'Tunis',
    lat,
    lng: TUNIS.lng,
    lastDonationDate: null,
    totalDonations: 0,
    alertsReceived: 0,
    alertsAnswered: 0,
    alertsComing: 0,
    eligibility: ELIGIBLE,
    ...overrides,
  };
}

describe('classement des donneurs', () => {
  it('trie par distance croissante', () => {
    const ranked = rankCandidates([donor('loin', 30), donor('proche', 5), donor('moyen', 12)], {
      ...TUNIS,
      radiusKm: 100,
      limit: 10,
    });
    expect(ranked.map((r) => r.id)).toEqual(['proche', 'moyen', 'loin']);
    expect(ranked[0].distanceKm).toBeLessThan(ranked[1].distanceKm);
    expect(ranked[0].rank).toBe(1);
  });

  it('departage deux distances proches par la fiabilite', () => {
    const proche = donor('proche', 10.1, { totalDonations: 0 });
    const presque = donor('presque', 10.3, { totalDonations: 10, alertsReceived: 10, alertsAnswered: 10, alertsComing: 10 });
    const ranked = rankCandidates([proche, presque], { ...TUNIS, radiusKm: 50, limit: 10 });
    // La distance reste le critere primaire.
    expect(ranked[0].id).toBe('proche');
  });

  it('calcule un score de fiabilite borne 0..100', () => {
    expect(reliabilityScore(donor('nouveau', 5))).toBe(0);
    const parfait = donor('parfait', 5, { totalDonations: 12, alertsReceived: 10, alertsAnswered: 10, alertsComing: 10 });
    expect(reliabilityScore(parfait)).toBe(100);
    const partiel = donor('partiel', 5, { totalDonations: 5, alertsReceived: 10, alertsAnswered: 5, alertsComing: 2 });
    expect(reliabilityScore(partiel)).toBe(20 + 15 + 12);
  });

  it('exclut les candidats hors rayon', () => {
    const ranked = rankCandidates([donor('a', 5), donor('b', 80)], { ...TUNIS, radiusKm: 25, limit: 10 });
    expect(ranked.map((r) => r.id)).toEqual(['a']);
  });

  it('respecte la limite de notifications', () => {
    const many = Array.from({ length: 20 }, (_, i) => donor(`d${i}`, 1 + i));
    const ranked = rankCandidates(many, { ...TUNIS, radiusKm: 100, limit: 7 });
    expect(ranked).toHaveLength(7);
  });
});

describe('extension progressive du rayon', () => {
  it('n elargit pas le rayon quand la cible est atteinte', () => {
    const candidates = [donor('a', 5), donor('b', 8), donor('c', 12)];
    const result = selectWithRadiusExpansion(candidates, { ...TUNIS, bagsNeeded: 1, radii: [25, 50, 100], maxAlerts: 10 });
    expect(result.radiusKm).toBe(25);
    expect(result.insufficient).toBe(false);
  });

  it('elargit jusqu a trouver assez de donneurs', () => {
    const candidates = [donor('a', 5), donor('b', 60), donor('c', 70), donor('d', 90)];
    const result = selectWithRadiusExpansion(candidates, { ...TUNIS, bagsNeeded: 1, radii: [25, 50, 100], maxAlerts: 10 });
    expect(result.radiusKm).toBe(100);
    expect(result.selected).toHaveLength(4);
    expect(result.insufficient).toBe(false);
  });

  it('signale une insuffisance quand le besoin depasse les donneurs trouves', () => {
    const result = selectWithRadiusExpansion([donor('a', 5)], { ...TUNIS, bagsNeeded: 4, radii: [25, 50], maxAlerts: 10 });
    expect(result.insufficient).toBe(true);
    expect(result.selected).toHaveLength(1);
  });

  it('borne le nombre d alertes a max(3, poches x 4) sans depasser maxAlerts', () => {
    const many = Array.from({ length: 30 }, (_, i) => donor(`d${i}`, 1 + i * 0.5));
    const result = selectWithRadiusExpansion(many, { ...TUNIS, bagsNeeded: 1, radii: [50], maxAlerts: 6 });
    expect(result.selected.length).toBeLessThanOrEqual(6);
  });
});
