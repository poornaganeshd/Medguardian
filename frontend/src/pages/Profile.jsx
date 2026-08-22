import { useState, useEffect } from 'react';
import { authApi, auditApi } from '../services/endpoints';
import { stepUpStore } from '../services/api';
import useApi from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Card, Field, Alert, Badge, Spinner, EmptyState, ErrorState, Modal } from '../components/ui';
import { formatDateTime, formatDate, initials } from '../utils/format';
import {
  isWebAuthnSupported,
  hasPlatformAuthenticator,
  createCredential,
  getAssertion
} from '../utils/webauthn';

const TABS = [
  ['profile', 'Profile'],
  ['security', 'Security'],
  ['notifications', 'Reminders'],
  ['audit', 'Activity log']
];

export default function Profile() {
  const { user } = useAuth();
  const [tab, setTab] = useState('profile');

  return (
    <>
      <div className="page__header">
        <div className="row">
          <div className="avatar" style={{ width: 56, height: 56, fontSize: '1.2rem' }} aria-hidden="true">
            {initials(user?.name)}
          </div>
          <div>
            <h1 className="mb-0">{user?.name}</h1>
            <p className="page__subtitle">
              {user?.email} · <span style={{ textTransform: 'capitalize' }}>{user?.role}</span>
              {user?.hasPin && (
                <>
                  {' '}
                  <Badge variant="success">PIN set</Badge>
                </>
              )}
            </p>
          </div>
        </div>
      </div>

      <div className="tabs">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`tab ${tab === key ? 'tab--active' : ''}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'profile' && <ProfileTab />}
      {tab === 'security' && <SecurityTab />}
      {tab === 'notifications' && <NotificationsTab />}
      {tab === 'audit' && <AuditTab />}
    </>
  );
}

/* ------------------------------------------------------------------ profile */
function ProfileTab() {
  const { user, refreshUser } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState(() => ({
    name: user?.name || '',
    phone: user?.phone || '',
    dateOfBirth: user?.dateOfBirth ? user.dateOfBirth.slice(0, 10) : '',
    gender: user?.gender || '',
    bloodGroup: user?.bloodGroup || '',
    timezone: user?.timezone || 'Asia/Kolkata',
    allergies: (user?.allergies || []).join(', '),
    conditions: (user?.conditions || []).join(', '),
    emergencyName: user?.emergencyContact?.name || '',
    emergencyRelationship: user?.emergencyContact?.relationship || '',
    emergencyPhone: user?.emergencyContact?.phone || ''
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const update = (field) => (event) => setForm({ ...form, [field]: event.target.value });

  const listOf = (value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const payload = {
        name: form.name,
        timezone: form.timezone,
        allergies: listOf(form.allergies),
        conditions: listOf(form.conditions),
        emergencyContact: {
          name: form.emergencyName,
          relationship: form.emergencyRelationship,
          phone: form.emergencyPhone
        }
      };
      if (form.phone) payload.phone = form.phone;
      if (form.dateOfBirth) payload.dateOfBirth = form.dateOfBirth;
      if (form.gender) payload.gender = form.gender;
      if (form.bloodGroup) payload.bloodGroup = form.bloodGroup;

      await authApi.updateProfile(payload);
      await refreshUser();
      toast.success('Profile updated.');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      {error && <ErrorState error={error} />}
      <div className="stack">
        <Card title="Your details">
          <div className="form-grid">
            <Field label="Full name" htmlFor="p-name" required>
              <input id="p-name" className="input" required value={form.name} onChange={update('name')} />
            </Field>
            <Field label="Email" htmlFor="p-email" hint="Your email cannot be changed here.">
              <input id="p-email" className="input" value={user?.email || ''} disabled />
            </Field>
            <Field label="Phone" htmlFor="p-phone">
              <input id="p-phone" className="input" type="tel" value={form.phone} onChange={update('phone')} />
            </Field>
            <Field label="Date of birth" htmlFor="p-dob">
              <input id="p-dob" className="input" type="date" value={form.dateOfBirth} onChange={update('dateOfBirth')} />
            </Field>
            <Field label="Gender" htmlFor="p-gender">
              <select id="p-gender" className="select" value={form.gender} onChange={update('gender')}>
                <option value="">Prefer not to say</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="other">Other</option>
                <option value="prefer_not_to_say">Prefer not to say</option>
              </select>
            </Field>
            <Field label="Blood group" htmlFor="p-blood">
              <select id="p-blood" className="select" value={form.bloodGroup} onChange={update('bloodGroup')}>
                <option value="">Not recorded</option>
                {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'unknown'].map((group) => (
                  <option key={group} value={group}>
                    {group}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Timezone"
              htmlFor="p-tz"
              hint="Reminder times and daily totals follow this."
            >
              <input id="p-tz" className="input" value={form.timezone} onChange={update('timezone')} />
            </Field>
          </div>
        </Card>

        <Card title="Medical background">
          <p className="text-sm text-muted">
            Kept for your own reference and for anyone you show this app to. MedGuardian never uses
            it to make a clinical judgement.
          </p>
          <div className="form-grid">
            <Field label="Allergies" htmlFor="p-allergies" hint="Comma separated.">
              <input
                id="p-allergies"
                className="input"
                value={form.allergies}
                onChange={update('allergies')}
                placeholder="penicillin, peanuts"
              />
            </Field>
            <Field label="Ongoing conditions" htmlFor="p-conditions" hint="Comma separated.">
              <input
                id="p-conditions"
                className="input"
                value={form.conditions}
                onChange={update('conditions')}
                placeholder="type 2 diabetes"
              />
            </Field>
          </div>
        </Card>

        <Card title="Emergency contact">
          <div className="form-grid">
            <Field label="Name" htmlFor="p-em-name">
              <input id="p-em-name" className="input" value={form.emergencyName} onChange={update('emergencyName')} />
            </Field>
            <Field label="Relationship" htmlFor="p-em-rel">
              <input
                id="p-em-rel"
                className="input"
                value={form.emergencyRelationship}
                onChange={update('emergencyRelationship')}
              />
            </Field>
            <Field label="Phone" htmlFor="p-em-phone">
              <input
                id="p-em-phone"
                className="input"
                type="tel"
                value={form.emergencyPhone}
                onChange={update('emergencyPhone')}
              />
            </Field>
          </div>
        </Card>

        <div className="row row--end">
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </form>
  );
}

/* ----------------------------------------------------------------- security */
function SecurityTab() {
  const { user, refreshUser, hasPin } = useAuth();
  const toast = useToast();
  const [passwordModal, setPasswordModal] = useState(false);
  const [pinModal, setPinModal] = useState(false);
  const [platformAvailable, setPlatformAvailable] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    hasPlatformAuthenticator().then(setPlatformAvailable);
  }, []);

  const devices = user?.webAuthnDevices || [];

  const registerBiometric = async () => {
    setBusy(true);
    try {
      const options = await authApi.webauthn.registrationOptions();
      const credential = await createCredential(options);
      await authApi.webauthn.verifyRegistration({
        credential,
        deviceLabel: navigator.platform || 'This device'
      });
      await refreshUser();
      toast.success('Biometric sign-off enabled on this device.');
    } catch (error) {
      toast.error(
        error.name === 'NotAllowedError'
          ? 'The request was cancelled or timed out.'
          : error.message
      );
    } finally {
      setBusy(false);
    }
  };

  const testBiometric = async () => {
    setBusy(true);
    try {
      const options = await authApi.webauthn.authenticationOptions();
      const credential = await getAssertion(options);
      const result = await authApi.webauthn.verifyAuthentication({ credential });
      stepUpStore.save(result.stepUpToken, result.expiresInMinutes);
      toast.success('Verified. Sensitive actions are unlocked for a few minutes.');
    } catch (error) {
      toast.error(
        error.name === 'NotAllowedError' ? 'The request was cancelled.' : error.message
      );
    } finally {
      setBusy(false);
    }
  };

  const removeDevice = async (credentialId) => {
    try {
      await authApi.webauthn.remove(credentialId);
      await refreshUser();
      toast.success('Device removed.');
    } catch (error) {
      toast.error(error.message);
    }
  };

  return (
    <div className="stack">
      <Card title="Password">
        <div className="row row--between">
          <div>
            <strong>Account password</strong>
            <div className="text-sm text-muted">
              Stored only as a bcrypt hash — nobody, including MedGuardian, can read it.
              {user?.passwordChangedAt && ` Last changed ${formatDate(user.passwordChangedAt)}.`}
            </div>
          </div>
          <button type="button" className="btn btn--secondary" onClick={() => setPasswordModal(true)}>
            Change password
          </button>
        </div>
        <Alert variant="neutral" title="Changing it signs you out everywhere">
          <p className="mb-0 text-sm">
            All active sessions are revoked when you change your password, so anyone signed in on
            another device is signed out.
          </p>
        </Alert>
      </Card>

      <Card title="Security PIN">
        <div className="row row--between mb-3">
          <div>
            <strong>PIN re-authentication {hasPin && <Badge variant="success">Set</Badge>}</strong>
            <div className="text-sm text-muted">
              Asked for before sensitive actions: deleting a medicine or a medical record, and
              changing what a caregiver can see.
              {user?.pinSetAt && ` Set on ${formatDate(user.pinSetAt)}.`}
            </div>
          </div>
          <button type="button" className="btn btn--primary" onClick={() => setPinModal(true)}>
            {hasPin ? 'Change PIN' : 'Set up a PIN'}
          </button>
        </div>
        {!hasPin && (
          <Alert variant="warning" title="You have not set a PIN yet">
            Without one you cannot delete records or change caregiver permissions, because those
            actions require a second confirmation.
          </Alert>
        )}
      </Card>

      <Card title="Biometric confirmation (WebAuthn)">
        {!isWebAuthnSupported() ? (
          <Alert variant="neutral" title="Not supported in this browser">
            Biometric confirmation needs a browser with WebAuthn support. Your PIN works everywhere.
          </Alert>
        ) : (
          <>
            <p className="text-sm text-muted">
              Use your device's fingerprint reader or face unlock instead of typing a PIN. The
              biometric itself never leaves your device — MedGuardian only ever stores a public key.
            </p>

            {devices.length === 0 ? (
              <EmptyState icon="🔐" title="No device registered">
                {platformAvailable
                  ? 'This device has a built-in authenticator you can register.'
                  : 'No built-in authenticator was detected on this device.'}
              </EmptyState>
            ) : (
              <div className="stack mb-4">
                {devices.map((device) => (
                  <div key={device.id} className="row row--between" style={{ padding: '8px 0' }}>
                    <div>
                      <strong>{device.deviceLabel}</strong>
                      <div className="text-xs text-muted">
                        Registered {formatDate(device.createdAt)}
                        {device.lastUsedAt && ` · last used ${formatDate(device.lastUsedAt)}`}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm text-danger"
                      onClick={() => removeDevice(device.id)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="row">
              <button type="button" className="btn btn--primary" onClick={registerBiometric} disabled={busy}>
                {busy ? 'Working…' : 'Register this device'}
              </button>
              {devices.length > 0 && (
                <button type="button" className="btn btn--secondary" onClick={testBiometric} disabled={busy}>
                  Test it
                </button>
              )}
            </div>
          </>
        )}
      </Card>

      {passwordModal && <PasswordModal onClose={() => setPasswordModal(false)} />}
      {pinModal && (
        <PinModal
          hasPin={hasPin}
          onClose={() => setPinModal(false)}
          onSaved={async () => {
            setPinModal(false);
            await refreshUser();
          }}
        />
      )}
    </div>
  );
}

function PasswordModal({ onClose }) {
  const toast = useToast();
  const { logout } = useAuth();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (event) => {
    event.preventDefault();
    if (form.newPassword !== form.confirm) {
      setError(new Error('The two new passwords do not match.'));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await authApi.changePassword({
        currentPassword: form.currentPassword,
        newPassword: form.newPassword
      });
      toast.success('Password changed. Please sign in again.');
      await logout();
      window.location.href = '/login';
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Change your password"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="pw-form" className="btn btn--primary" disabled={busy}>
            {busy ? 'Changing…' : 'Change password'}
          </button>
        </>
      }
    >
      {error && <ErrorState error={error} />}
      <form id="pw-form" onSubmit={submit}>
        <Field label="Current password" htmlFor="pw-current" required>
          <input
            id="pw-current"
            className="input"
            type="password"
            required
            autoFocus
            autoComplete="current-password"
            value={form.currentPassword}
            onChange={(event) => setForm({ ...form, currentPassword: event.target.value })}
          />
        </Field>
        <Field
          label="New password"
          htmlFor="pw-new"
          required
          hint="At least 8 characters, with upper case, lower case and a number."
        >
          <input
            id="pw-new"
            className="input"
            type="password"
            required
            autoComplete="new-password"
            value={form.newPassword}
            onChange={(event) => setForm({ ...form, newPassword: event.target.value })}
          />
        </Field>
        <Field label="Confirm new password" htmlFor="pw-confirm" required>
          <input
            id="pw-confirm"
            className="input"
            type="password"
            required
            autoComplete="new-password"
            value={form.confirm}
            onChange={(event) => setForm({ ...form, confirm: event.target.value })}
          />
        </Field>
      </form>
    </Modal>
  );
}

function PinModal({ hasPin, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ password: '', currentPin: '', pin: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (event) => {
    event.preventDefault();
    if (form.pin !== form.confirm) {
      setError(new Error('The two PINs do not match.'));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await authApi.setPin({
        pin: form.pin,
        currentPin: hasPin ? form.currentPin : undefined,
        password: form.password
      });
      toast.success(hasPin ? 'PIN changed.' : 'PIN created.');
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const digitsOnly = (value) => value.replace(/\D/g, '');

  return (
    <Modal
      title={hasPin ? 'Change your PIN' : 'Set up a security PIN'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="pin-form" className="btn btn--primary" disabled={busy}>
            {busy ? 'Saving…' : hasPin ? 'Change PIN' : 'Create PIN'}
          </button>
        </>
      }
    >
      {error && <ErrorState error={error} />}
      <p className="text-sm text-muted">
        4 to 8 digits, not all the same. Your PIN is hashed with bcrypt, exactly like your password.
      </p>
      <form id="pin-form" onSubmit={submit}>
        <Field label="Your account password" htmlFor="pin-password" required hint="Confirms it is really you.">
          <input
            id="pin-password"
            className="input"
            type="password"
            required
            autoFocus
            autoComplete="current-password"
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
          />
        </Field>
        {hasPin && (
          <Field label="Current PIN" htmlFor="pin-current" required>
            <input
              id="pin-current"
              className="input"
              type="password"
              inputMode="numeric"
              required
              maxLength={8}
              value={form.currentPin}
              onChange={(event) => setForm({ ...form, currentPin: digitsOnly(event.target.value) })}
            />
          </Field>
        )}
        <Field label={hasPin ? 'New PIN' : 'Choose a PIN'} htmlFor="pin-new" required>
          <input
            id="pin-new"
            className="input"
            type="password"
            inputMode="numeric"
            required
            maxLength={8}
            value={form.pin}
            onChange={(event) => setForm({ ...form, pin: digitsOnly(event.target.value) })}
          />
        </Field>
        <Field label="Confirm PIN" htmlFor="pin-confirm" required>
          <input
            id="pin-confirm"
            className="input"
            type="password"
            inputMode="numeric"
            required
            maxLength={8}
            value={form.confirm}
            onChange={(event) => setForm({ ...form, confirm: digitsOnly(event.target.value) })}
          />
        </Field>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------ notifications */
function NotificationsTab() {
  const { user, refreshUser } = useAuth();
  const toast = useToast();
  const [prefs, setPrefs] = useState(() => ({
    visualReminders: true,
    browserNotifications: true,
    refillAlerts: true,
    missedDoseAlerts: true,
    reminderLeadMinutes: 0,
    ...(user?.notificationPreferences || {})
  }));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await authApi.updateProfile({
        notificationPreferences: { ...prefs, reminderLeadMinutes: Number(prefs.reminderLeadMinutes) }
      });
      await refreshUser();
      toast.success('Reminder preferences saved.');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (key) => (event) => setPrefs({ ...prefs, [key]: event.target.checked });

  return (
    <div className="stack">
      <Alert variant="info" title="Visual reminders only">
        MedGuardian shows reminder cards with your medicine's photograph and, if you allow it,
        browser notifications. There are no spoken or audio reminders — that is deliberate and part
        of the project's scope.
      </Alert>

      <Card title="How you would like to be reminded">
        <div className="stack">
          {[
            ['visualReminders', 'Show visual reminder cards', 'Dose cards with the photo of each medicine.'],
            ['browserNotifications', 'Browser notifications', 'A desktop or mobile notification when a dose becomes due.'],
            ['missedDoseAlerts', 'Highlight missed doses', 'Draw attention to doses that were not recorded.'],
            ['refillAlerts', 'Refill warnings', 'Tell me before a medicine runs out.']
          ].map(([key, label, description]) => (
            <label key={key} className="checkbox">
              <input type="checkbox" checked={Boolean(prefs[key])} onChange={toggle(key)} />
              <span className="checkbox__text">
                <span className="checkbox__title">{label}</span>
                <span className="checkbox__desc">{description}</span>
              </span>
            </label>
          ))}
        </div>

        <Field
          label="Remind me this many minutes early"
          htmlFor="lead"
          hint="0 means exactly at the scheduled time."
        >
          <input
            id="lead"
            className="input"
            type="number"
            min="0"
            max="120"
            value={prefs.reminderLeadMinutes}
            onChange={(event) => setPrefs({ ...prefs, reminderLeadMinutes: event.target.value })}
            style={{ width: 140 }}
          />
        </Field>

        <div className="row row--end">
          <button type="button" className="btn btn--primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save preferences'}
          </button>
        </div>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------- audit */
function AuditTab() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const { data, loading, error, reload } = useApi(
    () => auditApi.list({ page, limit: 25, action: action || undefined }),
    [page, action]
  );
  const actions = useApi(() => auditApi.actions(), []);

  return (
    <div className="stack">
      <Alert variant="neutral" title="Everything important is recorded">
        Sign-ins, changes to your medicines and schedules, every time a record is opened or a file
        downloaded, OCR runs, and every change to caregiver access — with who did it, when, and how
        they authenticated.
      </Alert>

      <Card
        title="Activity log"
        actions={
          <select
            className="select"
            value={action}
            onChange={(event) => {
              setAction(event.target.value);
              setPage(1);
            }}
            style={{ width: 'auto' }}
            aria-label="Filter by action"
          >
            <option value="">All activity</option>
            {(actions.data?.actions || []).map((value) => (
              <option key={value} value={value}>
                {value.replace(/_/g, ' ').toLowerCase()}
              </option>
            ))}
          </select>
        }
        bodyClassName="table-wrap"
      >
        {loading && !data ? (
          <Spinner label="Loading…" />
        ) : error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : (data?.items || []).length === 0 ? (
          <EmptyState icon="📋" title="No activity recorded yet" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>What happened</th>
                <th>Method</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((entry) => (
                <tr key={entry._id}>
                  <td className="text-sm" style={{ whiteSpace: 'nowrap' }}>
                    {formatDateTime(entry.createdAt)}
                  </td>
                  <td>
                    <Badge variant={entry.status === 'failure' ? 'danger' : 'neutral'}>
                      {entry.action.replace(/_/g, ' ').toLowerCase()}
                    </Badge>
                  </td>
                  <td className="text-sm">{entry.description || '—'}</td>
                  <td className="text-xs text-muted">
                    {entry.authMethod}
                    {entry.ipAddress && (
                      <div className="mono" style={{ fontSize: '0.7rem' }}>
                        {entry.ipAddress}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {data && data.pages > 1 && (
        <div className="row row--between">
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            ← Previous
          </button>
          <span className="text-sm text-muted">
            Page {data.page} of {data.pages} · {data.total} entries
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
    </div>
  );
}
