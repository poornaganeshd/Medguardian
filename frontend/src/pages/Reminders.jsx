import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { scheduleApi, intakeApi, medicineApi } from '../services/endpoints';
import useApi from '../hooks/useApi';
import useDoseRecorder from '../hooks/useDoseRecorder';
import { useToast } from '../context/ToastContext';
import DoseCard from '../components/DoseCard';
import SkipReasonModal from '../components/SkipReasonModal';
import { Card, Alert, Spinner, EmptyState, ErrorState, Modal, Field } from '../components/ui';
import { todayKey, addDays, formatDate } from '../utils/format';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Still to take' },
  { key: 'taken', label: 'Taken' },
  { key: 'skipped', label: 'Skipped' },
  { key: 'missed', label: 'Missed' }
];

/**
 * The visual reminder screen.
 *
 * Browser notifications are requested (never spoken audio — outside project
 * scope) and fired for doses that become due while the page is open.
 */
export default function Reminders() {
  const toast = useToast();
  const [date, setDate] = useState(todayKey());
  const [filter, setFilter] = useState('all');
  const [prnOpen, setPrnOpen] = useState(false);
  const [notificationsOn, setNotificationsOn] = useState(
    typeof Notification !== 'undefined' && Notification.permission === 'granted'
  );

  const { data, loading, error, reload } = useApi(
    () => scheduleApi.occurrences({ date }),
    [date]
  );
  const recorder = useDoseRecorder(reload);

  // Refresh every two minutes so "due" and "late" stay accurate while the
  // page sits open on a kitchen tablet.
  useEffect(() => {
    const timer = setInterval(() => reload().catch(() => {}), 120000);
    return () => clearInterval(timer);
  }, [reload]);

  // Fire a browser notification when a dose becomes due.
  useEffect(() => {
    if (!notificationsOn || !data?.items) return;
    const dueNow = data.items.filter((o) => o.status === 'due');
    for (const occurrence of dueNow) {
      const key = `mg.notified.${occurrence.scheduleId}.${occurrence.dateKey}.${occurrence.time}`;
      if (sessionStorage.getItem(key)) continue;
      sessionStorage.setItem(key, '1');
      try {
        // eslint-disable-next-line no-new
        new Notification(`Time for ${occurrence.medicine?.name || 'your medicine'}`, {
          body: `${occurrence.time} · ${occurrence.doseQuantity} ${occurrence.medicine?.unit || 'dose'}(s)`,
          icon: occurrence.medicine?.image?.filename
            ? medicineApi.imageUrl(occurrence.medicine.id, 'thumbnail')
            : undefined,
          tag: key
        });
      } catch {
        /* notification support varies by browser */
      }
    }
  }, [data, notificationsOn]);

  const enableNotifications = async () => {
    if (typeof Notification === 'undefined') {
      toast.warning('This browser does not support notifications.');
      return;
    }
    const permission = await Notification.requestPermission();
    setNotificationsOn(permission === 'granted');
    if (permission === 'granted') toast.success('Visual reminders enabled for this browser.');
    else toast.warning('Notifications were not allowed. Reminders still show on this page.');
  };

  const items = (data?.items || []).filter((o) => {
    if (filter === 'all') return true;
    if (filter === 'pending') return ['due', 'late', 'upcoming'].includes(o.status);
    return o.status === filter;
  });

  const summary = data?.summary || { total: 0 };

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="mb-0">Reminders</h1>
          <p className="page__subtitle">{formatDate(date, 'dddd, D MMMM YYYY')}</p>
        </div>
        <div className="row">
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={() => setDate(addDays(date, -1))}
          >
            ← Previous day
          </button>
          <input
            className="input"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            style={{ width: 'auto' }}
            aria-label="Choose a date"
          />
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={() => setDate(addDays(date, 1))}
          >
            Next day →
          </button>
          {date !== todayKey() && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setDate(todayKey())}>
              Today
            </button>
          )}
        </div>
      </div>

      {!notificationsOn && (
        <Alert variant="info" title="Turn on visual reminders">
          <p className="mb-2">
            MedGuardian can show a browser notification with your medicine's photo when a dose is
            due. There are no spoken alerts.
          </p>
          <button type="button" className="btn btn--primary btn--sm" onClick={enableNotifications}>
            Enable browser notifications
          </button>
        </Alert>
      )}

      <div className="row row--between mb-4">
        <div className="tabs" style={{ borderBottom: 'none', marginBottom: 0 }}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`tab ${filter === f.key ? 'tab--active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              {f.key !== 'all' && summary[f.key] ? ` (${summary[f.key]})` : ''}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => setPrnOpen(true)}>
          + Record an as-needed dose
        </button>
      </div>

      {loading && !data ? (
        <Spinner large label="Loading your doses…" />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={summary.total === 0 ? '🗓️' : '🔍'}
            title={summary.total === 0 ? 'No doses scheduled for this day' : 'Nothing matches this filter'}
            action={
              summary.total === 0 ? (
                <Link to="/schedules" className="btn btn--primary btn--sm">
                  Set up a schedule
                </Link>
              ) : (
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => setFilter('all')}>
                  Show all doses
                </button>
              )
            }
          >
            {summary.total === 0
              ? 'Add a medicine and give it a schedule to see reminders here.'
              : `There are ${summary.total} dose(s) on this day.`}
          </EmptyState>
        </Card>
      ) : (
        <div className="stack">
          {items.map((occurrence) => (
            <DoseCard
              key={`${occurrence.scheduleId}-${occurrence.dateKey}-${occurrence.time}-${occurrence.intakeId || 'x'}`}
              occurrence={occurrence}
              onRecord={date <= todayKey() ? recorder.record : undefined}
              busy={recorder.isBusy(occurrence)}
            />
          ))}
        </div>
      )}

      {recorder.skipTarget && (
        <SkipReasonModal
          occurrence={recorder.skipTarget}
          onCancel={recorder.cancelSkip}
          onConfirm={recorder.confirmSkip}
          busy={Boolean(recorder.busyKey)}
        />
      )}

      {prnOpen && <AsNeededModal onClose={() => setPrnOpen(false)} onSaved={reload} />}
    </>
  );
}

/** Records a dose of an as-needed (PRN) medicine. */
function AsNeededModal({ onClose, onSaved }) {
  const toast = useToast();
  const { data, loading } = useApi(() => medicineApi.list({ limit: 100 }), []);
  const [medicine, setMedicine] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const result = await intakeApi.recordAsNeeded({
        medicine,
        doseQuantity: Number(quantity),
        notes: notes || undefined
      });
      toast.success(
        result.stockWarning || `Recorded. ${result.medicine.currentStock} left in stock.`
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
      title="Record an as-needed dose"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy || !medicine}
            onClick={submit}
          >
            {busy ? 'Saving…' : 'Record dose'}
          </button>
        </>
      }
    >
      <p className="text-sm text-muted">
        For medicines you take only when you need them. These doses are deducted from your stock but
        never counted in your adherence score.
      </p>

      <Field label="Medicine" htmlFor="prn-medicine" required>
        <select
          id="prn-medicine"
          className="select"
          value={medicine}
          onChange={(event) => setMedicine(event.target.value)}
          disabled={loading}
        >
          <option value="">Choose a medicine…</option>
          {(data?.items || []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} {m.strength || ''}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Amount taken" htmlFor="prn-quantity">
        <input
          id="prn-quantity"
          className="input"
          type="number"
          min="0.25"
          step="0.25"
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
        />
      </Field>

      <Field label="Notes" htmlFor="prn-notes" hint="Optional — for example why you needed it.">
        <textarea
          id="prn-notes"
          className="textarea"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          maxLength={500}
        />
      </Field>
    </Modal>
  );
}
