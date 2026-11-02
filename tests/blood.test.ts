import { describe, expect, it } from 'vitest';
import {
  BLOOD_GROUPS,
  RBC_COMPATIBILITY,
  canDonateTo,
  compatibleDonorGroups,
  compatibleRecipientGroups,
  recipientMatrix,
  type BloodGroup,
} from '@sos/shared';

/**
 * Matrice de reference, ecrite independamment de l'implementation :
 * lignes = donneur, colonnes = receveur compatible.
 */
const EXPECTED: Record<BloodGroup, BloodGroup[]> = {
  'O-': ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'],
  'O+': ['O+', 'A+', 'B+', 'AB+'],
  'A-': ['A-', 'A+', 'AB-', 'AB+'],
  'A+': ['A+', 'AB+'],
  'B-': ['B-', 'B+', 'AB-', 'AB+'],
  'B+': ['B+', 'AB+'],
  'AB-': ['AB-', 'AB+'],
  'AB+': ['AB+'],
};

describe('compatibilite des globules rouges', () => {
  it('expose exactement les 8 groupes ABO/RhD', () => {
    expect([...BLOOD_GROUPS].sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it('respecte la matrice complete donneur -> receveur', () => {
    for (const donor of BLOOD_GROUPS) {
      for (const recipient of BLOOD_GROUPS) {
        const expected = EXPECTED[donor].includes(recipient);
        expect(canDonateTo(donor, recipient), `${donor} -> ${recipient}`).toBe(expected);
      }
    }
  });

  it('O- est donneur universel et AB+ receveur universel', () => {
    for (const recipient of BLOOD_GROUPS) expect(canDonateTo('O-', recipient)).toBe(true);
    for (const donor of BLOOD_GROUPS) expect(canDonateTo(donor, 'AB+')).toBe(true);
  });

  it('les helpers sont coherents entre eux', () => {
    for (const recipient of BLOOD_GROUPS) {
      const donors = compatibleDonorGroups(recipient);
      expect(donors.length).toBeGreaterThan(0);
      for (const donor of donors) expect(canDonateTo(donor, recipient)).toBe(true);
      expect(donors).not.toContain(undefined);
    }
    for (const donor of BLOOD_GROUPS) {
      expect(compatibleRecipientGroups(donor)).toEqual(EXPECTED[donor]);
    }
  });

  it('refuse une incompatibilite majeure (A+ vers O-)', () => {
    expect(canDonateTo('A+', 'O-')).toBe(false);
    expect(canDonateTo('B-', 'A-')).toBe(false);
    expect(canDonateTo('AB+', 'O+')).toBe(false);
  });

  it('la matrice exportee est identique a la table de reference', () => {
    // recipientMatrix indexe par RECEVEUR : on derive la table donneur -> receveurs.
    const byRecipient = recipientMatrix();
    for (const donor of BLOOD_GROUPS) {
      expect(new Set(RBC_COMPATIBILITY[donor])).toEqual(new Set(EXPECTED[donor]));
      expect(new Set(compatibleRecipientGroups(donor))).toEqual(new Set(EXPECTED[donor]));
    }
    for (const recipient of BLOOD_GROUPS) {
      const donors = BLOOD_GROUPS.filter((d) => EXPECTED[d].includes(recipient));
      expect(new Set(byRecipient[recipient])).toEqual(new Set(donors));
    }
  });
});
