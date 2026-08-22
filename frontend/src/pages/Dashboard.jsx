import { Link } from 'react-router-dom';
import { dashboardApi } from '../services/endpoints';
import useApi from '../hooks/useApi';
import useDoseRecorder from '../hooks/useDoseRecorder';
import { useAuth } from '../context/AuthContext';
import DoseCard from '../components/DoseCard';
import SkipReasonModal from '../components/SkipReasonModal';
import { Card, Stat, Alert, Spinner, EmptyState, Badge, ErrorState, Meter } from '../components/ui';
import {
  formatDate,
  percent,
  ADHERENCE_LABEL,
  ADHERENCE_VARIANT,
  URGENCY_LABEL,
  URGENCY_VARIANT,
  RECORD_CATEGORY_LABEL,
  pluralUnit
} from '../utils/format';

export default function Dashboard() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useApi(() => dashboardApi.get(), []);
  const recorder = useDoseRecorder(reload);

  if (loading && !data) return <Spinner large label="Loading your dashboard…" />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;

  const {
    today,
    todaySummary,
    upcoming,
    adherence,
    adherenceDaily,
    stock,
    refillWarnings,
    interactionAlerts,
    recentRecords,
    caregivers
  } = data;

  const greeting = (() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  })();

  const remaining = (todaySummary.due || 0) + (todaySummary.late || 0) + (todaySummary.upcoming || 0);

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="mb-0">
            {greeting}, {user?.name?.split(' ')[0]}
          </h1>
          <p className="page__subtitle">{formatDate(data.date, 'dddd, D MMMM YYYY')}</p>
        </div>
        <div className="row">
          <Link to="/medicines/new" className="btn btn--secondary">
            + Add medicine
          </Link>
          <Link to="/reminders" className="btn btn--primary">
            Today's reminders
          </Link>
        </div>
      </div>

      {/* ------------------------------------------------------- key stats */}
      <div className="grid grid--4 mb-5">
        <Stat
          label="Doses today"
          value={`${todaySummary.taken || 0}/${todaySummary.total || 0}`}
          meta={remaining > 0 ? `${remaining} still to take` : 'All doses accounted for'}
        />
        <Stat
          label="30-day adherence"
          value={percent(adherence.adherenceScore)}
          meta={ADHERENCE_LABEL[adherence.adherenceLabel]}
        />
        <Stat
          label="Medicines"
          value={stock.total}
          meta={stock.needingRefill > 0 ? `${stock.needingRefill} need a refill` : 'All well stocked'}
        />
        <Stat
          label="Interaction alerts"
          value={interactionAlerts.total}
          meta={
            interactionAlerts.total > 0
              ? `Highest severity: ${interactionAlerts.highestSeverity}`
              : 'None found in the dataset'
          }
        />
      </div>

      {/* ------------------------------------------------------- warnings */}
      {interactionAlerts.major > 0 && (
        <Alert variant="danger" title={`${interactionAlerts.major} major interaction alert(s)`}>
          <p className="mb-2">
            Your medicine list contains a combination flagged as major in the interaction dataset.
            Review it, and check with your pharmacist before your next dose.
          </p>
          <Link to="/interactions" className="btn btn--danger btn--sm">
            Review interactions
          </Link>
        </Alert>
      )}

      {refillWarnings.length > 0 && (
        <Alert variant="warning" title="Refills needed soon">
          <ul className="mb-2">
            {refillWarnings.map((w) => (
              <li key={w.medicineId}>
                <strong>{w.medicineName}</strong> — {pluralUnit(w.currentStock, w.unit)} left
                {w.daysOfSupply !== null && `, about ${w.daysOfSupply} day(s) of supply`}
                {w.suggestedRefillDate && `. Reorder around ${formatDate(w.suggestedRefillDate)}`}{' '}
                <Badge variant={URGENCY_VARIANT[w.urgency]}>{URGENCY_LABEL[w.urgency]}</Badge>
              </li>
            ))}
          </ul>
          <Link to="/adherence" className="btn btn--secondary btn--sm">
            See the full refill forecast
          </Link>
        </Alert>
      )}

      <div className="grid grid--2 mb-5" style={{ alignItems: 'start' }}>
        {/* ------------------------------------------------------- today */}
        <Card
          title="Today's medicines"
          actions={
            <Link to="/reminders" className="btn btn--ghost btn--sm">
              View all
            </Link>
          }
        >
          {today.length === 0 ? (
            <EmptyState
              icon="🗓️"
              title="Nothing scheduled for today"
              action={
                <Link to="/schedules" className="btn btn--primary btn--sm">
                  Set up a schedule
                </Link>
              }
            >
              Add a medicine and give it a schedule to see your doses here.
            </EmptyState>
          ) : (
            <div className="stack">
              {today.slice(0, 5).map((occurrence) => (
                <DoseCard
                  key={`${occurrence.scheduleId}-${occurrence.time}`}
                  occurrence={occurrence}
                  onRecord={recorder.record}
                  busy={recorder.isBusy(occurrence)}
                  compact
                />
              ))}
              {today.length > 5 && (
                <Link to="/reminders" className="text-sm text-center">
                  + {today.length - 5} more today
                </Link>
              )}
            </div>
          )}
        </Card>

        {/* --------------------------------------------------- adherence */}
        <Card
          title="Adherence over the last 14 days"
          actions={
            <Badge variant={ADHERENCE_VARIANT[adherence.adherenceLabel]}>
              {ADHERENCE_LABEL[adherence.adherenceLabel]}
            </Badge>
          }
        >
          {adherence.adherenceScore === null ? (
            <EmptyState icon="📊" title="Not enough data yet">
              Once you have recorded a few doses, your adherence trend appears here.
            </EmptyState>
          ) : (
            <>
              <div className="row row--between mb-3">
                <div>
                  <div className="stat__value">{percent(adherence.adherenceScore)}</div>
                  <div className="text-sm text-muted">
                    {adherence.taken} taken · {adherence.skipped} skipped · {adherence.missed} missed
                  </div>
                </div>
              </div>
              <Meter
                value={adherence.adherenceScore}
                variant={
                  adherence.adherenceScore >= 80
                    ? undefined
                    : adherence.adherenceScore >= 60
                      ? 'warning'
                      : 'danger'
                }
              />
              <div className="bar-chart mt-4" role="img" aria-label="Daily adherence for the last 14 days">
                {adherenceDaily.map((day) => {
                  const score = day.adherenceScore;
                  const height = score === null ? 4 : Math.max(4, score);
                  const tone =
                    score === null ? 'none' : score >= 80 ? '' : score >= 50 ? 'mid' : 'low';
                  return (
                    <div key={day.date} className="bar-chart__col" title={`${day.date}: ${percent(score)}`}>
                      <div
                        className={`bar-chart__bar ${tone ? `bar-chart__bar--${tone}` : ''}`}
                        style={{ height: `${height}%` }}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="row row--between text-xs text-muted mt-2">
                <span>{adherenceDaily[0]?.date}</span>
                <span>{adherenceDaily[adherenceDaily.length - 1]?.date}</span>
              </div>
            </>
          )}
        </Card>
      </div>

      <div className="grid grid--3">
        {/* ------------------------------------------------------ upcoming */}
        <Card title="Coming up next">
          {upcoming.length === 0 ? (
            <EmptyState icon="✅" title="Nothing else scheduled">
              You are all caught up for the next few days.
            </EmptyState>
          ) : (
            <ul style={{ listStyle: 'none', paddingLeft: 0, marginBottom: 0 }}>
              {upcoming.slice(0, 6).map((o) => (
                <li
                  key={`${o.scheduleId}-${o.dateKey}-${o.time}`}
                  className="row row--between"
                  style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}
                >
                  <span>
                    <strong>{o.medicine?.name}</strong>
                    <span className="text-xs text-muted"> · {o.dateKey}</span>
                  </span>
                  <span className="mono text-sm">{o.time}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* ------------------------------------------------------- records */}
        <Card
          title="Recent medical records"
          actions={
            <Link to="/records" className="btn btn--ghost btn--sm">
              All records
            </Link>
          }
        >
          {recentRecords.length === 0 ? (
            <EmptyState
              icon="📄"
              title="No records yet"
              action={
                <Link to="/records" className="btn btn--primary btn--sm">
                  Add a record
                </Link>
              }
            >
              Store prescriptions, bills, lab reports and discharge summaries here.
            </EmptyState>
          ) : (
            <ul style={{ listStyle: 'none', paddingLeft: 0, marginBottom: 0 }}>
              {recentRecords.map((record) => (
                <li key={record.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <Link to={`/records/${record.id}`} className="font-semibold">
                    {record.title}
                  </Link>
                  <div className="text-xs text-muted">
                    {RECORD_CATEGORY_LABEL[record.category]} · {formatDate(record.recordDate)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* ---------------------------------------------------- caregivers */}
        <Card
          title="Caregivers"
          actions={
            <Link to="/caregivers" className="btn btn--ghost btn--sm">
              Manage
            </Link>
          }
        >
          {caregivers.myCaregivers.length === 0 ? (
            <EmptyState
              icon="👥"
              title="No caregiver added"
              action={
                <Link to="/caregivers" className="btn btn--secondary btn--sm">
                  Invite someone
                </Link>
              }
            >
              Adding a caregiver is entirely optional — and you decide exactly what they can see.
            </EmptyState>
          ) : (
            <ul style={{ listStyle: 'none', paddingLeft: 0, marginBottom: 0 }}>
              {caregivers.myCaregivers.map((c) => (
                <li key={c.id} className="row row--between" style={{ padding: '8px 0' }}>
                  <span>
                    <strong>{c.name || c.email}</strong>
                    {c.relationship && <span className="text-xs text-muted"> · {c.relationship}</span>}
                  </span>
                  <Badge variant={c.status === 'accepted' ? 'success' : 'warning'}>
                    {c.status === 'accepted' ? 'Active' : 'Invited'}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {recorder.skipTarget && (
        <SkipReasonModal
          occurrence={recorder.skipTarget}
          onCancel={recorder.cancelSkip}
          onConfirm={recorder.confirmSkip}
          busy={Boolean(recorder.busyKey)}
        />
      )}
    </>
  );
}
