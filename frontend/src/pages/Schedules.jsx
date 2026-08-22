import { useState } from 'react';
import { Link } from 'react-router-dom';
import { scheduleApi, medicineApi } from '../services/endpoints';
import useApi from '../hooks/useApi';
import { useToast } from '../context/ToastContext';
import { Card, Badge, Alert, Spinner, EmptyState, ErrorState, Modal, Field } from '../components/ui';
import { FREQUENCY_LABEL, DAY_NAMES, formatClock, formatDate, todayKey } from '../utils/format';

const MEAL_OPTIONS = [
  ['any', 'Any time'],
  ['before_meal', 'Before food'],
  ['with_meal', 'With food'],
  ['after_meal', 'After food'],
  ['empty_stomach', 'On an empty stomach']
];

export default function Schedules() {
  const toast = useToast();
  const [status, setStatus] = useState('all');
  const [editing, setEditing] = useState(null);

  const { data, loading, error, reload } = useApi(() => scheduleApi.list({ status }), [status]);
  const medicines = useApi(() => medicineApi.list({ limit: 100 }), []);

  const schedules = data?.items || [];

  const toggle = async (schedule) => {
    try {
      await scheduleApi.setStatus(schedule.id, { isActive: !schedule.isActive });
      toast.success(schedule.isActive ? 'Schedule paused.' : 'Schedule resumed.');
      reload();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const remove = async (schedule) => {
    try {
      const result = await scheduleApi.remove(schedule.id);
      toast.success(
        `Schedule deleted${result.removedIntakes ? ` along with ${result.removedIntakes} dose record(s)` : ''}.`
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
          <h1 className="mb-0">Medication schedules</h1>
          <p className="page__subtitle">When each medicine should be taken.</p>
        </div>
        <div className="row">
          <select
            className="select"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            style={{ width: 'auto' }}
            aria-label="Filter by status"
          >
            <option value="all">All schedules</option>
            <option value="active">Active only</option>
            <option value="inactive">Paused only</option>
          </select>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => setEditing({})}
            disabled={!medicines.data?.items?.length}
          >
            + New schedule
          </button>
        </div>
      </div>

      {medicines.data && medicines.data.items.length === 0 && (
        <Alert variant="info" title="Add a medicine first">
          <p className="mb-2">A schedule needs a medicine to attach to.</p>
          <Link to="/medicines/new" className="btn btn--primary btn--sm">
            Add a medicine
          </Link>
        </Alert>
      )}

      {loading && !data ? (
        <Spinner large label="Loading schedules…" />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : schedules.length === 0 ? (
        <Card>
          <EmptyState icon="📅" title="No schedules yet">
            Create a schedule so MedGuardian knows when to remind you.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid grid--2">
          {schedules.map((schedule) => (
            <ScheduleCard
              key={schedule.id}
              schedule={schedule}
              onToggle={() => toggle(schedule)}
              onEdit={() => setEditing(schedule)}
              onDelete={() => remove(schedule)}
            />
          ))}
        </div>
      )}

      {editing && (
        <ScheduleModal
          schedule={editing.id ? editing : null}
          medicines={medicines.data?.items || []}
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

function ScheduleCard({ schedule, onToggle, onEdit, onDelete }) {
  const [confirm, setConfirm] = useState(false);
  const medicine = schedule.medicine || {};

  return (
    <>
      <article className="card">
        <div className="card__body">
          <div className="row mb-3" style={{ alignItems: 'flex-start' }}>
            {medicine.image?.filename ? (
              <img
                className="medicine-thumb"
                src={medicineApi.imageUrl(medicine.id || medicine._id, 'thumbnail')}
                alt={`Photo of ${medicine.name}`}
              />
            ) : (
              <div className="medicine-thumb medicine-thumb--placeholder" aria-hidden="true">
                💊
              </div>
            )}
            <div className="flex-1">
              <strong>{medicine.name || 'Medicine'}</strong>{' '}
              {medicine.strength && <span className="text-muted">{medicine.strength}</span>}
              <div className="text-sm text-muted">{FREQUENCY_LABEL[schedule.frequency]}</div>
            </div>
            <Badge variant={schedule.isActive ? 'success' : 'neutral'}>
              {schedule.isActive ? 'Active' : 'Paused'}
            </Badge>
          </div>

          {schedule.frequency === 'specific_days' && (
            <div className="row mb-3">
              {DAY_NAMES.map((day, index) => (
                <span
                  key={day}
                  className={`badge ${
                    schedule.daysOfWeek?.includes(index) ? 'badge--primary' : 'badge--neutral'
                  }`}
                  style={{ opacity: schedule.daysOfWeek?.includes(index) ? 1 : 0.4 }}
                >
                  {day}
                </span>
              ))}
            </div>
          )}
          {schedule.frequency === 'interval' && (
            <p className="text-sm text-muted">Every {schedule.intervalDays} day(s)</p>
          )}
          {schedule.frequency === 'cycle' && (
            <p className="text-sm text-muted">
              {schedule.cycleDaysOn} day(s) on, {schedule.cycleDaysOff} day(s) off
            </p>
          )}

          {schedule.frequency === 'as_needed' ? (
            <Alert variant="info">
              Taken only when needed. As-needed doses never count towards your adherence score.
              {schedule.maxDosesPerDay && ` Maximum ${schedule.maxDosesPerDay} per day.`}
            </Alert>
          ) : (
            <div className="row mb-3">
              {schedule.times?.map((time) => (
                <Badge key={time.time} variant="primary">
                  {formatClock(time.time)} · {time.doseQuantity} {medicine.unit || 'dose'}
                  {time.label ? ` (${time.label})` : ''}
                </Badge>
              ))}
            </div>
          )}

          <div className="text-xs text-muted">
            From {formatDate(schedule.startDate)}
            {schedule.endDate ? ` until ${formatDate(schedule.endDate)}` : ' · no end date'}
            {schedule.frequency !== 'as_needed' && ` · ${schedule.graceMinutes} min grace window`}
          </div>
          {schedule.pauseReason && (
            <div className="text-xs text-muted mt-2">Paused: {schedule.pauseReason}</div>
          )}
        </div>
        <div className="card__footer row">
          <button type="button" className="btn btn--secondary btn--sm" onClick={onEdit}>
            Edit
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onToggle}>
            {schedule.isActive ? 'Pause' : 'Resume'}
          </button>
          <button type="button" className="btn btn--ghost btn--sm text-danger" onClick={() => setConfirm(true)}>
            Delete
          </button>
        </div>
      </article>

      {confirm && (
        <Modal
          title="Delete this schedule?"
          onClose={() => setConfirm(false)}
          footer={
            <>
              <button type="button" className="btn btn--secondary" onClick={() => setConfirm(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => {
                  setConfirm(false);
                  onDelete();
                }}
              >
                Delete schedule
              </button>
            </>
          }
        >
          <Alert variant="warning">
            This removes the schedule <strong>and every dose record made against it</strong>. To stop
            reminders without losing history, pause it instead.
          </Alert>
        </Modal>
      )}
    </>
  );
}

function ScheduleModal({ schedule, medicines, onClose, onSaved }) {
  const toast = useToast();
  const isEdit = Boolean(schedule);

  const [form, setForm] = useState(() => ({
    medicine: schedule?.medicine?.id || schedule?.medicine?._id || '',
    frequency: schedule?.frequency || 'daily',
    daysOfWeek: schedule?.daysOfWeek || [1, 2, 3, 4, 5],
    intervalDays: schedule?.intervalDays || 2,
    cycleDaysOn: schedule?.cycleDaysOn || 21,
    cycleDaysOff: schedule?.cycleDaysOff || 7,
    times: schedule?.times?.map((t) => ({
      time: t.time,
      doseQuantity: t.doseQuantity,
      label: t.label || ''
    })) || [{ time: '08:00', doseQuantity: 1, label: '' }],
    asNeededDoseQuantity: schedule?.asNeededDoseQuantity || 1,
    maxDosesPerDay: schedule?.maxDosesPerDay || '',
    startDate: schedule?.startDate ? schedule.startDate.slice(0, 10) : todayKey(),
    endDate: schedule?.endDate ? schedule.endDate.slice(0, 10) : '',
    mealRelation: schedule?.mealRelation || 'any',
    graceMinutes: schedule?.graceMinutes ?? 60,
    notes: schedule?.notes || ''
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const updateTime = (index, key, value) =>
    setForm((current) => ({
      ...current,
      times: current.times.map((t, i) => (i === index ? { ...t, [key]: value } : t))
    }));

  const addTime = () =>
    setForm((current) => ({
      ...current,
      times: [...current.times, { time: '20:00', doseQuantity: 1, label: '' }]
    }));

  const removeTime = (index) =>
    setForm((current) => ({ ...current, times: current.times.filter((_, i) => i !== index) }));

  const toggleDay = (day) =>
    setForm((current) => ({
      ...current,
      daysOfWeek: current.daysOfWeek.includes(day)
        ? current.daysOfWeek.filter((d) => d !== day)
        : [...current.daysOfWeek, day].sort()
    }));

  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    setBusy(true);

    const payload = {
      medicine: form.medicine,
      frequency: form.frequency,
      startDate: form.startDate,
      mealRelation: form.mealRelation,
      graceMinutes: Number(form.graceMinutes),
      notes: form.notes || undefined
    };
    if (form.endDate) payload.endDate = form.endDate;

    if (form.frequency === 'as_needed') {
      payload.asNeededDoseQuantity = Number(form.asNeededDoseQuantity);
      if (form.maxDosesPerDay) payload.maxDosesPerDay = Number(form.maxDosesPerDay);
    } else {
      payload.times = form.times.map((t) => ({
        time: t.time,
        doseQuantity: Number(t.doseQuantity),
        label: t.label || undefined
      }));
      if (form.frequency === 'specific_days') payload.daysOfWeek = form.daysOfWeek;
      if (form.frequency === 'interval') payload.intervalDays = Number(form.intervalDays);
      if (form.frequency === 'cycle') {
        payload.cycleDaysOn = Number(form.cycleDaysOn);
        payload.cycleDaysOff = Number(form.cycleDaysOff);
      }
    }

    try {
      if (isEdit) await scheduleApi.update(schedule.id, payload);
      else await scheduleApi.create(payload);
      toast.success(isEdit ? 'Schedule updated.' : 'Schedule created.');
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const selectedMedicine = medicines.find((m) => m.id === form.medicine);

  return (
    <Modal
      title={isEdit ? 'Edit schedule' : 'New schedule'}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="schedule-form"
            className="btn btn--primary"
            disabled={busy || !form.medicine}
          >
            {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create schedule'}
          </button>
        </>
      }
    >
      {error && <ErrorState error={error} />}

      <form id="schedule-form" onSubmit={submit}>
        <Field label="Medicine" htmlFor="sched-medicine" required>
          <select
            id="sched-medicine"
            className="select"
            required
            value={form.medicine}
            onChange={(event) => update('medicine', event.target.value)}
            disabled={isEdit}
          >
            <option value="">Choose a medicine…</option>
            {medicines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} {m.strength || ''}
              </option>
            ))}
          </select>
        </Field>

        <Field label="How often" htmlFor="sched-frequency" required>
          <select
            id="sched-frequency"
            className="select"
            value={form.frequency}
            onChange={(event) => update('frequency', event.target.value)}
          >
            {Object.entries(FREQUENCY_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>

        {form.frequency === 'specific_days' && (
          <Field label="On which days" hint="Tap to select.">
            <div className="row">
              {DAY_NAMES.map((day, index) => (
                <button
                  key={day}
                  type="button"
                  className={`btn btn--sm ${
                    form.daysOfWeek.includes(index) ? 'btn--primary' : 'btn--secondary'
                  }`}
                  onClick={() => toggleDay(index)}
                >
                  {day}
                </button>
              ))}
            </div>
          </Field>
        )}

        {form.frequency === 'interval' && (
          <Field label="Take every…" htmlFor="sched-interval">
            <div className="row">
              <input
                id="sched-interval"
                className="input"
                type="number"
                min="1"
                max="90"
                value={form.intervalDays}
                onChange={(event) => update('intervalDays', event.target.value)}
                style={{ width: 100 }}
              />
              <span className="text-sm text-muted">days, counted from the start date</span>
            </div>
          </Field>
        )}

        {form.frequency === 'cycle' && (
          <div className="form-grid">
            <Field label="Days on" htmlFor="sched-on">
              <input
                id="sched-on"
                className="input"
                type="number"
                min="1"
                value={form.cycleDaysOn}
                onChange={(event) => update('cycleDaysOn', event.target.value)}
              />
            </Field>
            <Field label="Days off" htmlFor="sched-off">
              <input
                id="sched-off"
                className="input"
                type="number"
                min="1"
                value={form.cycleDaysOff}
                onChange={(event) => update('cycleDaysOff', event.target.value)}
              />
            </Field>
          </div>
        )}

        {form.frequency === 'as_needed' ? (
          <>
            <Alert variant="info">
              As-needed medicines produce no scheduled reminders and never affect your adherence
              score. Record a dose from the Reminders screen whenever you take one.
            </Alert>
            <div className="form-grid">
              <Field label="Usual dose" htmlFor="sched-prn-dose">
                <input
                  id="sched-prn-dose"
                  className="input"
                  type="number"
                  min="0.25"
                  step="0.25"
                  value={form.asNeededDoseQuantity}
                  onChange={(event) => update('asNeededDoseQuantity', event.target.value)}
                />
              </Field>
              <Field
                label="Maximum per day"
                htmlFor="sched-prn-max"
                hint="Optional safety cap. MedGuardian will refuse extra doses."
              >
                <input
                  id="sched-prn-max"
                  className="input"
                  type="number"
                  min="1"
                  max="24"
                  value={form.maxDosesPerDay}
                  onChange={(event) => update('maxDosesPerDay', event.target.value)}
                />
              </Field>
            </div>
          </>
        ) : (
          <Field label="Reminder times" hint="One entry per dose per day.">
            <div className="stack">
              {form.times.map((time, index) => (
                <div key={index} className="row">
                  <input
                    className="input"
                    type="time"
                    required
                    value={time.time}
                    onChange={(event) => updateTime(index, 'time', event.target.value)}
                    style={{ width: 130 }}
                    aria-label={`Time ${index + 1}`}
                  />
                  <input
                    className="input"
                    type="number"
                    min="0.25"
                    step="0.25"
                    required
                    value={time.doseQuantity}
                    onChange={(event) => updateTime(index, 'doseQuantity', event.target.value)}
                    style={{ width: 90 }}
                    aria-label={`Dose quantity ${index + 1}`}
                  />
                  <span className="text-sm text-muted">{selectedMedicine?.unit || 'dose'}(s)</span>
                  <input
                    className="input flex-1"
                    placeholder="Label (optional), e.g. Morning"
                    value={time.label}
                    onChange={(event) => updateTime(index, 'label', event.target.value)}
                    aria-label={`Label ${index + 1}`}
                  />
                  {form.times.length > 1 && (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => removeTime(index)}
                      aria-label="Remove this time"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              <button type="button" className="btn btn--secondary btn--sm" onClick={addTime}>
                + Add another time
              </button>
            </div>
          </Field>
        )}

        <div className="form-grid">
          <Field label="Start date" htmlFor="sched-start" required>
            <input
              id="sched-start"
              className="input"
              type="date"
              required
              value={form.startDate}
              onChange={(event) => update('startDate', event.target.value)}
            />
          </Field>
          <Field label="End date" htmlFor="sched-end" hint="Leave blank for ongoing.">
            <input
              id="sched-end"
              className="input"
              type="date"
              value={form.endDate}
              onChange={(event) => update('endDate', event.target.value)}
            />
          </Field>
          <Field label="Take it…" htmlFor="sched-meal">
            <select
              id="sched-meal"
              className="select"
              value={form.mealRelation}
              onChange={(event) => update('mealRelation', event.target.value)}
            >
              {MEAL_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          {form.frequency !== 'as_needed' && (
            <Field
              label="Grace window (minutes)"
              htmlFor="sched-grace"
              hint="How long a dose stays 'due' before it is counted late."
            >
              <input
                id="sched-grace"
                className="input"
                type="number"
                min="0"
                max="720"
                value={form.graceMinutes}
                onChange={(event) => update('graceMinutes', event.target.value)}
              />
            </Field>
          )}
        </div>

        <Field label="Notes" htmlFor="sched-notes" hint="Optional.">
          <textarea
            id="sched-notes"
            className="textarea"
            value={form.notes}
            onChange={(event) => update('notes', event.target.value)}
            maxLength={500}
          />
        </Field>
      </form>
    </Modal>
  );
}
