import { describe, expect, it } from 'vitest';
import { DEFAULT_ELIGIBILITY_RULE, evaluateEligibility, ruleFromEnv, type EligibilityRule } from '@sos/shared';

const NOW = new Date('2026-06-15T12:00:00.000Z');
const RULE: EligibilityRule = { ...DEFAULT_ELIGIBILITY_RULE };
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10);

describe('eligibilite configurable', () => {
  it('accepte un donneur sans blocage', () => {
    const result = evaluateEligibility({ birthDate: '1990-01-01', weightKg: 70, lastDonationDate: daysAgo(120) }, RULE, NOW);
    expect(result.eligible).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it('bloque un delai entre dons trop court et calcule la prochaine date', () => {
    const result = evaluateEligibility({ birthDate: '1990-01-01', weightKg: 70, lastDonationDate: daysAgo(10) }, RULE, NOW);
    expect(result.eligible).toBe(false);
    expect(result.blockers).toContain('INTERVAL_TOO_SHORT');
    expect(result.nextEligibleOn).toBe(new Date(NOW.getTime() + 80 * 86_400_000).toISOString().slice(0, 10));
    expect(result.daysUntilEligible).toBe(80);
  });

  it('respecte une regle personnalisee (60 jours)', () => {
    const custom: EligibilityRule = { ...RULE, minIntervalDays: 60, version: 'test-60' };
    const recent = evaluateEligibility({ birthDate: '1990-01-01', weightKg: 70, lastDonationDate: daysAgo(45) }, custom, NOW);
    expect(recent.eligible).toBe(false);
    expect(recent.ruleVersion).toBe('test-60');
    const ok = evaluateEligibility({ birthDate: '1990-01-01', weightKg: 70, lastDonationDate: daysAgo(61) }, custom, NOW);
    expect(ok.eligible).toBe(true);
  });

  it('bloque un age insuffisant et un age excessif', () => {
    const young = evaluateEligibility({ birthDate: '2012-01-01', weightKg: 60 }, RULE, NOW);
    expect(young.blockers).toContain('AGE_TOO_LOW');
    const old = evaluateEligibility({ birthDate: '1950-01-01', weightKg: 60 }, RULE, NOW);
    expect(old.blockers).toContain('AGE_TOO_HIGH');
  });

  it('bloque un poids insuffisant', () => {
    const result = evaluateEligibility({ birthDate: '1990-01-01', weightKg: 45 }, RULE, NOW);
    expect(result.blockers).toContain('WEIGHT_TOO_LOW');
  });

  it('emet des avertissements sans bloquer quand les donnees manquent', () => {
    const result = evaluateEligibility({}, RULE, NOW);
    expect(result.eligible).toBe(true);
    expect(result.warnings).toContain('BIRTHDATE_UNKNOWN');
    expect(result.warnings).toContain('WEIGHT_UNKNOWN');
    expect(result.warnings).toContain('LAST_DONATION_UNKNOWN');
  });

  it('exige les donnees medicales si la regle le demande', () => {
    const strict: EligibilityRule = { ...RULE, requireMedicalData: true };
    const result = evaluateEligibility({}, strict, NOW);
    expect(result.blockers).toContain('MISSING_MEDICAL_DATA');
    expect(result.eligible).toBe(false);
  });

  it('ne presente jamais le resultat comme une validation medicale', () => {
    const result = evaluateEligibility({ birthDate: '1990-01-01' }, RULE, NOW);
    expect(result.disclaimerFr.toLowerCase()).toContain('pas une validation medicale');
  });

  it('lit la regle depuis les variables d environnement', () => {
    const env = {
      ELIGIBILITY_MIN_INTERVAL_DAYS: '120',
      ELIGIBILITY_MIN_AGE: '20',
      ELIGIBILITY_MAX_AGE: '60',
      ELIGIBILITY_MIN_WEIGHT_KG: '55',
      ELIGIBILITY_RULE_VERSION: 'env-120',
    } as NodeJS.ProcessEnv;
    const rule = ruleFromEnv(env);
    expect(rule.minIntervalDays).toBe(120);
    expect(rule.minAge).toBe(20);
    expect(rule.maxAge).toBe(60);
    expect(rule.minWeightKg).toBe(55);
    expect(rule.version).toBe('env-120');
  });
});
