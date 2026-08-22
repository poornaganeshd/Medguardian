import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Modal, Field, Alert } from './ui';

/**
 * PIN re-authentication dialog shown before a sensitive action.
 *
 * The step-up token it obtains is held in sessionStorage by the API layer and
 * attached to subsequent requests automatically, so the user is not asked
 * again for every action within the window.
 */
export default function PinGate({ action = 'continue', onConfirmed, onCancel }) {
  const { verifyPin, hasPin } = useAuth();
  const [pin, setPin] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await verifyPin(pin);
      onConfirmed();
    } catch (err) {
      setError(err.message);
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  if (!hasPin) {
    return (
      <Modal title="Security PIN required" onClose={onCancel}>
        <Alert variant="warning" title="You have not set a security PIN yet">
          <p>
            Sensitive actions such as deleting records or changing caregiver access need a PIN so
            that nobody using your unlocked device can make them by accident.
          </p>
          <p className="mb-0">
            <Link to="/profile">Set up your PIN in Profile → Security</Link>, then try again.
          </p>
        </Alert>
      </Modal>
    );
  }

  return (
    <Modal
      title="Confirm it's you"
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn btn--secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="submit"
            form="pin-gate-form"
            className="btn btn--primary"
            disabled={busy || pin.length < 4}
          >
            {busy ? 'Checking…' : 'Confirm'}
          </button>
        </>
      }
    >
      <form id="pin-gate-form" onSubmit={submit}>
        <p className="text-sm text-muted">
          Enter your security PIN to {action}. This confirmation lasts a few minutes.
        </p>
        {error && <Alert variant="danger">{error}</Alert>}
        <Field label="Security PIN" htmlFor="pin-gate-input">
          <input
            id="pin-gate-input"
            className="input"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            maxLength={8}
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
            placeholder="••••"
          />
        </Field>
      </form>
    </Modal>
  );
}
