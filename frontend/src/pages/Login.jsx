import { useState } from 'react';
import { Link, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Alert, Field } from '../components/ui';

export default function Login() {
  const { login, isAuthenticated, sessionExpired, dismissSessionExpired } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (isAuthenticated) {
    return <Navigate to={location.state?.from || '/dashboard'} replace />;
  }

  const update = (field) => (event) => setForm({ ...form, [field]: event.target.value });

  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      dismissSessionExpired();
      await login(form);
      navigate(location.state?.from || '/dashboard', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <aside className="auth-panel">
        <h2>Welcome back</h2>
        <p style={{ opacity: 0.85, marginBottom: 'var(--space-6)' }}>
          Sign in to see today's doses, your adherence and anything that needs a refill.
        </p>
        {[
          ['🔔', 'Visual reminders', 'See the actual photo of each medicine when a dose is due.'],
          ['📈', 'Adherence at a glance', 'Taken, skipped and missed doses counted separately.'],
          ['🔮', 'Refill prediction', 'Based on what you really take, not just the prescription.']
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

          <h1>Sign in</h1>
          <p className="text-muted">Enter your details to continue.</p>

          {sessionExpired && (
            <Alert variant="warning" title="Your session ended">
              Please sign in again to continue where you left off.
            </Alert>
          )}
          {error && <Alert variant="danger">{error.message}</Alert>}

          <form onSubmit={submit} noValidate>
            <Field label="Email address" htmlFor="login-email" required>
              <input
                id="login-email"
                className="input"
                type="email"
                autoComplete="email"
                required
                autoFocus
                value={form.email}
                onChange={update('email')}
                placeholder="you@example.com"
              />
            </Field>

            <Field label="Password" htmlFor="login-password" required>
              <input
                id="login-password"
                className="input"
                type="password"
                autoComplete="current-password"
                required
                value={form.password}
                onChange={update('password')}
                placeholder="Your password"
              />
            </Field>

            <button type="submit" className="btn btn--primary btn--block btn--lg" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="text-sm text-center mt-5">
            New to MedGuardian? <Link to="/register">Create an account</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
