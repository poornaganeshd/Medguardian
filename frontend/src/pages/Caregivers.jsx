import { useState } from 'react';
import { Link } from 'react-router-dom';
import { caregiverApi } from '../services/endpoints';
import useApi from '../hooks/useApi';
import useStepUp from '../hooks/useStepUp';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import PinGate from '../components/PinGate';
import { Card, Badge, Alert, Spinner, EmptyState, ErrorState, Modal, Field, Stat } from '../components/ui';
import { formatDate, percent } from '../utils/format';

const PERMISSIONS = [
  ['viewMedicines', 'See my medicine list', 'Names, strengths, stock levels and photos.'],
  ['viewSchedules', 'See my schedules and doses', "Today's doses and whether each was taken."],
  ['viewAdherence', 'See my adherence score', 'The 30-day summary and trend.'],
  ['viewRecords', 'Open medical records I have shared', 'Only records you explicitly mark as shared. Never sensitive ones.'],
  ['canRecordIntake', 'Record a dose on my behalf', 'Lets them mark a dose taken or skipped, which changes your stock.'],
  ['receiveMissedDoseAlerts', 'Be told about missed doses', 'Shown on their patient summary.'],
  ['receiveRefillAlerts', 'Be told when a refill is needed', 'Shown on their patient summary.']
];

export default function Caregivers() {
  const { user } = useAuth();
  const toast = useToast();
  const stepUp = useStepUp();
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState(null);
  const [responding, setResponding] = useState(false);
  const [viewingPatient, setViewingPatient] = useState(null);

  const { data, loading, error, reload } = useApi(() => caregiverApi.list({ status: 'all' }), []);

  const myCaregivers = data?.myCaregivers || [];
  const patientsIHelp = data?.patientsIHelp || [];

  const revoke = async (link) => {
    try {
      await caregiverApi.revoke(link.id);
      toast.success('Access revoked. It takes effect immediately.');
      reload();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="mb-0">Caregivers</h1>
          <p className="page__subtitle">
            Optional. Invite someone to help you, and choose exactly what they can see.
          </p>
        </div>
        <div className="row">
          <button type="button" className="btn btn--secondary" onClick={() => setResponding(true)}>
            I have an invitation code
          </button>
          <button type="button" className="btn btn--primary" onClick={() => setInviting(true)}>
            + Invite a caregiver
          </button>
        </div>
      </div>

      {loading && !data ? (
        <Spinner large label="Loading caregiver links…" />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : (
        <>
          <Card title="People who help me" className="mb-5">
            {myCaregivers.length === 0 ? (
              <EmptyState
                icon="👥"
                title="You have not added a caregiver"
                action={
                  <button type="button" className="btn btn--primary btn--sm" onClick={() => setInviting(true)}>
                    Invite someone
                  </button>
                }
              >
                A caregiver can keep an eye on your doses and refills. This is entirely optional, and
                you stay in control of every permission.
              </EmptyState>
            ) : (
              <div className="stack">
                {myCaregivers.map((link) => (
                  <div
                    key={link.id}
                    style={{
                      padding: 'var(--space-4)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)'
                    }}
                  >
                    <div className="row row--between mb-3">
                      <div>
                        <strong>{link.caregiverName || link.caregiverEmail}</strong>
                        <div className="text-sm text-muted">
                          {link.caregiverEmail}
                          {link.relationship && ` · ${link.relationship}`}
                        </div>
                      </div>
                      <Badge
                        variant={
                          link.status === 'accepted'
                            ? 'success'
                            : link.status === 'invited'
                              ? 'warning'
                              : 'neutral'
                        }
                      >
                        {link.status === 'accepted'
                          ? 'Active'
                          : link.status === 'invited'
                            ? 'Invitation pending'
                            : link.status}
                      </Badge>
                    </div>

                    <div className="row mb-3">
                      {PERMISSIONS.filter(([key]) => link.permissions?.[key]).map(([key, label]) => (
                        <Badge key={key} variant="primary">
                          {label}
                        </Badge>
                      ))}
                      {!PERMISSIONS.some(([key]) => link.permissions?.[key]) && (
                        <span className="text-sm text-muted">No permissions granted</span>
                      )}
                    </div>

                    <div className="text-xs text-muted mb-3">
                      Invited {formatDate(link.invitedAt)}
                      {link.respondedAt && ` · responded ${formatDate(link.respondedAt)}`}
                      {link.lastAccessAt && ` · last viewed your data ${formatDate(link.lastAccessAt)}`}
                    </div>

                    {link.status !== 'revoked' && (
                      <div className="row">
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          onClick={() => setEditing(link)}
                        >
                          Change permissions
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm text-danger"
                          onClick={() => revoke(link)}
                        >
                          Revoke access
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          {(patientsIHelp.length > 0 || user?.role === 'caregiver') && (
            <Card title="People I help">
              {patientsIHelp.length === 0 ? (
                <EmptyState icon="🤝" title="You are not helping anyone yet">
                  When a patient invites you, use "I have an invitation code" above to accept.
                </EmptyState>
              ) : (
                <div className="stack">
                  {patientsIHelp.map((link) => (
                    <div key={link.id} className="row row--between" style={{ padding: 'var(--space-3) 0' }}>
                      <div>
                        <strong>{link.patient?.name || link.patient?.email || 'Patient'}</strong>
                        <div className="text-sm text-muted">{link.patient?.email}</div>
                      </div>
                      <div className="row">
                        <Badge variant={link.status === 'accepted' ? 'success' : 'warning'}>
                          {link.status}
                        </Badge>
                        {link.status === 'accepted' && (
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            onClick={() => setViewingPatient(link.patient?._id || link.patient?.id)}
                          >
                            Open summary
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => revoke(link)}
                        >
                          Leave
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </>
      )}

      {inviting && (
        <InviteModal
          onClose={() => setInviting(false)}
          onSaved={() => {
            setInviting(false);
            reload();
          }}
        />
      )}

      {responding && (
        <RespondModal
          onClose={() => setResponding(false)}
          onSaved={() => {
            setResponding(false);
            reload();
          }}
        />
      )}

      {editing && (
        <PermissionsModal
          link={editing}
          stepUp={stepUp}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}

      {viewingPatient && (
        <PatientSummaryModal patientId={viewingPatient} onClose={() => setViewingPatient(null)} />
      )}

      {stepUp.gateProps && <PinGate {...stepUp.gateProps} />}
    </>
  );
}

function InviteModal({ onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ caregiverEmail: '', caregiverName: '', relationship: '' });
  const [permissions, setPermissions] = useState({
    viewMedicines: true,
    viewSchedules: true,
    viewAdherence: true,
    viewRecords: false,
    canRecordIntake: false,
    receiveMissedDoseAlerts: true,
    receiveRefillAlerts: true
  });
  const [issued, setIssued] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await caregiverApi.invite({ ...form, permissions });
      setIssued(result);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (issued) {
    return (
      <Modal
        title="Invitation created"
        onClose={() => {
          onSaved();
        }}
        footer={
          <button type="button" className="btn btn--primary" onClick={onSaved}>
            Done
          </button>
        }
      >
        <Alert variant="success" title="Send this code to your caregiver">
          <p className="mb-2">
            {issued.recipientHasAccount
              ? `${form.caregiverEmail} already has a MedGuardian account. They can accept using the code below.`
              : `${form.caregiverEmail} needs to create a MedGuardian account with that exact email address, then accept using the code below.`}
          </p>
          <code
            className="mono"
            style={{
              display: 'block',
              padding: 'var(--space-3)',
              background: 'var(--surface)',
              borderRadius: 'var(--radius)',
              wordBreak: 'break-all',
              fontSize: '0.9rem'
            }}
          >
            {issued.inviteToken}
          </code>
        </Alert>
        <p className="text-sm text-muted">
          This code is shown <strong>once</strong> — MedGuardian stores only a hashed copy. Send it
          however you like; it expires on {formatDate(issued.inviteExpiresAt)} and only works for{' '}
          {form.caregiverEmail}.
        </p>
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={() => {
            navigator.clipboard?.writeText(issued.inviteToken);
            toast.success('Code copied to your clipboard.');
          }}
        >
          Copy code
        </button>
      </Modal>
    );
  }

  return (
    <Modal
      title="Invite a caregiver"
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="invite-form"
            className="btn btn--primary"
            disabled={busy || !form.caregiverEmail}
          >
            {busy ? 'Creating…' : 'Create invitation'}
          </button>
        </>
      }
    >
      {error && <ErrorState error={error} />}

      <form id="invite-form" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Their email address" htmlFor="cg-email" required hint="The invitation only works for this address.">
            <input
              id="cg-email"
              className="input"
              type="email"
              required
              autoFocus
              value={form.caregiverEmail}
              onChange={(event) => setForm({ ...form, caregiverEmail: event.target.value })}
            />
          </Field>
          <Field label="Their name" htmlFor="cg-name">
            <input
              id="cg-name"
              className="input"
              value={form.caregiverName}
              onChange={(event) => setForm({ ...form, caregiverName: event.target.value })}
            />
          </Field>
          <Field label="Relationship" htmlFor="cg-rel">
            <input
              id="cg-rel"
              className="input"
              value={form.relationship}
              onChange={(event) => setForm({ ...form, relationship: event.target.value })}
              placeholder="e.g. Daughter"
            />
          </Field>
        </div>

        <h4 className="mt-4">What may they see?</h4>
        <p className="text-sm text-muted">
          Grant only what they genuinely need. You can change any of this later, and revoke access
          entirely at any time.
        </p>
        <div className="stack">
          {PERMISSIONS.map(([key, label, description]) => (
            <label key={key} className="checkbox">
              <input
                type="checkbox"
                checked={permissions[key]}
                onChange={(event) => setPermissions({ ...permissions, [key]: event.target.checked })}
              />
              <span className="checkbox__text">
                <span className="checkbox__title">{label}</span>
                <span className="checkbox__desc">{description}</span>
              </span>
            </label>
          ))}
        </div>
      </form>
    </Modal>
  );
}

function RespondModal({ onClose, onSaved }) {
  const toast = useToast();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const respond = async (accept) => {
    setError(null);
    setBusy(true);
    try {
      await caregiverApi.respond({ token: token.trim(), accept });
      toast.success(accept ? 'You are now a caregiver for this patient.' : 'Invitation declined.');
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Accept a caregiver invitation"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--secondary" disabled={busy || !token} onClick={() => respond(false)}>
            Decline
          </button>
          <button type="button" className="btn btn--primary" disabled={busy || !token} onClick={() => respond(true)}>
            {busy ? 'Checking…' : 'Accept invitation'}
          </button>
        </>
      }
    >
      {error && <ErrorState error={error} />}
      <p className="text-sm text-muted">
        Paste the invitation code the patient sent you. It only works if you are signed in with the
        email address they invited.
      </p>
      <Field label="Invitation code" htmlFor="respond-token" required>
        <input
          id="respond-token"
          className="input mono"
          autoFocus
          value={token}
          onChange={(event) => setToken(event.target.value)}
        />
      </Field>
    </Modal>
  );
}

function PermissionsModal({ link, stepUp, onClose, onSaved }) {
  const toast = useToast();
  const [permissions, setPermissions] = useState(() => ({ ...link.permissions }));
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await stepUp.run(
        () => caregiverApi.updatePermissions(link.id, { permissions }),
        'change what this caregiver can see'
      );
      toast.success('Permissions updated.');
      onSaved();
    } catch (err) {
      if (!err.cancelled) toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Permissions for ${link.caregiverName || link.caregiverEmail}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled={busy} onClick={submit}>
            {busy ? 'Saving…' : 'Save permissions'}
          </button>
        </>
      }
    >
      <Alert variant="info">
        Changing caregiver access is a sensitive action, so you will be asked to confirm your PIN.
      </Alert>
      <div className="stack">
        {PERMISSIONS.map(([key, label, description]) => (
          <label key={key} className="checkbox">
            <input
              type="checkbox"
              checked={Boolean(permissions[key])}
              onChange={(event) => setPermissions({ ...permissions, [key]: event.target.checked })}
            />
            <span className="checkbox__text">
              <span className="checkbox__title">{label}</span>
              <span className="checkbox__desc">{description}</span>
            </span>
          </label>
        ))}
      </div>
    </Modal>
  );
}

function PatientSummaryModal({ patientId, onClose }) {
  const { data, loading, error } = useApi(() => caregiverApi.patientSummary(patientId), [patientId]);

  return (
    <Modal title="Patient summary" onClose={onClose} wide>
      {loading ? (
        <Spinner label="Loading…" />
      ) : error ? (
        <ErrorState error={error} />
      ) : (
        <>
          <h3>{data.patient.name}</h3>
          <p className="text-sm text-muted">{data.patient.email}</p>

          {data.adherence && (
            <div className="grid grid--3 mb-4">
              <Stat label="30-day adherence" value={percent(data.adherence.adherenceScore)} />
              <Stat label="Taken" value={data.adherence.taken} />
              <Stat label="Missed / skipped" value={data.adherence.missed + data.adherence.skipped} />
            </div>
          )}

          {data.today && (
            <>
              <h4>Today's doses</h4>
              {data.today.length === 0 ? (
                <p className="text-sm text-muted">Nothing scheduled today.</p>
              ) : (
                <ul className="text-sm">
                  {data.today.map((occ, index) => (
                    <li key={index}>
                      {occ.time} — {occ.medicine?.name} · <strong>{occ.status}</strong>
                    </li>
                  ))}
                </ul>
              )}
              {data.missedToday > 0 && (
                <Alert variant="warning">{data.missedToday} dose(s) missed or overdue today.</Alert>
              )}
            </>
          )}

          {data.lowStock?.length > 0 && (
            <>
              <h4>Running low</h4>
              <ul className="text-sm">
                {data.lowStock.map((m) => (
                  <li key={m.id}>
                    {m.name} — {m.currentStock} left
                  </li>
                ))}
              </ul>
            </>
          )}

          <p className="text-xs text-muted mt-4 mb-0">
            You see only what this patient has permitted. Every view is recorded in their audit
            trail.
          </p>
        </>
      )}
    </Modal>
  );
}
