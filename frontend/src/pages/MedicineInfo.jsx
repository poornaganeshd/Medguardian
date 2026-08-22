import { useState } from 'react';
import { Link } from 'react-router-dom';
import { assistantApi, medicineApi } from '../services/endpoints';
import useApi from '../hooks/useApi';
import { useToast } from '../context/ToastContext';
import { Card, Alert, Badge, Spinner, EmptyState, ErrorState, Field } from '../components/ui';

const TOPICS = [
  ['', 'Everything'],
  ['uses', 'What it is used for'],
  ['howItWorks', 'How it works'],
  ['precautions', 'General precautions'],
  ['storage', 'Storage'],
  ['sideEffects', 'Common side effects'],
  ['whenToSeekHelp', 'When to seek help']
];

export default function MedicineInfo() {
  const toast = useToast();
  const [question, setQuestion] = useState('');
  const [medicineName, setMedicineName] = useState('');
  const [topic, setTopic] = useState('');
  const [answer, setAnswer] = useState(null);
  const [asking, setAsking] = useState(false);

  const kb = useApi(() => assistantApi.knowledgeBase(), []);
  const myMedicines = useApi(() => medicineApi.list({ limit: 100 }), []);

  const ask = async (event) => {
    event?.preventDefault();
    if (!question && !medicineName) {
      toast.warning('Ask a question or choose a medicine.');
      return;
    }
    setAsking(true);
    try {
      setAnswer(
        await assistantApi.medicineInfo({
          question: question || undefined,
          medicineName: medicineName || undefined,
          topic: topic || undefined
        })
      );
    } catch (error) {
      toast.error(error.message);
    } finally {
      setAsking(false);
    }
  };

  const quickAsk = async (name) => {
    setMedicineName(name);
    setQuestion('');
    setAsking(true);
    try {
      setAnswer(await assistantApi.medicineInfo({ medicineName: name, topic: topic || undefined }));
    } catch (error) {
      toast.error(error.message);
    } finally {
      setAsking(false);
    }
  };

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="mb-0">Medicine information</h1>
          <p className="page__subtitle">
            General information retrieved from a small, reviewed library — nothing is generated.
          </p>
        </div>
      </div>

      <Alert variant="warning" title="What this can and cannot do">
        <p className="mb-2">
          <strong>It can</strong> explain in general terms what a medicine is for, how it broadly
          works, general precautions, how to store it, commonly reported side effects, and when to
          contact someone.
        </p>
        <p className="mb-0">
          <strong>It will not</strong> diagnose anything, recommend or prescribe a medicine, suggest
          a dose or a dose change, tell you whether to stop or continue treatment, or answer
          interaction questions — those go to the{' '}
          <Link to="/interactions">Drug Interactions</Link> screen, which uses a fixed dataset. For
          anything about your own situation, ask your doctor or pharmacist.
        </p>
      </Alert>

      <div className="grid grid--2" style={{ alignItems: 'start' }}>
        <div className="stack">
          <Card title="Ask about a medicine">
            <form onSubmit={ask}>
              <Field label="Your question" htmlFor="mi-question" hint="For example: how should I store metformin?">
                <textarea
                  id="mi-question"
                  className="textarea"
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  maxLength={500}
                  placeholder="How should I store metformin?"
                />
              </Field>
              <div className="form-grid">
                <Field label="Or pick a medicine" htmlFor="mi-medicine">
                  <input
                    id="mi-medicine"
                    className="input"
                    list="mi-medicine-list"
                    value={medicineName}
                    onChange={(event) => setMedicineName(event.target.value)}
                    placeholder="e.g. Metformin"
                  />
                  <datalist id="mi-medicine-list">
                    {(kb.data?.knowledgeBase?.medicines || []).map((m) => (
                      <option key={m.substance} value={m.displayName} />
                    ))}
                  </datalist>
                </Field>
                <Field label="Narrow to" htmlFor="mi-topic">
                  <select id="mi-topic" className="select" value={topic} onChange={(event) => setTopic(event.target.value)}>
                    {TOPICS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <button type="submit" className="btn btn--primary" disabled={asking}>
                {asking ? 'Looking it up…' : 'Look it up'}
              </button>
            </form>
          </Card>

          {myMedicines.data?.items?.length > 0 && (
            <Card title="Your medicines">
              <p className="text-sm text-muted">Tap one for general information about it.</p>
              <div className="row">
                {myMedicines.data.items.map((medicine) => (
                  <button
                    key={medicine.id}
                    type="button"
                    className="btn btn--secondary btn--sm"
                    onClick={() => quickAsk(medicine.genericName || medicine.name)}
                  >
                    {medicine.name}
                  </button>
                ))}
              </div>
            </Card>
          )}

          {kb.data && (
            <Card title="What is in this library">
              <p className="text-sm text-muted">
                {kb.data.knowledgeBase.entryCount} medicines, written for patients and stored in this
                project. The assistant can only answer about these.
              </p>
              <div className="row">
                {kb.data.knowledgeBase.medicines.map((m) => (
                  <button
                    key={m.substance}
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => quickAsk(m.displayName)}
                  >
                    {m.displayName}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted mt-3 mb-0">
                Method: {kb.data.knowledgeBase.method} · generated by a model:{' '}
                {String(kb.data.knowledgeBase.generatedByModel)}
              </p>
            </Card>
          )}
        </div>

        <div>
          {asking ? (
            <Spinner large label="Searching the library…" />
          ) : !answer ? (
            <Card>
              <EmptyState icon="📚" title="Ask something to get started">
                Try “what is amlodipine used for?” or “storage advice for levothyroxine”.
              </EmptyState>
            </Card>
          ) : (
            <AnswerPanel answer={answer} />
          )}
        </div>
      </div>
    </>
  );
}

function AnswerPanel({ answer }) {
  if (!answer.answered) {
    const variant = answer.urgent ? 'danger' : answer.reason === 'not_in_knowledge_base' ? 'info' : 'warning';
    return (
      <Card title="I cannot answer that">
        <Alert variant={variant} title={REASON_TITLE[answer.reason] || 'Outside what this can answer'}>
          <p className="mb-0">{answer.message}</p>
        </Alert>

        {answer.redirectTo === 'drug_interaction_checker' && (
          <Link to="/interactions" className="btn btn--primary">
            Go to the interaction check
          </Link>
        )}

        {answer.availableMedicines && (
          <>
            <h4 className="mt-4">Medicines this library covers</h4>
            <div className="row">
              {answer.availableMedicines.map((name) => (
                <Badge key={name} variant="neutral">
                  {name}
                </Badge>
              ))}
            </div>
          </>
        )}

        <p className="text-xs text-muted mt-4 mb-0">
          This refusal comes from an explicit safety rule in MedGuardian, not from a judgement call
          made at answer time.
        </p>
      </Card>
    );
  }

  return (
    <Card
      title={answer.medicine.displayName}
      actions={<Badge variant="primary">{answer.medicine.drugClass}</Badge>}
    >
      {Object.entries(answer.sections).map(([key, section]) => (
        <section key={key} className="mb-4">
          <h4>{section.title}</h4>
          {section.text ? (
            <p className="text-sm mb-0">{section.text}</p>
          ) : (
            <ul className="text-sm mb-0">
              {section.items.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          )}
        </section>
      ))}

      <Alert variant="neutral" title="Please read this">
        <p className="mb-0 text-sm">{answer.safetyNote}</p>
      </Alert>

      <p className="text-xs text-muted mb-0">
        Source: {answer.source} v{answer.knowledgeBaseVersion} · matched by {answer.matchType} ·
        generated by a model: {String(answer.generatedByModel)}
      </p>

      {answer.alternatives?.length > 0 && (
        <p className="text-xs text-muted mt-2 mb-0">
          Other close matches: {answer.alternatives.map((a) => a.displayName).join(', ')}
        </p>
      )}
    </Card>
  );
}

const REASON_TITLE = {
  diagnosis: 'That is a question for your doctor',
  prescribing: 'I cannot recommend a medicine',
  dosage_change: 'I cannot advise on doses',
  stop_or_continue: 'I cannot tell you to stop or continue',
  interaction: 'Interactions are checked elsewhere',
  emergency: 'This may need urgent attention',
  personal_circumstance: 'This needs advice tailored to you',
  not_in_knowledge_base: 'Not in this library'
};
