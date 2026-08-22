'use strict';

const service = require('../../src/services/medicineInfoService');
const kb = require('../../src/data/medicineKnowledgeBase.json');

describe('knowledge base integrity', () => {
  it('is marked as curated demo content with source notes', () => {
    expect(kb.isDemoData).toBe(true);
    expect(kb.demoDataNotice).toMatch(/CURATED DEMO CONTENT/i);
    expect(kb.sourceNotes).toMatch(/does not generate medical text/i);
  });

  it('states explicitly what it may and must not answer', () => {
    expect(kb.scopeRules.mustRefuse.join(' ')).toMatch(/Diagnosing/i);
    expect(kb.scopeRules.mustRefuse.join(' ')).toMatch(/prescrib/i);
    expect(kb.scopeRules.mustRefuse.join(' ')).toMatch(/dose/i);
  });

  it('contains no dose instructions in any entry', () => {
    // A general information base must never carry "take N tablets" guidance.
    const forbidden = /\btake (one|two|three|\d+)\s+(tablets?|capsules?)\b/i;
    for (const entry of kb.entries) {
      const text = JSON.stringify(entry);
      expect(text).not.toMatch(forbidden);
    }
  });

  it('gives every entry the required sections', () => {
    for (const entry of kb.entries) {
      expect(entry.substance).toBeTruthy();
      expect(entry.commonUses.length).toBeGreaterThan(0);
      expect(entry.generalPrecautions.length).toBeGreaterThan(0);
      expect(entry.storage.length).toBeGreaterThan(10);
      expect(entry.talkToYourDoctorIf.length).toBeGreaterThan(0);
    }
  });
});

describe('guardrails — questions that must be refused', () => {
  it.each([
    ['diagnosis', 'Do I have diabetes?'],
    ['diagnosis', 'What is wrong with me, I feel dizzy'],
    ['prescribing', 'What medicine should I take for my headache?'],
    ['prescribing', 'Can you prescribe something for my cough?'],
    ['dosage_change', 'Should I increase my dose of metformin?'],
    ['dosage_change', 'How many tablets should I take?'],
    ['stop_or_continue', 'Should I stop taking warfarin?'],
    ['interaction', 'Can I take ibuprofen with warfarin?'],
    ['emergency', 'I took too many paracetamol tablets'],
    ['personal_circumstance', 'Is metformin safe while pregnant?']
  ])('refuses a %s question: "%s"', (reason, question) => {
    const result = service.answer({ question });
    expect(result.answered).toBe(false);
    expect(result.reason).toBe(reason);
    expect(result.message.length).toBeGreaterThan(20);
  });

  it('flags an emergency question as urgent', () => {
    const result = service.answer({ question: 'I have chest pain and cannot breathe' });
    expect(result.urgent).toBe(true);
    expect(result.message).toMatch(/emergency/i);
  });

  it('redirects interaction questions to the deterministic checker', () => {
    const result = service.answer({ question: 'Do aspirin and warfarin interact?' });
    expect(result.redirectTo).toBe('drug_interaction_checker');
    expect(result.message).toMatch(/fixed, reviewed dataset/i);
  });

  it('refuses before it retrieves, even for a medicine it knows', () => {
    const result = service.answer({
      question: 'Should I double my dose?',
      medicineName: 'Metformin'
    });
    expect(result.answered).toBe(false);
    expect(result.sections).toBeUndefined();
  });
});

describe('retrieval — questions it may answer', () => {
  it('answers a storage question from the stored entry verbatim', () => {
    const result = service.answer({ question: 'How should I store metformin?' });
    expect(result.answered).toBe(true);
    expect(result.medicine.substance).toBe('metformin');
    const stored = kb.entries.find((e) => e.substance === 'metformin');
    expect(result.sections.storage.text).toBe(stored.storage);
  });

  it('answers a "what is it used for" question', () => {
    const result = service.answer({ medicineName: 'Amlodipine', question: 'What is it used for?' });
    expect(result.answered).toBe(true);
    expect(result.sections.uses.items.join(' ')).toMatch(/blood pressure/i);
  });

  it('resolves a brand name to the substance entry', () => {
    const result = service.answer({ medicineName: 'Dolo 650' });
    expect(result.answered).toBe(true);
    expect(result.medicine.substance).toBe('paracetamol');
  });

  it('returns every section when the question is general', () => {
    const result = service.answer({ medicineName: 'Aspirin' });
    expect(Object.keys(result.sections)).toEqual(
      expect.arrayContaining([
        'uses',
        'howItWorks',
        'precautions',
        'storage',
        'sideEffects',
        'whenToSeekHelp'
      ])
    );
  });

  it('honours an explicit topic', () => {
    const result = service.answer({ medicineName: 'Warfarin', topic: 'sideEffects' });
    expect(Object.keys(result.sections)).toEqual(['sideEffects']);
  });

  it('always includes safety guidance alongside a narrowed answer', () => {
    const result = service.answer({ question: 'side effects of ibuprofen' });
    expect(result.sections.whenToSeekHelp).toBeDefined();
  });

  it('always attaches a disclaimer and states it is not model-generated', () => {
    const result = service.answer({ medicineName: 'Metformin' });
    expect(result.disclaimer).toMatch(/CURATED DEMO CONTENT/i);
    expect(result.safetyNote).toMatch(/general information only/i);
    expect(result.generatedByModel).toBe(false);
    expect(result.source).toBe('curated_knowledge_base');
  });
});

describe('grounding — never invents an answer', () => {
  it('says a medicine is not in the knowledge base rather than guessing', () => {
    const result = service.answer({ medicineName: 'Unobtanium' });
    expect(result.answered).toBe(false);
    expect(result.reason).toBe('not_in_knowledge_base');
    expect(result.message).toMatch(/not in the MedGuardian medicine information base/i);
    expect(result.availableMedicines.length).toBe(kb.entries.length);
  });

  it('asks for a medicine name when nothing matches the question', () => {
    const result = service.answer({ question: 'tell me about quantum physics' });
    expect(result.answered).toBe(false);
    expect(result.reason).toBe('not_in_knowledge_base');
  });

  it('is deterministic', () => {
    const input = { question: 'What are the precautions for warfarin?' };
    expect(JSON.stringify(service.answer(input))).toBe(JSON.stringify(service.answer(input)));
  });

  it('handles empty input safely', () => {
    expect(service.answer({}).answered).toBe(false);
    expect(service.answer().answered).toBe(false);
  });
});

describe('searchEntries', () => {
  it('scores an exact medicine name far above an incidental word match', () => {
    const results = service.searchEntries('metformin');
    expect(results[0].entry.substance).toBe('metformin');
    expect(results[0].score).toBeGreaterThanOrEqual(10);
  });

  it('returns nothing for an unmatched query', () => {
    expect(service.searchEntries('zzzzqqqq')).toEqual([]);
    expect(service.searchEntries('')).toEqual([]);
  });
});

describe('knowledgeBaseInfo', () => {
  it('publishes the scope rules and confirms no model is involved', () => {
    const info = service.knowledgeBaseInfo();
    expect(info.generatedByModel).toBe(false);
    expect(info.method).toBe('curated-corpus-retrieval');
    expect(info.entryCount).toBe(kb.entries.length);
    expect(info.refusalRules.length).toBeGreaterThanOrEqual(7);
  });
});
