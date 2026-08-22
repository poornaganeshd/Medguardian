import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Alert, Field } from '../components/ui';

/** Mirrors the server-side password policy so the user gets instant feedback. */
const RULES = [
  { id: 'length', label: 'At least 8 characters', test: (v) => v.length >= 8 },
  { id: 'lower', label: 'A lowercase letter', test: (v) => /[a-z]/.test(v) },
  { id: 'upper', label: 'An uppercase letter', test: (v) => /[A-Z]/.test(v) },
  { id: 'digit', label: 'A number', test: (v) => /\d/.test(v) }
];

export default function Register() {
  const { register, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    role: 'patient',
    phone: ''
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (isAuthenticated) return <Navigate to="/dashboard" replace />;

  const update = (field) => (event) => setForm({ ...form, [field]: event.target.value });

  const passwordOk = RULES.every((rule) => rule.test(form.password));
  const matches = form.password === form.confirmPassword;

  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    if (!matches) {
      setError(new Error('The two passwords do not match.'));
      return;
    }
    setBusy(true);
    try {
      const { confirmPassword, ...payload } = form;
      if (!payload.phone) delete payload.phone;
      await register(payload);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <aside className="auth-panel">
        <h2>Start with MedGuardian</h2>
        <p style={{ opacity: 0.85, marginBottom: 'var(--space-6)' }}>
          A private place for your medicines, doses and medical documents.
        </p>
        {[
          ['💊', 'Add your medicines', 'Including a photo, so a reminder shows the real tablet.'],
          ['📅', 'Set your schedule', 'Daily, specific days, every few days, or as needed.'],
          ['👥', 'Add a caregiver — or not', 'Entirely optional, and you choose what they can see.']
        ].map(([icon, title, body]) => (
          <div key={title} className="auth-panel__feature">
            <span className="auth-panel__feature-icon" aria-hidden="true">
              {icon}
            </span>
            <div>
              <strong>{title}</strong>
              <div className="text-sm" style={{ opacity: 0.8 }}>
                {body}
              </div>
            </div>
          </div>
        ))}
      </aside>

      <div className="auth-form-wrap">
        <div className="auth-form">
          <Link to="/" className="auth-form__brand" style={{ color: 'inherit' }}>
            <span
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                background: 'var(--teal-700)',
                display: 'grid',
                placeItems: 'center'
              }}
              aria-hidden="true"
            >
              🛡️
            </span>
            MedGuardian
          </Link>

          <h1>Create your account</h1>
          <p className="text-muted">It takes about a minute.</p>

          {error && <Alert variant="danger">{error.message}</Alert>}

          <form onSubmit={submit} noValidate>
            <Field label="Full name" htmlFor="reg-name" required>
              <input
                id="reg-name"
                className="input"
                required
                autoFocus
                autoComplete="name"
                value={form.name}
                onChange={update('name')}
                placeholder="Asha Menon"
              />
            </Field>

            <Field label="Email address" htmlFor="reg-email" required>
              <input
                id="reg-email"
                className="input"
                type="email"
                required
                autoComplete="email"
                value={form.email}
                onChange={update('email')}
                placeholder="you@example.com"
              />
            </Field>

            <Field
              label="I am signing up as"
              htmlFor="reg-role"
              hint="Choose Caregiver only if someone has invited you to help them. You can be both later."
            >
              <select id="reg-role" className="select" value={form.role} onChange={update('role')}>
                <option value="patient">A patient, managing my own medicines</option>
                <option value="caregiver">A caregiver, helping someone else</option>
              </select>
            </Field>

            <Field label="Phone number" htmlFor="reg-phone" hint="Optional.">
              <input
                id="reg-phone"
                className="input"
                type="tel"
                autoComplete="tel"
                value={form.phone}
                onChange={update('phone')}
                placeholder="+91 98765 43210"
              />
            </Field>

            <Field label="Password" htmlFor="reg-password" required>
              <input
                id="reg-password"
                className="input"
                type="password"
                required
                autoComplete="new-password"
                value={form.password}
                onChange={update('password')}
              />
            </Field>

            {form.password && (
              <ul className="text-xs" style={{ listStyle: 'none', paddingLeft: 0, marginTop: -8 }}>
                {RULES.map((rule) => {
                  const ok = rule.test(form.password);
                  return (
                    <li key={rule.id} className={ok ? 'text-success' : 'text-muted'}>
                      {ok ? '✓' : '○'} {rule.label}
                    </li>
                  );
                })}
              </ul>
            )}

            <Field
              label="Confirm password"
              htmlFor="reg-confirm"
              required
              error={form.confirmPassword && !matches ? 'The passwords do not match.' : null}
            >
              <input
                id="reg-confirm"
                className={`input ${form.confirmPassword && !matches ? 'input--error' : ''}`}
                type="password"
                required
                autoComplete="new-password"
                value={form.confirmPassword}
                onChange={update('confirmPassword')}
              />
            </Field>

            <button
              type="submit"
              className="btn btn--primary btn--block btn--lg"
              disabled={busy || !passwordOk || !matches}
            >
              {busy ? 'Creating your account…' : 'Create account'}
            </button>
          </form>

          <p className="text-sm text-center mt-5">
            Already registered? <Link to="/login">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
