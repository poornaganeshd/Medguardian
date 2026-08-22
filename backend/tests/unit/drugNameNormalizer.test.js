'use strict';

const {
  normalizeDrugName,
  splitCombination
} = require('../../src/utils/drugNameNormalizer');

describe('normalizeDrugName', () => {
  it('lower-cases and strips punctuation', () => {
    expect(normalizeDrugName('Metformin')).toBe('metformin');
    expect(normalizeDrugName('  METFORMIN.  ')).toBe('metformin');
  });

  it('strips dosage strengths and pack noise', () => {
    expect(normalizeDrugName('Metformin 500 mg SR Tablet')).toBe('metformin');
    expect(normalizeDrugName('Amoxicillin 250mg capsules')).toBe('amoxicillin');
    expect(normalizeDrugName('Salbutamol 100 mcg inhaler')).toBe('salbutamol');
  });

  it('resolves common brand names to the active substance', () => {
    expect(normalizeDrugName('Dolo 650')).toBe('paracetamol');
    expect(normalizeDrugName('Tab. Ecosprin 75mg')).toBe('aspirin');
    expect(normalizeDrugName('Glycomet 500')).toBe('metformin');
    expect(normalizeDrugName('Coumadin')).toBe('warfarin');
  });

  it('treats acetaminophen and paracetamol as the same substance', () => {
    expect(normalizeDrugName('Acetaminophen')).toBe(normalizeDrugName('Paracetamol'));
  });

  it('keeps every substance of a combination product, order-independently', () => {
    const a = normalizeDrugName('Amoxicillin + Clavulanic Acid');
    const b = normalizeDrugName('Clavulanic Acid + Amoxicillin');
    expect(a).toBe(b);
    expect(splitCombination(a)).toEqual(['amoxicillin', 'clavulanicacid']);
  });

  it('drops parenthetical notes', () => {
    expect(normalizeDrugName('Warfarin (blood thinner)')).toBe('warfarin');
  });

  it('is deterministic and total', () => {
    expect(normalizeDrugName('')).toBe('');
    expect(normalizeDrugName(null)).toBe('');
    expect(normalizeDrugName(undefined)).toBe('');
    expect(normalizeDrugName(42)).toBe('');
    expect(normalizeDrugName('Tablet')).toBe('');
    const input = 'Tab. Ecosprin 75mg';
    expect(normalizeDrugName(input)).toBe(normalizeDrugName(input));
  });

  it('splitCombination handles empty input', () => {
    expect(splitCombination('')).toEqual([]);
    expect(splitCombination('aspirin')).toEqual(['aspirin']);
  });
});
