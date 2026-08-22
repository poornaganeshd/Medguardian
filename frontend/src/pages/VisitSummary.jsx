import { useState } from 'react';
import { Link } from 'react-router-dom';
import { assistantApi, recordApi } from '../services/endpoints';
import useApi from '../hooks/useApi';
import { useToast } from '../context/ToastContext';
import { Card, Alert, Badge, Spinner, EmptyState, Field } from '../components/ui';

export default function VisitSummary() {
  const toast = useToast();
  const [source, setSource] = useState('text');
  const [text, setText] = useState('');
  const [recordId, setRecordId] = useState('');
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(false);

  const records = useApi(() => recordApi.list({ limit: 50, hasFile: 'true' }), []);

  const summarise = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      setSummary(
        await assistantApi.visitSummary(
          source === 'text' ? { text } : { recordId }
        )
      );
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="mb-0">Visit summary</h1>
          <p className="page__subtitle">
            Reorganise a visit note or discharge summary into readable sections.
          </p>
        </div>
      </div>

      <Alert variant="info" title="This only reorganises your own document">
        <p className="mb-0">
          Every line in the summary is taken word-for-word from the text you supply. Nothing is
          interpreted, nothing is diagnosed, and nothing is added. It is a way of finding the
          important parts of a long document quickly — not a second opinion.
        </p>
      </Alert>

      <div className="grid grid--2" style={{ alignItems: 'start' }}>
        <Card title="What would you like summarised?">
          <form onSubmit={summarise}>
            <div className="tabs">
              <button
                type="button"
                className={`tab ${source === 'text' ? 'tab--active' : ''}`}
                onClick={() => setSource('text')}
              >
                Paste text
              </button>
              <button
                type="button"
                className={`tab ${source === 'record' ? 'tab--active' : ''}`}
                onClick={() => setSource('record')}
              >
                Use a stored record
              </button>
            </div>

            {source === 'text' ? (
              <Field
                label="Visit note or discharge summary"
                htmlFor="vs-text"
                hint="Type it out, or paste the text from a photo you have already had read."
              >
                <textarea
                  id="vs-text"
                  className="textarea"
                  style={{ minHeight: 260 }}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  maxLength={50000}
                  placeholder={
                    'C/O headache since last week\nBP 150/95\nAdvised: reduce salt\nRx\n1. Tab Amlodipine 5mg 1-0-0\nFollow up after 4 weeks'
                  }
                />
              </Field>
            ) : (
              <Field
                label="Choose a record"
                htmlFor="vs-record"
                hint="Only records that already have extracted text can be summarised."
              >
                <select
                  id="vs-record"
                  className="select"
                  value={recordId}
                  onChange={(event) => setRecordId(event.target.value)}
                >
                  <option value="">Choose a record…</option>
                  {(records.data?.items || []).map((record) => (
                    <option key={record.id} value={record.id}>
                      {record.title} ({record.category})
                    </option>
                  ))}
                </select>
              </Field>
            )}

            <button
              type="submit"
              className="btn btn--primary"
              disabled={busy || (source === 'text' ? !text.trim() : !recordId)}
            >
              {busy ? 'Summarising…' : 'Create summary'}
            </button>
          </form>

          {source === 'record' && records.data?.items?.length === 0 && (
            <Alert variant="neutral" title="No suitable records yet">
              <p className="mb-2">
                Upload a photo of a prescription or report and run OCR on it first.
              </p>
              <Link to="/records" className="btn btn--secondary btn--sm">
                Go to medical records
              </Link>
            </Alert>
          )}
        </Card>

        <div>
          {busy ? (
            <Spinner large label="Reading your document…" />
          ) : !summary ? (
            <Card>
              <EmptyState icon="📝" title="Nothing summarised yet">
                Paste a visit note on the left, or choose a stored record.
              </EmptyState>
            </Card>
          ) : !summary.summarised ? (
            <Card>
              <Alert variant="warning" title="Nothing to summarise">
                {summary.message}
              </Alert>
            </Card>
          ) : (
            <SummaryPanel summary={summary} />
          )}
        </div>
      </div>
    </>
  );
}

function SummaryPanel({ summary }) {
  return (
    <div className="stack">
      <Card title={summary.title}>
        {summary.provider.length > 0 && (
          <p className="text-sm text-muted">{summary.provider.join(' · ')}</p>
        )}
        {summary.datesFound.length > 0 && (
          <div className="row mb-3">
            {summary.datesFound.map((date) => (
              <Badge key={date} variant="neutral">
                📅 {date}
              </Badge>
            ))}
          </div>
        )}

        {summary.sections.map((section) => (
          <section key={section.key} className="mb-4">
            <h4>{section.title}</h4>
            <ul className="text-sm mb-0">
              {section.lines.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          </section>
        ))}

        {summary.otherNotes.length > 0 && (
          <details>
            <summary className="text-sm font-semibold" style={{ cursor: 'pointer' }}>
              Other lines from the document ({summary.otherNotes.length})
            </summary>
            <ul className="text-sm mt-2 mb-0">
              {summary.otherNotes.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          </details>
        )}

        <p className="text-xs text-muted mt-4 mb-0">
          {summary.stats.classifiedLines} of {summary.stats.sourceLines} lines were grouped ·{' '}
          method: {summary.method} · diagnostic: {String(summary.isDiagnostic)} · generated by a
          model: {String(summary.generatedByModel)}
        </p>
      </Card>

      {summary.medicines?.length > 0 && (
        <Card title="Medicines mentioned in the document">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Medicine</th>
                  <th>Strength</th>
                  <th>Form</th>
                  <th>Frequency</th>
                </tr>
              </thead>
              <tbody>
                {summary.medicines.map((medicine, index) => (
                  <tr key={index}>
                    <td>
                      <strong>{medicine.suggestedName}</strong>
                      <div className="text-xs text-muted mono">{medicine.rawText}</div>
                    </td>
                    <td>{medicine.strength || '—'}</td>
                    <td>{medicine.dosageForm || '—'}</td>
                    <td>{medicine.frequencyHint || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted mt-3 mb-0">
            These were read from the text automatically and may be wrong. Nothing here has been
            added to your medicine list.
          </p>
        </Card>
      )}

      {summary.reconciliation && (
        <Card title="Compared with your medicine list">
          <div className="grid grid--3">
            <div>
              <h4 className="text-sm">On both ({summary.reconciliation.inBoth.length})</h4>
              <ul className="text-sm text-muted">
                {summary.reconciliation.inBoth.map((entry) => (
                  <li key={entry.substance}>{entry.yourList.name}</li>
                ))}
                {summary.reconciliation.inBoth.length === 0 && <li>—</li>}
              </ul>
            </div>
            <div>
              <h4 className="text-sm">Only in the document ({summary.reconciliation.onlyInDocument.length})</h4>
              <ul className="text-sm text-muted">
                {summary.reconciliation.onlyInDocument.map((entry) => (
                  <li key={entry.substance}>{entry.document.suggestedName || entry.substance}</li>
                ))}
                {summary.reconciliation.onlyInDocument.length === 0 && <li>—</li>}
              </ul>
            </div>
            <div>
              <h4 className="text-sm">Only on your list ({summary.reconciliation.onlyOnYourList.length})</h4>
              <ul className="text-sm text-muted">
                {summary.reconciliation.onlyOnYourList.map((entry) => (
                  <li key={entry.substance}>{entry.yourList.name}</li>
                ))}
                {summary.reconciliation.onlyOnYourList.length === 0 && <li>—</li>}
              </ul>
            </div>
          </div>
          <Alert variant="neutral" title="A name comparison only">
            <p className="mb-0 text-sm">{summary.reconciliation.note}</p>
          </Alert>
        </Card>
      )}

      <Alert variant="neutral" title="Important">
        <p className="mb-0 text-sm">{summary.disclaimer}</p>
      </Alert>
    </div>
  );
}
