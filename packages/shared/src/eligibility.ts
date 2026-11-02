/**
 * Regle d'eligibilite configurable cote serveur.
 *
 * L'eligibilite est un FILTRE PRODUIT (delai entre dons, age, poids declares),
 * pas un avis medical. Le resultat est toujours accompagne d'un avertissement
 * et la decision finale reste celle du centre de transfusion.
 */
export interface EligibilityRule {
  minIntervalDays: number;
  minAge: number;
  maxAge: number;
  minWeightKg: number;
  version: string;
  /** Si false, l'absence de poids/date de naissance n'empeche pas l'eligibilite. */
  requireMedicalData: boolean;
}

export const DEFAULT_ELIGIBILITY_RULE: EligibilityRule = {
  minIntervalDays: 90,
  minAge: 18,
  maxAge: 65,
  minWeightKg: 50,
  version: 'v1',
  requireMedicalData: false,
};

export interface DonorMedicalInput {
  birthDate?: string | Date | null;
  weightKg?: number | null;
  lastDonationDate?: string | Date | null;
  sex?: 'F' | 'M' | null;
}

export type EligibilityBlocker =
  | 'AGE_TOO_LOW'
  | 'AGE_TOO_HIGH'
  | 'WEIGHT_TOO_LOW'
  | 'INTERVAL_TOO_SHORT'
  | 'MISSING_MEDICAL_DATA';

export type EligibilityWarning = 'WEIGHT_UNKNOWN' | 'BIRTHDATE_UNKNOWN' | 'LAST_DONATION_UNKNOWN';

export interface EligibilityResult {
  eligible: boolean;
  blockers: EligibilityBlocker[];
  warnings: EligibilityWarning[];
  /** Date a partir de laquelle le don redevient possible (ISO 8601, date seule). */
  nextEligibleOn: string | null;
  daysUntilEligible: number | null;
  ruleVersion: string;
  computedAt: string;
  disclaimerFr: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function ageInYears(birth: Date, now: Date): number {
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - birth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < birth.getUTCDate())) {
    age -= 1;
  }
  return age;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function evaluateEligibility(
  input: DonorMedicalInput,
  rule: EligibilityRule = DEFAULT_ELIGIBILITY_RULE,
  now: Date = new Date(),
): EligibilityResult {
  const blockers: EligibilityBlocker[] = [];
  const warnings: EligibilityWarning[] = [];

  const birth = toDate(input.birthDate);
  if (birth) {
    const age = ageInYears(birth, now);
    if (age < rule.minAge) blockers.push('AGE_TOO_LOW');
    if (age > rule.maxAge) blockers.push('AGE_TOO_HIGH');
  } else if (rule.requireMedicalData) {
    blockers.push('MISSING_MEDICAL_DATA');
  } else {
    warnings.push('BIRTHDATE_UNKNOWN');
  }

  const weight = input.weightKg ?? null;
  if (weight === null || weight === undefined) {
    if (rule.requireMedicalData) blockers.push('MISSING_MEDICAL_DATA');
    else warnings.push('WEIGHT_UNKNOWN');
  } else if (weight < rule.minWeightKg) {
    blockers.push('WEIGHT_TOO_LOW');
  }

  const lastDonation = toDate(input.lastDonationDate);
  let nextEligibleOn: string | null = null;
  let daysUntilEligible: number | null = null;

  if (!lastDonation) {
    warnings.push('LAST_DONATION_UNKNOWN');
  } else {
    // Regle par defaut: delai unique. Le sexe n'est pas utilise par defaut,
    // mais reste disponible pour une regle derivee (ex: 120 j pour les femmes).
    const intervalMs = rule.minIntervalDays * DAY_MS;
    const eligibleAt = new Date(lastDonation.getTime() + intervalMs);
    nextEligibleOn = isoDate(eligibleAt);
    const diff = eligibleAt.getTime() - now.getTime();
    daysUntilEligible = diff <= 0 ? 0 : Math.ceil(diff / DAY_MS);
    if (diff > 0) blockers.push('INTERVAL_TOO_SHORT');
  }

  const uniqueBlockers = [...new Set(blockers)];

  return {
    eligible: uniqueBlockers.length === 0,
    blockers: uniqueBlockers,
    warnings,
    nextEligibleOn,
    daysUntilEligible,
    ruleVersion: rule.version,
    computedAt: now.toISOString(),
    disclaimerFr:
      "Resultat indicatif base sur les regles configurees (delai entre dons, age, poids). " +
      "Ce n'est pas une validation medicale : seul le centre de transfusion decide de l'aptitude au don.",
  };
}

/** Construit une regle a partir de variables d'environnement (bornes validees). */
export function ruleFromEnv(env: NodeJS.ProcessEnv): EligibilityRule {
  const num = (key: string, fallback: number) => {
    const raw = Number(env[key]);
    return Number.isFinite(raw) && raw > 0 ? raw : fallback;
  };
  return {
    minIntervalDays: num('ELIGIBILITY_MIN_INTERVAL_DAYS', DEFAULT_ELIGIBILITY_RULE.minIntervalDays),
    minAge: num('ELIGIBILITY_MIN_AGE', DEFAULT_ELIGIBILITY_RULE.minAge),
    maxAge: num('ELIGIBILITY_MAX_AGE', DEFAULT_ELIGIBILITY_RULE.maxAge),
    minWeightKg: num('ELIGIBILITY_MIN_WEIGHT_KG', DEFAULT_ELIGIBILITY_RULE.minWeightKg),
    version: env.ELIGIBILITY_RULE_VERSION || DEFAULT_ELIGIBILITY_RULE.version,
    requireMedicalData: env.ELIGIBILITY_REQUIRE_MEDICAL_DATA === 'true',
  };
}
