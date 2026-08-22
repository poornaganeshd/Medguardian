import { useState } from 'react';
import { Link } from 'react-router-dom';
import { interactionApi } from '../services/endpoints';
import useApi from '../hooks/useApi';
import { useToast } from '../context/ToastContext';
import { Card, Badge, Alert, Spinner, EmptyState, ErrorState, Field, Stat } from '../components/ui';
import { SEVERITY_VARIANT } from '../utils/format';

export default function Interactions() {
  const toast = useToast();
  const [tab, setTab] = useState('mine');
  const [names, setNames] = useState('');
  const [includeMine, setIncludeMine] = useState(true);
  const [adhoc, setAdhoc] = useState(null);
  const [checking, setChecking] = useState(false);

  const mine = useApi(() => interactionApi.myMedicines(), []);
  const dataset = useApi(() => interactionApi.dataset(), []);

  const runCheck = async (event) => {
    event.preventDefault();
    const list = names
      .split(/[\n,]/)
      .map((n) => n.trim())
      .filter(Boolean);
    if (!list.length) {
      toast.warning('Enter at least one medicine name.');
      return;
    }
    setChecking(true);
    try {
      setAdhoc(await interactionApi.check({ names: list, includeMyMedicines: includeMine }));
    } catch (error) {
      toast.error(error.message);
    } finally {
      setChecking(false);
    }
  };

  const result = tab === 'mine' ? mine.data : adhoc;

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="mb-0">Drug interaction check</h1>
          <p className="page__subtitle">
            A deterministic lookup against a fixed, reviewed dataset — nothing is generated.
          </p>
        </div>
      </div>

      {dataset.data?.dataset?.isDemoData && (
        <Alert variant="warning" title="This check uses demonstration data">
          <p className="mb-2">{dataset.data.dataset.demoDataNotice}</p>
          <p className="text-xs mb-0">
            Dataset: {dataset.data.dataset.name} v{dataset.data.dataset.version} ·{' '}
            {dataset.data.dataset.interactionCount} interaction records ·{' '}
            {dataset.data.dataset.duplicateGroupCount} duplicate-therapy groups · last reviewed{' '}
            {dataset.data.dataset.lastReviewed}.
          </p>
        </Alert>
      )}

      <div className="tabs">
        <button
          type="button"
          className={`tab ${tab === 'mine' ? 'tab--active' : ''}`}
          onClick={() => setTab('mine')}
        >
          My medicines
        </button>
        <button
          type="button"
          className={`tab ${tab === 'check' ? 'tab--active' : ''}`}
          onClick={() => setTab('check')}
        >
          Check something new
        </button>
      </div>

      {tab === 'check' && (
        <Card title="Check a medicine before you take it" className="mb-4">
          <form onSubmit={runCheck}>
            <Field
              label="Medicine names"
              htmlFor="check-names"
              hint="One per line, or separated by commas. Brand names work too."
            >
              <textarea
                id="check-names"
                className="textarea"
                value={names}
                onChange={(event) => setNames(event.target.value)}
                placeholder={'Ibuprofen 400mg\nCrocin'}
              />
            </Field>
            <label className="checkbox mb-4">
              <input
                type="checkbox"
                checked={includeMine}
                onChange={(event) => setIncludeMine(event.target.checked)}
              />
              <span className="checkbox__text">
                <span className="checkbox__title">Also check against my current medicines</span>
                <span className="checkbox__desc">
                  Recommended — this is how you find out whether something new clashes with what you
                  already take.
                </span>
              </span>
            </label>
            <button type="submit" className="btn btn--primary" disabled={checking}>
              {checking ? 'Checking…' : 'Run the check'}
            </button>
          </form>
        </Card>
      )}

      {tab === 'mine' && mine.loading && !mine.data ? (
        <Spinner large label="Checking your medicines…" />
      ) : tab === 'mine' && mine.error ? (
        <ErrorState error={mine.error} onRetry={mine.reload} />
      ) : !result ? (
        tab === 'check' && (
          <Card>
            <EmptyState icon="🔍" title="No check run yet">
              Enter one or more medicine names above and run the check.
            </EmptyState>
          </Card>
        )
      ) : (
        <Results result={result} />
      )}
    </>
  );
}

function Results({ result }) {
  const { summary, findings, duplicateTherapy, disclaimer } = result;

  return (
    <>
      <div className="grid grid--4 mb-5">
        <Stat label="Medicines checked" value={summary.medicinesChecked} meta={`${summary.checkedPairs} pair(s) compared`} />
        <Stat label="Major" value={summary.major} variant={summary.major > 0 ? 'red-600' : undefined} />
        <Stat label="Moderate" value={summary.moderate} />
        <Stat label="Duplicate therapy" value={summary.duplicateTherapyGroups} />
      </div>

      {findings.length === 0 && duplicateTherapy.length === 0 ? (
        <Card>
          <EmptyState icon="✅" title="No interactions found in this dataset">
            {disclaimer}
          </EmptyState>
        </Card>
      ) : (
        <div className="stack">
          {findings.map((finding) => (
            <Card key={`${finding.interactionId}-${finding.medicineA.name}-${finding.medicineB.name}`}>
              <div className="row row--between mb-3">
                <h3 className="mb-0">
                  {finding.medicineA.name} <span className="text-muted">+</span>{' '}
                  {finding.medicineB.name}
                </h3>
                <Badge variant={SEVERITY_VARIANT[finding.severity]}>
                  {finding.severity.toUpperCase()}
                </Badge>
              </div>
              <p>{finding.description}</p>
              {finding.mechanism && (
                <p className="text-sm text-muted">
                  <strong>Why:</strong> {finding.mechanism}
                </p>
              )}
              <h4 className="mt-4">What to do</h4>
              <ul className="text-sm">
                {finding.precautions.map((precaution, index) => (
                  <li key={index}>{precaution}</li>
                ))}
              </ul>
              <div className="text-xs text-muted">
                Matched on: {finding.medicineA.substance} + {finding.medicineB.substance} · dataset
                record {finding.interactionId}
              </div>
            </Card>
          ))}

          {duplicateTherapy.map((group) => (
            <Card key={group.groupId}>
              <div className="row row--between mb-3">
                <h3 className="mb-0">Duplicate therapy: {group.groupName}</h3>
                <Badge variant={SEVERITY_VARIANT[group.severity]}>
                  {group.severity.toUpperCase()}
                </Badge>
              </div>
              <p>{group.description}</p>
              <p className="text-sm">
                <strong>In your list:</strong> {group.medicines.map((m) => m.name).join(', ')}
              </p>
              <ul className="text-sm">
                {group.precautions.map((precaution, index) => (
                  <li key={index}>{precaution}</li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}

      <Alert variant="neutral" title="Important" icon="ℹ️">
        <p className="mb-0">{disclaimer}</p>
      </Alert>

      <p className="text-xs text-muted">
        Method: {result.method}. Every severity, description and precaution above is copied verbatim
        from the dataset file in this project — no language model is involved in producing them.{' '}
        <Link to="/medicine-info">General medicine information</Link> is handled separately.
      </p>
    </>
  );
}
