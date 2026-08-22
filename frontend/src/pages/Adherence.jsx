import { useState } from 'react';
import { Link } from 'react-router-dom';
import { analyticsApi } from '../services/endpoints';
import useApi from '../hooks/useApi';
import { Card, Stat, Badge, Alert, Spinner, EmptyState, ErrorState, Meter } from '../components/ui';
import {
  percent,
  formatDate,
  pluralUnit,
  ADHERENCE_LABEL,
  ADHERENCE_VARIANT,
  URGENCY_LABEL,
  URGENCY_VARIANT
} from '../utils/format';

const WINDOWS = [
  [7, 'Last 7 days'],
  [30, 'Last 30 days'],
  [90, 'Last 90 days']
];

export default function Adherence() {
  const [days, setDays] = useState(30);
  const [tab, setTab] = useState('adherence');

  const adherence = useApi(() => analyticsApi.adherence({ days }), [days]);
  const refills = useApi(() => analyticsApi.refillOverview(), []);

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="mb-0">Adherence &amp; refills</h1>
          <p className="page__subtitle">
            How closely you are following your schedule, and when each medicine runs out.
          </p>
        </div>
        <select
          className="select"
          value={days}
          onChange={(event) => setDays(Number(event.target.value))}
          style={{ width: 'auto' }}
          aria-label="Time window"
        >
          {WINDOWS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className="tabs">
        <button
          type="button"
          className={`tab ${tab === 'adherence' ? 'tab--active' : ''}`}
          onClick={() => setTab('adherence')}
        >
          Adherence score
        </button>
        <button
          type="button"
          className={`tab ${tab === 'refill' ? 'tab--active' : ''}`}
          onClick={() => setTab('refill')}
        >
          Refill prediction (DRPA)
        </button>
      </div>

      {tab === 'adherence' ? (
        <AdherenceTab query={adherence} days={days} />
      ) : (
        <RefillTab query={refills} />
      )}
    </>
  );
}

function AdherenceTab({ query, days }) {
  if (query.loading && !query.data) return <Spinner large label="Calculating adherence…" />;
  if (query.error) return <ErrorState error={query.error} onRetry={query.reload} />;
  if (!query.data) return null;

  const { summary, byMedicine, daily } = query.data;

  if (summary.expected === 0) {
    return (
      <Card>
        <EmptyState
          icon="📊"
          title="No scheduled doses in this period"
          action={
            <Link to="/schedules" className="btn btn--primary btn--sm">
              Set up a schedule
            </Link>
          }
        >
          Adherence is measured against your fixed schedules. As-needed medicines are never counted.
        </EmptyState>
      </Card>
    );
  }

  return (
    <>
      <div className="grid grid--4 mb-5">
        <Stat
          label="Adherence score"
          value={percent(summary.adherenceScore)}
          meta={ADHERENCE_LABEL[summary.adherenceLabel]}
        />
        <Stat label="Doses taken" value={summary.taken} meta={`of ${summary.evaluatedDoses} evaluated`} />
        <Stat label="Skipped" value={summary.skipped} meta="You chose not to take these" />
        <Stat label="Missed" value={summary.missed} meta="No record was made" />
      </div>

      <Alert variant="neutral" title="How this score is calculated">
        <p className="mb-0">
          <strong>Adherence = taken ÷ (expected − still&nbsp;pending) × 100.</strong> Over the last{' '}
          {days} days your schedules called for <strong>{summary.expected}</strong> dose(s).{' '}
          {summary.pending > 0 && (
            <>
              <strong>{summary.pending}</strong> of those are still actionable right now and are held
              out of the calculation, so the score does not dip and recover through the day.{' '}
            </>
          )}
          {summary.lateButTaken > 0 && (
            <>
              <strong>{summary.lateButTaken}</strong> dose(s) were taken later than scheduled — they
              still count as taken.{' '}
            </>
          )}
          Medicines taken only as needed produce no expected doses and never affect this figure.
        </p>
      </Alert>

      <div className="grid grid--2" style={{ alignItems: 'start' }}>
        <Card title="Daily trend">
          <div className="bar-chart" role="img" aria-label={`Daily adherence over ${days} days`}>
            {daily.map((day) => {
              const score = day.adherenceScore;
              const height = score === null ? 4 : Math.max(4, score);
              const tone = score === null ? 'none' : score >= 80 ? '' : score >= 50 ? 'mid' : 'low';
              return (
                <div
                  key={day.date}
                  className="bar-chart__col"
                  title={`${day.date}: ${percent(score)} (${day.taken}/${day.expected})`}
                >
                  <div
                    className={`bar-chart__bar ${tone ? `bar-chart__bar--${tone}` : ''}`}
                    style={{ height: `${height}%` }}
                  />
                </div>
              );
            })}
          </div>
          <div className="row row--between text-xs text-muted mt-2">
            <span>{daily[0]?.date}</span>
            <span>{daily[daily.length - 1]?.date}</span>
          </div>
          <div className="row mt-3 text-xs">
            <span>
              <span
                style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--teal-500)', borderRadius: 2 }}
              />{' '}
              80%+
            </span>
            <span>
              <span
                style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--amber-600)', borderRadius: 2 }}
              />{' '}
              50–79%
            </span>
            <span>
              <span
                style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--red-600)', borderRadius: 2 }}
              />{' '}
              Below 50%
            </span>
          </div>
        </Card>

        <Card title="By medicine">
          {byMedicine.length === 0 ? (
            <EmptyState icon="💊" title="No medicines to compare" />
          ) : (
            <div className="stack">
              {byMedicine
                .slice()
                .sort((a, b) => (a.adherenceScore ?? 101) - (b.adherenceScore ?? 101))
                .map((entry) => (
                  <div key={entry.medicineId}>
                    <div className="row row--between mb-2">
                      <span>
                        <strong>{entry.medicine?.name || 'Medicine'}</strong>{' '}
                        {entry.medicine?.strength && (
                          <span className="text-xs text-muted">{entry.medicine.strength}</span>
                        )}
                      </span>
                      <span className="font-semibold">{percent(entry.adherenceScore)}</span>
                    </div>
                    <Meter
                      value={entry.adherenceScore ?? 0}
                      variant={
                        entry.adherenceScore === null
                          ? undefined
                          : entry.adherenceScore >= 80
                            ? undefined
                            : entry.adherenceScore >= 60
                              ? 'warning'
                              : 'danger'
                      }
                    />
                    <div className="text-xs text-muted mt-2">
                      {entry.taken} taken · {entry.skipped} skipped · {entry.missed} missed
                      {entry.pending > 0 && ` · ${entry.pending} pending`}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function RefillTab({ query }) {
  if (query.loading && !query.data) return <Spinner large label="Running the refill prediction…" />;
  if (query.error) return <ErrorState error={query.error} onRetry={query.reload} />;
  if (!query.data) return null;

  const { items, summary } = query.data;

  if (items.length === 0) {
    return (
      <Card>
        <EmptyState
          icon="📦"
          title="No medicines to forecast"
          action={
            <Link to="/medicines/new" className="btn btn--primary btn--sm">
              Add a medicine
            </Link>
          }
        />
      </Card>
    );
  }

  return (
    <>
      <Alert variant="neutral" title="DRPA — Dynamic Refill Prediction Algorithm">
        <p className="mb-0">
          Each forecast is built from your <strong>actual</strong> intake, not just the
          prescription. A <strong>skipped dose is never deducted</strong> from your stock and never
          inflates the consumption rate — so if you skip regularly, your supply is correctly
          predicted to last longer. Expand any medicine below to see the exact numbers used.
        </p>
      </Alert>

      <div className="grid grid--3 mb-5">
        <Stat label="Medicines tracked" value={summary.total} />
        <Stat
          label="Need attention"
          value={summary.needingRefill}
          meta={summary.needingRefill > 0 ? 'Reorder these soon' : 'Nothing urgent'}
        />
        <Stat label="Forecast generated" value={formatDate(summary.generatedAt, 'D MMM, h:mm A')} />
      </div>

      <div className="stack">
        {items.map((item) => (
          <RefillRow key={item.medicineId} item={item} />
        ))}
      </div>
    </>
  );
}

function RefillRow({ item }) {
  const [open, setOpen] = useState(false);
  const { prediction, rates, consumption, regression, stock, unit } = item;

  return (
    <Card>
      <div className="row row--between mb-3">
        <div>
          <strong>{item.medicineName}</strong>
          <div className="text-sm text-muted">
            {pluralUnit(stock.currentStock, unit)} in stock · threshold {stock.refillThreshold}
          </div>
        </div>
        <div className="text-center">
          <div className="stat__value" style={{ fontSize: '1.4rem' }}>
            {prediction.daysOfSupply === null ? '—' : `${prediction.daysOfSupply}`}
          </div>
          <div className="text-xs text-muted">days of supply</div>
        </div>
        <Badge variant={URGENCY_VARIANT[prediction.urgency]}>{URGENCY_LABEL[prediction.urgency]}</Badge>
      </div>

      <div className="grid grid--3 text-sm mb-3">
        <div>
          <div className="text-muted text-xs">Runs out</div>
          <strong>{prediction.runOutDate ? formatDate(prediction.runOutDate) : 'Beyond the forecast'}</strong>
        </div>
        <div>
          <div className="text-muted text-xs">Reorder around</div>
          <strong>{formatDate(prediction.suggestedRefillDate)}</strong>
        </div>
        <div>
          <div className="text-muted text-xs">Suggested quantity</div>
          <strong>
            {prediction.suggestedRefillQuantity} {unit}(s) for 30 days
          </strong>
        </div>
      </div>

      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        {open ? 'Hide the calculation' : 'Show the calculation'}
      </button>

      {open && (
        <div className="mt-4">
          <div className="table-wrap">
            <table className="table">
              <tbody>
                <tr>
                  <td className="text-muted">Prescribed rate</td>
                  <td>
                    {rates.scheduledPerDay} {unit}(s)/day
                  </td>
                </tr>
                <tr>
                  <td className="text-muted">Observed rate</td>
                  <td>
                    {rates.observedPerDay === null
                      ? 'No recorded history yet'
                      : `${rates.observedPerDay} ${unit}(s)/day over ${consumption.observedDays} recorded day(s)`}
                  </td>
                </tr>
                <tr>
                  <td className="text-muted">Regression trend</td>
                  <td>
                    {regression.used ? (
                      <>
                        {rates.trendPerDay} {unit}(s)/day{' '}
                        <span className="text-xs text-muted">
                          (slope {regression.slopePerDay}/day, r² {regression.r2}, n=
                          {regression.samples})
                        </span>
                      </>
                    ) : (
                      <span className="text-muted">Not used — {regression.reasonIfUnused}</span>
                    )}
                  </td>
                </tr>
                <tr>
                  <td className="text-muted">Rate used</td>
                  <td>
                    <strong>
                      {rates.effectivePerDay} {unit}(s)/day
                    </strong>{' '}
                    <span className="text-xs text-muted">
                      ({Math.round(rates.confidenceWeight * 100)}% weight on your own history · basis:{' '}
                      {rates.basis.replace(/_/g, ' ')})
                    </span>
                  </td>
                </tr>
                <tr>
                  <td className="text-muted">Doses taken</td>
                  <td>
                    {consumption.takenDoses} of {consumption.expectedDoses} expected
                  </td>
                </tr>
                <tr>
                  <td className="text-muted">Skipped (not deducted)</td>
                  <td>
                    {consumption.skippedDoses} dose(s) ={' '}
                    {consumption.skippedQuantityNotDeducted} {unit}(s) left in the pack
                  </td>
                </tr>
                <tr>
                  <td className="text-muted">Missed (never recorded)</td>
                  <td>{consumption.missedDoses}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <h4 className="mt-4">In plain language</h4>
          <ul className="text-sm text-muted">
            {item.explanation.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
