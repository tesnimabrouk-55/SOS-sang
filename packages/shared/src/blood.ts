/**
 * Matrice de compatibilite des globules rouges (GR / RBC).
 *
 * IMPORTANT :
 * - Ce module ne traite QUE la compatibilite de groupe sanguin ABO/RhD pour
 *   une transfusion de globules rouges.
 * - Il ne traite ni le plasma, ni les plaquettes (regles differentes).
 * - Il ne remplace JAMAIS : l'eligibilite medicale du donneur, les tests de
 *   compatibilite pre-transfusionnels (groupage, phénotypage, cross-match),
 *   ni la decision clinique du centre de transfusion.
 *
 * Source des regles : table de compatibilite ABO/RhD standard.
 *   Donneur O- => receveur universel de GR.
 *   Receveur AB+ => receveur universel de GR.
 */
export type BloodGroup = 'O-' | 'O+' | 'A-' | 'A+' | 'B-' | 'B+' | 'AB-' | 'AB+';

export const BLOOD_GROUPS: readonly BloodGroup[] = [
  'O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+',
] as const;

/** Pour chaque groupe de DONNEUR, la liste explicite des receveurs compatibles. */
export const RBC_COMPATIBILITY: Readonly<Record<BloodGroup, readonly BloodGroup[]>> = {
  'O-': ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'],
  'O+': ['O+', 'A+', 'B+', 'AB+'],
  'A-': ['A-', 'A+', 'AB-', 'AB+'],
  'A+': ['A+', 'AB+'],
  'B-': ['B-', 'B+', 'AB-', 'AB+'],
  'B+': ['B+', 'AB+'],
  'AB-': ['AB-', 'AB+'],
  'AB+': ['AB+'],
};

export function isBloodGroup(value: unknown): value is BloodGroup {
  return typeof value === 'string' && (BLOOD_GROUPS as readonly string[]).includes(value);
}

export function assertBloodGroup(value: unknown): BloodGroup {
  if (!isBloodGroup(value)) {
    throw new Error(`Groupe sanguin invalide: ${String(value)}`);
  }
  return value;
}

/** Le donneur peut-il donner des globules rouges a ce receveur ? */
export function canDonateTo(donor: BloodGroup, recipient: BloodGroup): boolean {
  return RBC_COMPATIBILITY[donor].includes(recipient);
}

/** Groupes de DONNEURS compatibles pour un receveur donne (utilise par le matching). */
export function compatibleDonorGroups(recipient: BloodGroup): BloodGroup[] {
  return BLOOD_GROUPS.filter((donor) => canDonateTo(donor, recipient));
}

/** Groupes de RECEVEURS possibles pour un donneur donne. */
export function compatibleRecipientGroups(donor: BloodGroup): BloodGroup[] {
  return [...RBC_COMPATIBILITY[donor]];
}

/**
 * Matrice pre-calculee receveur -> donneurs, utile pour l'affichage et les tests.
 */
export function recipientMatrix(): Record<BloodGroup, BloodGroup[]> {
  const matrix = {} as Record<BloodGroup, BloodGroup[]>;
  for (const recipient of BLOOD_GROUPS) {
    matrix[recipient] = compatibleDonorGroups(recipient);
  }
  return matrix;
}

export const BLOOD_COMPATIBILITY_DISCLAIMER_FR =
  "La compatibilite affichee concerne uniquement les globules rouges (ABO/RhD). " +
  "L'eligibilite calculee par SOS Sang est indicative et ne constitue pas une validation medicale : " +
  "la decision finale appartient au centre de transfusion sanguine.";

export const BLOOD_COMPATIBILITY_DISCLAIMER_AR =
  'التوافق المعروض يخص كريات الدم الحمراء فقط (ABO/RhD). ' +
  'حساب الأهلية في SOS Sang إرشادي ولا يمثل موافقة طبية: القرار النهائي يعود لمركز نقل الدم.';
