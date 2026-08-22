import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { medicineApi, scheduleApi, analyticsApi } from '../services/endpoints';
import useApi from '../hooks/useApi';
import useStepUp from '../hooks/useStepUp';
import { useToast } from '../context/ToastContext';
import PinGate from '../components/PinGate';
import {
  Card,
  Badge,
  Alert,
  Spinner,
  ErrorState,
  Modal,
  Field,
  Meter,
  EmptyState
} from '../components/ui';
import {
  formatDate,
  pluralUnit,
  formatClock,
  FREQUENCY_LABEL,
  DAY_NAMES,
  URGENCY_LABEL,
  URGENCY_VARIANT
} from '../utils/format';

export default function MedicineDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const stepUp = useStepUp();

  const [stockModal, setStockModal] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const medicineQuery = useApi(() => medicineApi.get(id), [id]);
  const scheduleQuery = useApi(() => scheduleApi.list({ medicine: id, status: 'all' }), [id]);
  const refillQuery = useApi(() => analyticsApi.refillFor(id), [id]);

  if (medicineQuery.loading) return <Spinner large label="Loading medicine…" />;
  if (medicineQuery.error) return <ErrorState error={medicineQuery.error} onRetry={medicineQuery.reload} />;

  const medicine = medicineQuery.data?.medicine;
  if (!medicine) return null;

  const prediction = refillQuery.data?.prediction;
  const schedules = scheduleQuery.data?.items || [];

  const remove = async () => {
    try {
      await stepUp.run(() => medicineApi.remove(id), 'delete this medicine');
      toast.success('Medicine deleted, along with its schedules and dose history.');
      navigate('/medicines');
    } catch (error) {
      if (!error.cancelled) toast.error(error.message);
    } finally {
      setConfirmDelete(false);
    }
  };

  const stockPct =
    medicine.initialQuantity > 0 ? (medicine.currentStock / medicine.initialQuantity) * 100 : 0;

  return (
    <>
      <div className="page__header">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          {medicine.image?.filename ? (
            <img
              className="medicine-thumb medicine-thumb--lg"
              src={medicineApi.imageUrl(medicine.id)}
              alt={`Photo of ${medicine.name}`}
            />
          ) : (
            <div className="medicine-thumb medicine-thumb--lg medicine-thumb--placeholder" aria-hidden="true">
              💊
            </div>
          )}
          <div>
            <h1 className="mb-0">
              {medicine.name} {medicine.strength && <span className="text-muted">{medicine.strength}</span>}
            </h1>
            <p className="page__subtitle">
              {medicine.genericName && `${medicine.genericName} · `}
              <span style={{ textTransform: 'capitalize' }}>{medicine.dosageForm}</span>
              {medicine.purpose && ` · ${medicine.purpose}`}
            </p>
            <div className="row">
              {!medicine.isActive && <Badge variant="neutral">Archived</Badge>}
              {medicine.needsRefill && (
                <Badge variant={medicine.currentStock <= 0 ? 'danger' : 'warning'}>
                  {medicine.currentStock <= 0 ? 'Out of stock' : 'Needs refill'}
                </Badge>
              )}
              {medicine.isExpired && <Badge variant="danger">Past expiry</Badge>}
            </div>
          </div>
        </div>
        <div className="row">
          <Link to={`/medicines/${id}/edit`} className="btn btn--secondary">
            Edit
          </Link>
          <button type="button" className="btn btn--danger" onClick={() => setConfirmDelete(true)}>
            Delete
          </button>
        </div>
      </div>

      {medicine.isExpired && (
        <Alert variant="danger" title="This medicine is past its expiry date">
          It expired on {formatDate(medicine.expiryDate)}. Check with your pharmacist before taking
          any more of it.
        </Alert>
      )}

      <div className="grid grid--2" style={{ alignItems: 'start' }}>
        <div className="stack">
          {/* ------------------------------------------------------- stock */}
          <Card
            title="Stock"
            actions={
              <div className="row">
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  onClick={() => setStockModal('refill')}
                >
                  Record a refill
                </button>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => setStockModal('correction')}
                >
                  Correct count
                </button>
              </div>
            }
          >
            <div className="row row--between mb-2">
              <span className="stat__value">{pluralUnit(medicine.currentStock, medicine.unit)}</span>
              <span className="text-sm text-muted">
                of {pluralUnit(medicine.initialQuantity, medicine.unit)}
              </span>
            </div>
            <Meter
              value={stockPct}
              variant={medicine.needsRefill ? (medicine.currentStock <= 0 ? 'danger' : 'warning') : undefined}
            />
            <div className="grid grid--2 mt-4 text-sm">
              <div>
                <div className="text-muted text-xs">Refill threshold</div>
                <strong>{pluralUnit(medicine.refillThreshold, medicine.unit)}</strong>
              </div>
              <div>
                <div className="text-muted text-xs">Last refill</div>
                <strong>
                  {medicine.lastRefillAt
                    ? `${formatDate(medicine.lastRefillAt)} (+${medicine.lastRefillQuantity})`
                    : 'Not recorded'}
                </strong>
              </div>
            </div>
          </Card>

          {/* ------------------------------------------------------- DRPA */}
          <Card title="Refill prediction (DRPA)">
            {refillQuery.loading ? (
              <Spinner label="Calculating…" />
            ) : !prediction ? (
              <EmptyState icon="🔮" title="No prediction available" />
            ) : (
              <>
                <div className="row row--between mb-3">
                  <div>
                    <div className="stat__value">
                      {prediction.prediction.daysOfSupply === null
                        ? '—'
                        : `${prediction.prediction.daysOfSupply} days`}
                    </div>
                    <div className="text-sm text-muted">
                      {prediction.prediction.runOutDate
                        ? `Runs out around ${formatDate(prediction.prediction.runOutDate)}`
                        : 'No run-out date can be projected'}
                    </div>
                  </div>
                  <Badge variant={URGENCY_VARIANT[prediction.prediction.urgency]}>
                    {URGENCY_LABEL[prediction.prediction.urgency]}
                  </Badge>
                </div>

                <div className="table-wrap">
                  <table className="table">
                    <tbody>
                      <tr>
                        <td className="text-muted">Scheduled use</td>
                        <td>{prediction.rates.scheduledPerDay} {medicine.unit}(s)/day</td>
                      </tr>
                      <tr>
                        <td className="text-muted">Actually taken</td>
                        <td>
                          {prediction.rates.observedPerDay === null
                            ? 'No history yet'
                            : `${prediction.rates.observedPerDay} ${medicine.unit}(s)/day`}
                        </td>
                      </tr>
                      <tr>
                        <td className="text-muted">Rate used</td>
                        <td>
                          <strong>{prediction.rates.effectivePerDay} {medicine.unit}(s)/day</strong>
                          <div className="text-xs text-muted">
                            {Math.round(prediction.rates.confidenceWeight * 100)}% weight on your
                            own history
                          </div>
                        </td>
                      </tr>
                      <tr>
                        <td className="text-muted">Skipped, not deducted</td>
                        <td>
                          {prediction.consumption.skippedDoses} dose(s) (
                          {prediction.consumption.skippedQuantityNotDeducted} {medicine.unit}s)
                        </td>
                      </tr>
                      <tr>
                        <td className="text-muted">Suggested reorder</td>
                        <td>
                          {formatDate(prediction.prediction.suggestedRefillDate)} ·{' '}
                          {prediction.prediction.suggestedRefillQuantity} {medicine.unit}(s) for 30 days
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <details className="mt-4">
                  <summary className="text-sm font-semibold" style={{ cursor: 'pointer' }}>
                    How this was calculated
                  </summary>
                  <ul className="text-sm text-muted mt-2">
                    {prediction.explanation.map((line, index) => (
                      <li key={index}>{line}</li>
                    ))}
                  </ul>
                  <p className="text-xs text-muted mb-0">
                    Linear regression:{' '}
                    {prediction.regression.used
                      ? `used (slope ${prediction.regression.slopePerDay}/day, r² ${prediction.regression.r2}, ${prediction.regression.samples} samples)`
                      : `not used — ${prediction.regression.reasonIfUnused}`}
                  </p>
                </details>
              </>
            )}
          </Card>
        </div>

        <div className="stack">
          {/* --------------------------------------------------- schedules */}
          <Card
            title="Schedules"
            actions={
              <Link to="/schedules" className="btn btn--secondary btn--sm">
                Manage schedules
              </Link>
            }
          >
            {scheduleQuery.loading ? (
              <Spinner label="Loading…" />
            ) : schedules.length === 0 ? (
              <EmptyState
                icon="📅"
                title="No schedule yet"
                action={
                  <Link to="/schedules" className="btn btn--primary btn--sm">
                    Add a schedule
                  </Link>
                }
              >
                Add one to get reminders for this medicine.
              </EmptyState>
            ) : (
              <div className="stack">
                {schedules.map((schedule) => (
                  <div
                    key={schedule.id}
                    style={{
                      padding: 'var(--space-3)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)'
                    }}
                  >
                    <div className="row row--between mb-2">
                      <strong>{FREQUENCY_LABEL[schedule.frequency]}</strong>
                      <Badge variant={schedule.isActive ? 'success' : 'neutral'}>
                        {schedule.isActive ? 'Active' : 'Paused'}
                      </Badge>
                    </div>
                    {schedule.frequency === 'specific_days' && (
                      <div className="text-sm text-muted">
                        {schedule.daysOfWeek?.map((d) => DAY_NAMES[d]).join(', ')}
                      </div>
                    )}
                    {schedule.frequency === 'interval' && (
                      <div className="text-sm text-muted">Every {schedule.intervalDays} day(s)</div>
                    )}
                    <div className="row mt-2">
                      {schedule.times?.map((t) => (
                        <Badge key={t.time} variant="primary">
                          {formatClock(t.time)} · {t.doseQuantity}
                        </Badge>
                      ))}
                      {schedule.frequency === 'as_needed' && <Badge variant="info">As needed</Badge>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* ------------------------------------------------------ details */}
          <Card title="Details">
            <dl className="text-sm" style={{ margin: 0 }}>
              {[
                ['Instructions', medicine.instructions],
                ['Prescriber notes', medicine.prescriberNotes],
                ['Prescribed by', medicine.prescribedBy],
                ['Manufacturer', medicine.manufacturer],
                ['Appearance', [medicine.color, medicine.shape].filter(Boolean).join(', ')],
                ['Storage', medicine.storageInstructions],
                ['Expiry', medicine.expiryDate ? formatDate(medicine.expiryDate) : null],
                ['Added', formatDate(medicine.createdAt)]
              ]
                .filter(([, value]) => value)
                .map(([label, value]) => (
                  <div key={label} style={{ marginBottom: 'var(--space-3)' }}>
                    <dt className="text-muted text-xs">{label}</dt>
                    <dd style={{ margin: 0 }}>{value}</dd>
                  </div>
                ))}
            </dl>
            <Link to="/medicine-info" className="btn btn--secondary btn--sm mt-2">
              📚 General information about this medicine
            </Link>
          </Card>
        </div>
      </div>

      {stockModal && (
        <StockModal
          medicine={medicine}
          mode={stockModal}
          onClose={() => setStockModal(null)}
          onSaved={() => {
            medicineQuery.reload();
            refillQuery.reload();
          }}
        />
      )}

      {confirmDelete && (
        <Modal
          title="Delete this medicine?"
          onClose={() => setConfirmDelete(false)}
          footer={
            <>
              <button type="button" className="btn btn--secondary" onClick={() => setConfirmDelete(false)}>
                Keep it
              </button>
              <button type="button" className="btn btn--danger" onClick={remove}>
                Delete permanently
              </button>
            </>
          }
        >
          <Alert variant="danger" title="This cannot be undone">
            Deleting <strong>{medicine.name}</strong> also removes its schedules and its entire dose
            history. Your adherence figures will change.
          </Alert>
          <p className="text-sm text-muted mb-0">
            If you have simply stopped taking it, edit the medicine and archive it instead — that
            keeps the history.
          </p>
        </Modal>
      )}

      {stepUp.gateProps && <PinGate {...stepUp.gateProps} />}
    </>
  );
}

function StockModal({ medicine, mode, onClose, onSaved }) {
  const toast = useToast();
  const [quantity, setQuantity] = useState(mode === 'refill' ? '' : String(medicine.currentStock));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const result = await medicineApi.adjustStock(medicine.id, {
        mode,
        quantity: Number(quantity),
        note: note || undefined
      });
      toast.success(
        mode === 'refill'
          ? `Refill recorded. You now have ${result.medicine.currentStock} ${medicine.unit}(s).`
          : `Stock corrected to ${result.medicine.currentStock} ${medicine.unit}(s).`
      );
      await onSaved?.();
      onClose();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={mode === 'refill' ? 'Record a refill' : 'Correct the stock count'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled={busy || quantity === ''} onClick={submit}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <p className="text-sm text-muted">
        {mode === 'refill'
          ? `How many ${medicine.unit}(s) did you add? This is added to the ${medicine.currentStock} you already have.`
          : `Count what is actually in the pack and enter the exact number of ${medicine.unit}(s).`}
      </p>
      <Field label={mode === 'refill' ? 'Quantity added' : 'Actual quantity now'} htmlFor="stock-qty" required>
        <input
          id="stock-qty"
          className="input"
          type="number"
          min="0"
          step="0.5"
          autoFocus
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
        />
      </Field>
      <Field label="Note" htmlFor="stock-note" hint="Optional.">
        <input id="stock-note" className="input" value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
    </Modal>
  );
}
