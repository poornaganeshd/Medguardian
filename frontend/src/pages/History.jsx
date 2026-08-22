import { useState } from 'react';
import { intakeApi, medicineApi } from '../services/endpoints';
import useApi from '../hooks/useApi';
import { useToast } from '../context/ToastContext';
import { Card, Badge, Spinner, EmptyState, ErrorState, Modal, Field } from '../components/ui';
import {
  formatDate,
  formatTime,
  formatClock,
  pluralUnit,
  SKIP_REASON_LABEL,
  addDays,
  todayKey
} from '../utils/format';

export default function History() {
  const toast = useToast();
  const [filters, setFilters] = useState({
    status: 'all',
    medicine: '',
    from: addDays(todayKey(), -29),
    to: todayKey()
  });
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);

  const { data, loading, error, reload } = useApi(
    () =>
      intakeApi.list({
        page,
        limit: 30,
        status: filters.status,
        medicine: filters.medicine || undefined,
        from: filters.from || undefined,
        to: filters.to || undefined
      }),
    [page, filters.status, filters.medicine, filters.from, filters.to]
  );
  const medicines = useApi(() => medicineApi.list({ limit: 100, status: 'all' }), []);

  const update = (field) => (event) => {
    setFilters((current) => ({ ...current, [field]: event.target.value }));
    setPage(1);
  };

  const items = data?.items || [];

  const remove = async (intake) => {
    try {
      await intakeApi.remove(intake.id);
      toast.success(
        intake.status === 'taken'
          ? 'Record removed and the dose returned to your stock.'
          : 'Record removed.'
      );
      reload();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="mb-0">Medication history</h1>
          <p className="page__subtitle">
            Every dose you recorded. {data ? `${data.total} record(s).` : ''}
          </p>
        </div>
      </div>

      <Card className="mb-4">
        <div className="form-grid">
          <Field label="Status" htmlFor="hist-status">
            <select id="hist-status" className="select" value={filters.status} onChange={update('status')}>
              <option value="all">Taken and skipped</option>
              <option value="taken">Taken only</option>
              <option value="skipped">Skipped only</option>
            </select>
          </Field>
          <Field label="Medicine" htmlFor="hist-medicine">
            <select id="hist-medicine" className="select" value={filters.medicine} onChange={update('medicine')}>
              <option value="">All medicines</option>
              {(medicines.data?.items || []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} {m.strength || ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="From" htmlFor="hist-from">
            <input id="hist-from" className="input" type="date" value={filters.from} onChange={update('from')} />
          </Field>
          <Field label="To" htmlFor="hist-to">
            <input id="hist-to" className="input" type="date" value={filters.to} onChange={update('to')} />
          </Field>
        </div>
      </Card>

      {loading && !data ? (
        <Spinner large label="Loading your history…" />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState icon="🕓" title="No dose records in this period">
            Records appear here as soon as you mark a dose taken or skipped.
          </EmptyState>
        </Card>
      ) : (
        <Card bodyClassName="table-wrap" title="Dose records">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Time</th>
                <th>Medicine</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Notes</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {items.map((intake) => (
                <tr key={intake.id}>
                  <td className="mono text-sm">{formatDate(intake.dateKey)}</td>
                  <td>
                    {intake.isAsNeeded ? (
                      <>
                        <span className="text-sm">{formatTime(intake.takenAt)}</span>
                        <Badge variant="info">PRN</Badge>
                      </>
                    ) : (
                      <>
                        <div className="text-sm">{formatClock(intake.scheduledTime)}</div>
                        {intake.wasLate && (
                          <span className="text-xs text-warning">
                            {intake.minutesLate} min late
                          </span>
                        )}
                      </>
                    )}
                  </td>
                  <td>
                    <strong>{intake.medicine?.name || 'Medicine'}</strong>
                    {intake.medicine?.strength && (
                      <div className="text-xs text-muted">{intake.medicine.strength}</div>
                    )}
                  </td>
                  <td className="text-sm">
                    {pluralUnit(intake.doseQuantity, intake.medicine?.unit || 'dose')}
                  </td>
                  <td>
                    <Badge variant={intake.status === 'taken' ? 'success' : 'neutral'}>
                      {intake.status === 'taken' ? 'Taken' : 'Skipped'}
                    </Badge>
                    {intake.status === 'skipped' && intake.skipReason && (
                      <div className="text-xs text-muted mt-2">
                        {SKIP_REASON_LABEL[intake.skipReason]}
                      </div>
                    )}
                  </td>
                  <td className="text-sm text-muted">{intake.notes || '—'}</td>
                  <td>
                    <div className="row">
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => setEditing(intake)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm text-danger"
                        onClick={() => remove(intake)}
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {data && data.pages > 1 && (
        <div className="row row--between mt-4">
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            ← Previous
          </button>
          <span className="text-sm text-muted">
            Page {data.page} of {data.pages}
          </span>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={page >= data.pages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next →
          </button>
        </div>
      )}

      {editing && (
        <EditIntakeModal
          intake={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </>
  );
}

function EditIntakeModal({ intake, onClose, onSaved }) {
  const toast = useToast();
  const [status, setStatus] = useState(intake.status);
  const [skipReason, setSkipReason] = useState(intake.skipReason || 'forgot');
  const [notes, setNotes] = useState(intake.notes || '');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const result = await intakeApi.update(intake.id, {
        status,
        skipReason: status === 'skipped' ? skipReason : null,
        notes
      });
      toast.success(
        `Record updated. Stock is now ${result.medicine.currentStock} ${intake.medicine?.unit || 'unit'}(s).`
      );
      onSaved();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Correct this dose record"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled={busy} onClick={submit}>
            {busy ? 'Saving…' : 'Save correction'}
          </button>
        </>
      }
    >
      <p className="text-sm text-muted">
        {intake.medicine?.name} · {formatDate(intake.dateKey)} · {formatClock(intake.scheduledTime)}
      </p>
      <p className="text-sm text-muted">
        Changing <strong>taken</strong> to <strong>skipped</strong> returns the dose to your stock,
        and the other way round deducts it.
      </p>

      <Field label="What actually happened" htmlFor="edit-status">
        <select
          id="edit-status"
          className="select"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="taken">I took it</option>
          <option value="skipped">I skipped it</option>
        </select>
      </Field>

      {status === 'skipped' && (
        <Field label="Reason" htmlFor="edit-reason">
          <select
            id="edit-reason"
            className="select"
            value={skipReason}
            onChange={(event) => setSkipReason(event.target.value)}
          >
            {Object.entries(SKIP_REASON_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label="Notes" htmlFor="edit-notes">
        <textarea
          id="edit-notes"
          className="textarea"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          maxLength={500}
        />
      </Field>
    </Modal>
  );
}
