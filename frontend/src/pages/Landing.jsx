import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const FEATURES = [
  {
    icon: '💊',
    title: 'Every medicine in one place',
    body: 'Name, strength, instructions, prescriber notes and a photo of the actual tablet, so there is never any doubt about what to take.'
  },
  {
    icon: '🔔',
    title: 'Visual reminders',
    body: 'Reminder cards show the photograph of your medicine rather than just a name — easier to check at a glance, and no spoken alerts.'
  },
  {
    icon: '📈',
    title: 'Honest adherence scoring',
    body: 'Taken, skipped and missed doses are counted separately. Doses still due today are not held against you.'
  },
  {
    icon: '🔮',
    title: 'Refill prediction that follows reality',
    body: 'The DRPA algorithm predicts your run-out date from what you actually take. Skip a dose and the tablet stays in the box — and in the forecast.'
  },
  {
    icon: '⚠️',
    title: 'Rule-based interaction checks',
    body: 'Your medicines are matched against a fixed, reviewed dataset. Deterministic lookups only — nothing is invented.'
  },
  {
    icon: '📄',
    title: 'Secure medical records',
    body: 'Prescriptions, bills, lab reports and discharge summaries, stored privately and released only to you and anyone you explicitly authorise.'
  },
  {
    icon: '🔍',
    title: 'OCR you stay in control of',
    body: 'Photograph a prescription and text is extracted for you — but nothing is added to your medicine list until you review and confirm it.'
  },
  {
    icon: '👥',
    title: 'Caregiver access, precisely scoped',
    body: 'Invite a family member and choose exactly what they may see. Records and dose recording stay off until you turn them on.'
  }
];

export default function Landing() {
  const { isAuthenticated } = useAuth();
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--surface)' }}>
      <nav className="landing-nav">
        <span className="row" style={{ gap: 10, fontWeight: 700, fontSize: '1.15rem' }}>
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
        </span>
        <div className="topbar__spacer" />
        <Link to="/login" className="btn btn--ghost">
          Sign in
        </Link>
        <Link to="/register" className="btn btn--primary">
          Create account
        </Link>
      </nav>

      <header className="landing-hero">
        <div>
          <span className="badge badge--primary mb-3">Patient-centred medication management</span>
          <h1>Keep track of your medicines without keeping it all in your head.</h1>
          <p className="text-muted" style={{ fontSize: '1.05rem', maxWidth: '52ch' }}>
            MedGuardian brings your medicines, doses, refills and medical documents together in one
            private place — with visual reminders, an honest adherence score and a refill prediction
            that follows what you actually take.
          </p>
          <div className="row mt-4">
            <Link to="/register" className="btn btn--primary btn--lg">
              Get started — it's free
            </Link>
            <Link to="/login" className="btn btn--secondary btn--lg">
              I already have an account
            </Link>
          </div>
          <p className="text-xs text-muted mt-4" style={{ maxWidth: '56ch' }}>
            MedGuardian is an academic project. It helps you organise information you already have.
            It does not diagnose, prescribe, or replace advice from your doctor or pharmacist.
          </p>
        </div>

        <div className="card" style={{ padding: 'var(--space-5)' }}>
          <div className="row row--between mb-4">
            <strong>Today</strong>
            <span className="badge badge--success">3 of 4 taken</span>
          </div>
          <div className="stack">
            <div className="dose-card dose-card--taken">
              <div className="medicine-thumb medicine-thumb--placeholder" aria-hidden="true">
                💊
              </div>
              <div className="dose-card__body">
                <div className="dose-card__time">8:00 AM</div>
                <div className="dose-card__name">Metformin 500 mg</div>
                <div className="dose-card__meta">1 tablet · after breakfast</div>
              </div>
              <span className="badge badge--success">Taken</span>
            </div>
            <div className="dose-card dose-card--due">
              <div className="medicine-thumb medicine-thumb--placeholder" aria-hidden="true">
                💊
              </div>
              <div className="dose-card__body">
                <div className="dose-card__time">1:00 PM</div>
                <div className="dose-card__name">Amlodipine 5 mg</div>
                <div className="dose-card__meta">1 tablet · with lunch</div>
              </div>
              <span className="badge badge--warning">Due now</span>
            </div>
            <div className="dose-card dose-card--upcoming">
              <div className="medicine-thumb medicine-thumb--placeholder" aria-hidden="true">
                💊
              </div>
              <div className="dose-card__body">
                <div className="dose-card__time">9:00 PM</div>
                <div className="dose-card__name">Atorvastatin 10 mg</div>
                <div className="dose-card__meta">1 tablet · at bedtime</div>
              </div>
              <span className="badge badge--info">Upcoming</span>
            </div>
          </div>
          <div className="alert alert--warning mt-4 mb-0">
            <span className="alert__icon" aria-hidden="true">
              ⚠️
            </span>
            <div className="alert__body">
              <div className="alert__title">Metformin runs out in 6 days</div>
              <span className="text-sm">Reorder around 4 April at your current rate of use.</span>
            </div>
          </div>
        </div>
      </header>

      <section className="landing-section" style={{ background: 'var(--slate-50)' }}>
        <div className="landing-section__inner">
          <h2 className="text-center mb-5">Everything a patient actually needs</h2>
          <div className="grid grid--3">
            {FEATURES.map((feature) => (
              <article key={feature.title} className="card feature-card">
                <div className="feature-card__icon" aria-hidden="true">
                  {feature.icon}
                </div>
                <h3>{feature.title}</h3>
                <p className="text-sm text-muted mb-0">{feature.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-section">
        <div className="landing-section__inner">
          <div className="grid grid--2">
            <div>
              <h2>Your data stays yours</h2>
              <ul className="text-muted">
                <li>Passwords and PINs are hashed with bcrypt — never stored in readable form.</li>
                <li>
                  Sensitive actions (deleting records, changing caregiver access) need a second
                  confirmation with your PIN or your device's fingerprint or face unlock.
                </li>
                <li>
                  Uploaded documents are never served from a public URL. Every download re-checks
                  who you are and is written to your audit trail.
                </li>
                <li>
                  Medical records are private by default. Caregivers see only what you share, and
                  only the permissions you grant.
                </li>
              </ul>
            </div>
            <div>
              <h2>Explainable, not magical</h2>
              <ul className="text-muted">
                <li>
                  The refill prediction shows its working: the rates it used, the confidence it had
                  and the reason it did or did not apply a trend fit.
                </li>
                <li>
                  Drug interactions come from a fixed dataset with severity, mechanism and
                  precautions written by hand — no model invents them.
                </li>
                <li>
                  The medicine information assistant retrieves from a curated library and refuses
                  anything that would amount to diagnosis, prescribing or a dose change.
                </li>
                <li>Health insights describe your routine — never your health.</li>
              </ul>
            </div>
          </div>
          <div className="text-center mt-5">
            <Link to="/register" className="btn btn--primary btn--lg">
              Create your account
            </Link>
          </div>
        </div>
      </section>

      <footer
        style={{
          borderTop: '1px solid var(--border)',
          padding: 'var(--space-5)',
          textAlign: 'center'
        }}
        className="text-sm text-muted"
      >
        MedGuardian — Intelligent Personal Medication and Medical Record Management Platform.
        <br />
        Final-year academic project. Not a medical device and not a substitute for professional
        advice.
      </footer>
    </div>
  );
}
