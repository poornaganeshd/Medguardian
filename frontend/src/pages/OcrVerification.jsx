import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { recordApi } from '../services/endpoints';
import useApi from '../hooks/useApi';
import { useToast } from '../context/ToastContext';
import { Card, Alert, Badge, Spinner, ErrorState, EmptyState, Field } from '../components/ui';

/**
 * The OCR verification screen.
 *
 * This exists so that automatic text recognition can never quietly put a wrong
 * medicine on a patient's list. Each suggestion starts UNCHECKED, every field
 * is editable, and only the rows the user ticks are sent to the server.
 */
export default function OcrVerification() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [saving, setSaving] = useState(false);

  const { data, loading, error } = useApi(() => recordApi.get(id), [id]);

  useEffect(() => {
    const suggestions = data?.record?.ocr?.suggestedMedicines || [];
    setRows(
      suggestions.map((s) => ({
        accepted: false, // nothing is pre-selected, on purpose
        name: s.suggestedName || s.normalizedName || '',
        genericName: s.normalizedName || '',
        strength: s.strength || '',
        dosageForm: s.dosageForm || '',
        initialQuantity: '',
        refillThreshold: '5',
        instructions: s.frequencyHint ? `Prescribed as: ${s.frequencyHint}` : '',
        rawText: s.rawText,
        confidence: s.confidence,
        matchedKnownSubstance: s.matchedKnownSubstance
      }))
    );
  }, [data]);

  if (loading) return <Spinner large label="Loading the suggestions…" />;
  if (error) return <ErrorState error={error} />;

  const record = data?.record;
  const ocr = record?.ocr || {};

  const update = (index, field, value) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, [field]: value } : row)));

  const acceptedRows = rows.filter((row) => row.accepted && row.name.trim());

  const confirm = async () => {
    setSaving(true);
    try {
      const result = await recordApi.confirmOcr(id, {
        accepted: acceptedRows.map((row) => ({
          name: row.name.trim(),
          genericName: row.genericName || undefined,
          strength: row.strength || undefined,
          dosageForm: row.dosageForm || undefined,
          initialQuantity: row.initialQuantity ? Number(row.initialQuantity) : undefined,
          currentStock: row.initialQuantity ? Number(row.initialQuantity) : undefined,
          refillThreshold: row.refillThreshold ? Number(row.refillThreshold) : undefined,
          instructions: row.instructions || undefined
        }))
      });
      toast.success(`${result.createdMedicines.length} medicine(s) added to your list.`);
      navigate('/medicines');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const rejectAll = async () => {
    setSaving(true);
    try {
      await recordApi.confirmOcr(id, { rejectAll: true });
      toast.notify('Suggestions discarded. Nothing was added to your medicine list.');
      navigate(`/records/${id}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="page__header">
        <div>
          <Link to={`/records/${id}`} className="text-sm">
            ← Back to the record
          </Link>
          <h1 className="mb-0 mt-2">Review what was read from your document</h1>
          <p className="page__subtitle">{record?.title}</p>
        </div>
      </div>

      <Alert variant="warning" title="Please check every line before saving">
        <p className="mb-0">
          Automatic text recognition frequently misreads handwriting, strengths and similar-looking
          names. <strong>Nothing here has been added to your medicine list.</strong> Tick only the
          entries you recognise, correct anything that is wrong, and check against the original
          prescription. If in doubt, leave it unticked and add the medicine manually.
        </p>
      </Alert>

      {ocr.status !== 'completed' ? (
        <Card>
          <EmptyState icon="🔍" title="There is nothing to review">
            OCR has not produced any results for this record.
          </EmptyState>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon="🔍"
            title="No medicines were recognised"
            action={
              <Link to="/medicines/new" className="btn btn--primary btn--sm">
                Add a medicine manually
              </Link>
            }
          >
            The text was extracted, but nothing in it looked like a medicine entry.
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="stack mb-5">
            {rows.map((row, index) => (
              <Card key={index}>
                <label className="checkbox mb-4">
                  <input
                    type="checkbox"
                    checked={row.accepted}
                    onChange={(event) => update(index, 'accepted', event.target.checked)}
                  />
                  <span className="checkbox__text">
                    <span className="checkbox__title">
                      Add this to my medicine list
                      {row.matchedKnownSubstance ? (
                        <> <Badge variant="success">Recognised substance</Badge></>
                      ) : (
                        <> <Badge variant="warning">Not a known substance</Badge></>
                      )}{' '}
                      <Badge variant="neutral">
                        Confidence {Math.round((row.confidence || 0) * 100)}%
                      </Badge>
                    </span>
                    <span className="checkbox__desc mono">Read from: “{row.rawText}”</span>
                  </span>
                </label>

                <div className="form-grid" style={{ opacity: row.accepted ? 1 : 0.55 }}>
                  <Field label="Medicine name" htmlFor={`name-${index}`} required>
                    <input
                      id={`name-${index}`}
                      className="input"
                      value={row.name}
                      onChange={(event) => update(index, 'name', event.target.value)}
                      disabled={!row.accepted}
                    />
                  </Field>
                  <Field label="Generic / substance" htmlFor={`generic-${index}`}>
                    <input
                      id={`generic-${index}`}
                      className="input"
                      value={row.genericName}
                      onChange={(event) => update(index, 'genericName', event.target.value)}
                      disabled={!row.accepted}
                    />
                  </Field>
                  <Field label="Strength" htmlFor={`strength-${index}`}>
                    <input
                      id={`strength-${index}`}
                      className="input"
                      value={row.strength}
                      onChange={(event) => update(index, 'strength', event.target.value)}
                      disabled={!row.accepted}
                    />
                  </Field>
                  <Field label="Quantity in the pack" htmlFor={`qty-${index}`}>
                    <input
                      id={`qty-${index}`}
                      className="input"
                      type="number"
                      min="0"
                      value={row.initialQuantity}
                      onChange={(event) => update(index, 'initialQuantity', event.target.value)}
                      disabled={!row.accepted}
                    />
                  </Field>
                  <Field label="Refill threshold" htmlFor={`thresh-${index}`}>
                    <input
                      id={`thresh-${index}`}
                      className="input"
                      type="number"
                      min="0"
                      value={row.refillThreshold}
                      onChange={(event) => update(index, 'refillThreshold', event.target.value)}
                      disabled={!row.accepted}
                    />
                  </Field>
                  <Field label="Instructions" htmlFor={`instr-${index}`}>
                    <input
                      id={`instr-${index}`}
                      className="input"
                      value={row.instructions}
                      onChange={(event) => update(index, 'instructions', event.target.value)}
                      disabled={!row.accepted}
                    />
                  </Field>
                </div>
              </Card>
            ))}
          </div>

          <div className="row row--between">
            <button type="button" className="btn btn--secondary" onClick={rejectAll} disabled={saving}>
              Discard all suggestions
            </button>
            <button
              type="button"
              className="btn btn--primary btn--lg"
              onClick={confirm}
              disabled={saving || acceptedRows.length === 0}
            >
              {saving
                ? 'Saving…'
                : `Add ${acceptedRows.length} verified medicine${acceptedRows.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </>
      )}
    </>
  );
}
