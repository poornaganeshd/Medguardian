'use strict';

const {
  summariseVisit,
  reconcileMedicines
} = require('../../src/services/visitSummaryService');

const VISIT_NOTE = `Dr. A. Kumar MBBS MD
City Clinic, Chennai - 600001
Patient: Ravi Shankar   Age: 54   Sex: M
Date: 12/03/2026

C/O headache and dizziness since last week
BP 150/95 mmHg, Pulse 88/min
Impression: hypertension, uncontrolled
Advised: reduce salt intake, walk 30 minutes daily
Rx
1. Tab Amlodipine 5mg 1-0-0
2. Tab Metformin 500mg 1-0-1
Investigations: HbA1c, lipid profile
Follow up after 4 weeks
------------------------`;

describe('summariseVisit', () => {
  it('groups the document into recognised sections', () => {
    const summary = summariseVisit(VISIT_NOTE);
    const keys = summary.sections.map((s) => s.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'medications',
        'followUp',
        'investigations',
        'advice',
        'complaints',
        'observations'
      ])
    );
  });

  it('extracts the medicines with strength and frequency', () => {
    const summary = summariseVisit(VISIT_NOTE);
    const names = summary.medicines.map((m) => m.normalizedName);
    expect(names).toEqual(expect.arrayContaining(['amlodipine', 'metformin']));
    const amlodipine = summary.medicines.find((m) => m.normalizedName === 'amlodipine');
    expect(amlodipine.strength).toBe('5 mg');
    expect(amlodipine.frequencyHint).toBe('1-0-0');
  });

  it('labels clinician notes as recorded, never as its own conclusion', () => {
    const summary = summariseVisit(VISIT_NOTE);
    const section = summary.sections.find((s) => s.key === 'diagnosisNotes');
    expect(section.title).toMatch(/recorded by the clinician/i);
    expect(section.lines.join(' ')).toContain('hypertension');
  });

  it('never introduces text that was not in the document', () => {
    const summary = summariseVisit(VISIT_NOTE);
    const sourceLines = new Set(
      VISIT_NOTE.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim())
    );
    for (const section of summary.sections) {
      for (const line of section.lines) {
        expect(sourceLines.has(line)).toBe(true);
      }
    }
  });

  it('does not echo patient identifiers back', () => {
    const summary = summariseVisit(VISIT_NOTE);
    const all = JSON.stringify(summary.sections) + JSON.stringify(summary.otherNotes);
    expect(all).not.toContain('Ravi Shankar');
    expect(all).not.toMatch(/Age: 54/);
  });

  it('captures the provider header and any dates', () => {
    const summary = summariseVisit(VISIT_NOTE);
    expect(summary.provider.join(' ')).toMatch(/Dr\. A\. Kumar/);
    expect(summary.datesFound).toContain('12/03/2026');
  });

  it('declares itself extractive, non-diagnostic and not model-generated', () => {
    const summary = summariseVisit(VISIT_NOTE);
    expect(summary.method).toBe('rule-based-extractive');
    expect(summary.isDiagnostic).toBe(false);
    expect(summary.generatedByModel).toBe(false);
    expect(summary.disclaimer).toMatch(/nothing has been interpreted, diagnosed or added/i);
  });

  it('reports counts for transparency', () => {
    const summary = summariseVisit(VISIT_NOTE);
    expect(summary.stats.sourceLines).toBeGreaterThan(5);
    expect(summary.stats.medicinesFound).toBe(2);
  });

  it('handles an empty or unusable document', () => {
    for (const input of ['', '   ', null, undefined, '-----\n---']) {
      const summary = summariseVisit(input);
      expect(summary.summarised).toBe(false);
      expect(summary.reason).toBe('empty_document');
    }
  });

  it('is deterministic', () => {
    expect(JSON.stringify(summariseVisit(VISIT_NOTE))).toBe(
      JSON.stringify(summariseVisit(VISIT_NOTE))
    );
  });
});

describe('reconcileMedicines', () => {
  const documentMeds = [
    { normalizedName: 'metformin', suggestedName: 'Metformin' },
    { normalizedName: 'amlodipine', suggestedName: 'Amlodipine' }
  ];
  const patientMeds = [
    { name: 'Metformin', normalizedName: 'metformin' },
    { name: 'Ecosprin', normalizedName: 'aspirin' }
  ];

  it('splits medicines into both / document-only / list-only', () => {
    const result = reconcileMedicines(documentMeds, patientMeds);
    expect(result.inBoth.map((r) => r.substance)).toEqual(['metformin']);
    expect(result.onlyInDocument.map((r) => r.substance)).toEqual(['amlodipine']);
    expect(result.onlyOnYourList.map((r) => r.substance)).toEqual(['aspirin']);
  });

  it('makes no clinical judgement about the difference', () => {
    const result = reconcileMedicines(documentMeds, patientMeds);
    expect(result.note).toMatch(/name comparison only/i);
    expect(result.note).toMatch(/not necessarily an error/i);
  });

  it('handles empty inputs', () => {
    const result = reconcileMedicines([], []);
    expect(result).toMatchObject({ inBoth: [], onlyInDocument: [], onlyOnYourList: [] });
    expect(reconcileMedicines().inBoth).toEqual([]);
  });

  it('matches brand names against generic entries', () => {
    const result = reconcileMedicines(
      [{ suggestedName: 'Ecosprin 75' }],
      [{ name: 'Aspirin', normalizedName: 'aspirin' }]
    );
    expect(result.inBoth).toHaveLength(1);
  });
});
