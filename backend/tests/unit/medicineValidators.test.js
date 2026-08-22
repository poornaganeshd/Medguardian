'use strict';

const {
  createMedicineSchema,
  updateMedicineSchema,
  listMedicinesSchema,
  adjustStockSchema,
  idParam
} = require('../../src/validators/medicineValidators');

describe('medicine validators', () => {
  it('accepts a complete medicine payload', () => {
    const result = createMedicineSchema.safeParse({
      name: 'Metformin',
      genericName: 'Metformin Hydrochloride',
      strength: '500 mg',
      dosageForm: 'tablet',
      unit: 'tablet',
      instructions: 'Take after food',
      prescriberNotes: 'Review in 3 months',
      initialQuantity: '60',
      currentStock: '60',
      refillThreshold: '10'
    });
    expect(result.success).toBe(true);
    expect(result.data.initialQuantity).toBe(60);
  });

  it('requires a name', () => {
    expect(createMedicineSchema.safeParse({ strength: '500 mg' }).success).toBe(false);
  });

  it('rejects current stock greater than the initial quantity', () => {
    const result = createMedicineSchema.safeParse({
      name: 'Metformin',
      initialQuantity: 10,
      currentStock: 60
    });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].path).toEqual(['currentStock']);
  });

  it('rejects an unknown dosage form', () => {
    expect(
      createMedicineSchema.safeParse({ name: 'X', dosageForm: 'nanobot' }).success
    ).toBe(false);
  });

  it('rejects negative stock', () => {
    expect(createMedicineSchema.safeParse({ name: 'X', currentStock: -5 }).success).toBe(false);
  });

  it('requires at least one field on update', () => {
    expect(updateMedicineSchema.safeParse({}).success).toBe(false);
    expect(updateMedicineSchema.safeParse({ refillThreshold: 4 }).success).toBe(true);
  });

  it('applies list defaults', () => {
    const q = listMedicinesSchema.parse({});
    expect(q).toMatchObject({ page: 1, limit: 20, status: 'active', sort: 'name' });
  });

  it('caps the page size', () => {
    expect(listMedicinesSchema.safeParse({ limit: 5000 }).success).toBe(false);
  });

  it('validates stock adjustment modes', () => {
    expect(adjustStockSchema.safeParse({ mode: 'refill', quantity: 30 }).success).toBe(true);
    expect(adjustStockSchema.safeParse({ mode: 'correction', quantity: 0 }).success).toBe(true);
    expect(adjustStockSchema.safeParse({ mode: 'magic', quantity: 30 }).success).toBe(false);
  });

  it('validates object ids', () => {
    expect(idParam.safeParse({ id: '64b7f0c2f1a2b3c4d5e6f708' }).success).toBe(true);
    expect(idParam.safeParse({ id: 'not-an-id' }).success).toBe(false);
  });
});
