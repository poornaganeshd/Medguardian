import { useState } from 'react';
import { Modal, Field } from './ui';
import { SKIP_REASON_LABEL } from '../utils/format';

/**
 * Asks why a dose was skipped. The reason is required by the API — it is what
 * the insights module uses to spot patterns like "mostly side effects".
 */
export default function SkipReasonModal({ occurrence, onConfirm, onCancel, busy }) {
  const [reason, setReason] = useState('forgot');
  const [notes, setNotes] = useState('');

  return (
    <Modal
      title="Why was this dose skipped?"
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn btn--secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            onClick={() => onConfirm({ skipReason: reason, notes })}
          >
            {busy ? 'Saving…' : 'Record as skipped'}
          </button>
        </>
      }
    >
      <p className="text-sm text-muted">
        {occurrence?.medicine?.name} — recording the reason helps MedGuardian spot patterns later.
        A skipped dose is <strong>not</strong> deducted from your stock.
      </p>

      <Field label="Reason" htmlFor="skip-reason">
        <select
          id="skip-reason"
          className="select"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        >
          {Object.entries(SKIP_REASON_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Notes" htmlFor="skip-notes" hint="Optional.">
        <textarea
          id="skip-notes"
          className="textarea"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Anything worth remembering about this dose"
          maxLength={500}
        />
      </Field>
    </Modal>
  );
}
