'use strict';

const { extractMedicineCandidates } = require('../../src/services/ocrService');

const PRESCRIPTION = `Dr. A. Kumar, MBBS, MD
City Clinic, Chennai - 600001
Patient: Ravi Shankar   Age: 54   Sex: M
Date: 12/03/2026

Rx
1. Tab. Metformin 500 mg   1-0-1   after food
2. Tab Ecosprin 75mg   0-0-1
3. Cap Omeprazole 20mg   1-0-0   before food
4. Syp Paracetamol 250mg/5ml   SOS

Advice: Review after 3 months
Signature
------------------------------`;

describe('extractMedicineCandidates', () => {
  it('extracts each prescribed medicine from a typical prescription', () => {
    const candidates = extractMedicineCandidates(PRESCRIPTION);
    const names = candidates.map((c) => c.normalizedName);
    expect(names).toEqual(expect.arrayContaining(['metformin', 'aspirin', 'omeprazole']));
  });

  it('captures strength, dosage form and frequency hints', () => {
    const metformin = extractMedicineCandidates(PRESCRIPTION).find(
      (c) => c.normalizedName === 'metformin'
    );
    expect(metformin.strength).toBe('500 mg');
    expect(metformin.dosageForm).toBe('tablet');
    expect(metformin.frequencyHint).toBe('1-0-1');
  });

  it('normalises brand names to the active substance', () => {
    const aspirin = extractMedicineCandidates(PRESCRIPTION).find(
      (c) => c.normalizedName === 'aspirin'
    );
    expect(aspirin.suggestedName).toMatch(/Ecosprin/i);
    expect(aspirin.matchedKnownSubstance).toBe(true);
  });

  it('scores confidence higher when more signals are present', () => {
    const strong = extractMedicineCandidates('Tab. Metformin 500 mg 1-0-1')[0];
    const weak = extractMedicineCandidates('Rifampicin 450mg')[0];
    expect(strong.confidence).toBeGreaterThan(weak.confidence);
    expect(strong.confidence).toBeLessThanOrEqual(1);
    expect(weak.confidence).toBeGreaterThan(0);
  });

  it('ignores clinic headers, patient details and separators', () => {
    const names = extractMedicineCandidates(PRESCRIPTION).map((c) => c.normalizedName);
    expect(names).not.toContain('citycliniC'.toLowerCase());
    for (const banned of ['ravishankar', 'akumar', 'chennai', 'signature', 'advice']) {
      expect(names).not.toContain(banned);
    }
  });

  it('does not invent a medicine from a bare word with no supporting signal', () => {
    expect(extractMedicineCandidates('Some random sentence about the weather')).toEqual([]);
    expect(extractMedicineCandidates('Thank you for visiting')).toEqual([]);
  });

  it('deduplicates the same substance appearing twice', () => {
    const candidates = extractMedicineCandidates(
      'Tab Metformin 500mg 1-0-1\nTab. Metformin 500 mg 0-0-1'
    );
    expect(candidates.filter((c) => c.normalizedName === 'metformin')).toHaveLength(1);
  });

  it('handles empty, null and non-string input', () => {
    expect(extractMedicineCandidates('')).toEqual([]);
    expect(extractMedicineCandidates(null)).toEqual([]);
    expect(extractMedicineCandidates(undefined)).toEqual([]);
    expect(extractMedicineCandidates(12345)).toEqual([]);
  });

  it('caps the number of suggestions', () => {
    const many = Array.from({ length: 40 }, (_, i) => `Tab Drug${i} ${100 + i}mg 1-0-1`).join('\n');
    expect(extractMedicineCandidates(many).length).toBeLessThanOrEqual(20);
  });

  it('is deterministic', () => {
    const a = JSON.stringify(extractMedicineCandidates(PRESCRIPTION));
    const b = JSON.stringify(extractMedicineCandidates(PRESCRIPTION));
    expect(a).toBe(b);
  });

  it('returns suggestions sorted by confidence', () => {
    const scores = extractMedicineCandidates(PRESCRIPTION).map((c) => c.confidence);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('flags whether a suggestion matched a known substance', () => {
    const candidates = extractMedicineCandidates(
      'Tab Metformin 500mg 1-0-1\nTab Xyzzyzine 10mg 1-0-0'
    );
    const known = candidates.find((c) => c.normalizedName === 'metformin');
    const unknown = candidates.find((c) => c.normalizedName === 'xyzzyzine');
    expect(known.matchedKnownSubstance).toBe(true);
    expect(unknown.matchedKnownSubstance).toBe(false);
    expect(unknown.confidence).toBeLessThan(known.confidence);
  });
});
