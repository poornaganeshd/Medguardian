import { useState } from 'react';
import { Link } from 'react-router-dom';
import { medicineApi } from '../services/endpoints';
import useApi from '../hooks/useApi';
import { Card, Badge, Spinner, EmptyState, ErrorState, Meter } from '../components/ui';
import { pluralUnit, formatDate } from '../utils/format';

const DOSAGE_FORMS = [
  'tablet', 'capsule', 'syrup', 'suspension', 'injection', 'drops',
  'inhaler', 'cream', 'ointment', 'gel', 'patch', 'suppository',
  'powder', 'spray', 'other'
];

export default function Medicines() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('active');
  const [dosageForm, setDosageForm] = useState('');
  const [needsRefill, setNeedsRefill] = useState('');
  const [page, setPage] = useState(1);

  const { data, loading, error, reload } = useApi(
    () =>
      medicineApi.list({
        page,
        limit: 20,
        status,
        search: search || undefined,
        dosageForm: dosageForm || undefined,
        needsRefill: needsRefill || undefined
      }),
    [page, status, search, dosageForm, needsRefill]
  );

  const items = data?.items || [];

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="mb-0">My medicines</h1>
          <p className="page__subtitle">
            {data ? `${data.total} medicine(s)` : 'Everything you are currently taking'}
          </p>
        </div>
        <Link to="/medicines/new" className="btn btn--primary">
          + Add medicine
        </Link>
      </div>

      <Card className="mb-4">
        <div className="form-grid">
          <div className="field">
            <label className="field__label" htmlFor="med-search">
              Search
            </label>
            <input
              id="med-search"
              className="input"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Name, generic name or purpose"
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="med-status">
              Status
            </label>
            <select
              id="med-status"
              className="select"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="active">Active</option>
              <option value="inactive">Archived</option>
              <option value="all">All</option>
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="med-form">
              Form
            </label>
            <select
              id="med-form"
              className="select"
              value={dosageForm}
              onChange={(event) => {
                setDosageForm(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Any form</option>
              {DOSAGE_FORMS.map((form) => (
                <option key={form} value={form} style={{ textTransform: 'capitalize' }}>
                  {form}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="med-refill">
              Stock
            </label>
            <select
              id="med-refill"
              className="select"
              value={needsRefill}
              onChange={(event) => {
                setNeedsRefill(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Any stock level</option>
              <option value="true">Needs a refill</option>
              <option value="false">Well stocked</option>
            </select>
          </div>
        </div>
      </Card>

      {loading && !data ? (
        <Spinner large label="Loading your medicines…" />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon="💊"
            title={search || dosageForm || needsRefill ? 'No matches' : 'No medicines yet'}
            action={
              <Link to="/medicines/new" className="btn btn--primary btn--sm">
                Add your first medicine
              </Link>
            }
          >
            {search || dosageForm || needsRefill
              ? 'Try clearing the filters above.'
              : 'Add a medicine to start tracking doses, stock and refills.'}
          </EmptyState>
        </Card>
      ) : (
        <div className="grid grid--3">
          {items.map((medicine) => (
            <MedicineCard key={medicine.id} medicine={medicine} />
          ))}
        </div>
      )}

      {data && data.pages > 1 && (
        <div className="row row--between mt-5">
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            ← Previous
          </button>
          <span className="text-sm text-muted">
            Page {data.page} of {data.pages}
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
    </>
  );
}

function MedicineCard({ medicine }) {
  const stockPct =
    medicine.initialQuantity > 0
      ? (medicine.currentStock / medicine.initialQuantity) * 100
      : 0;
  const stockVariant = medicine.needsRefill
    ? medicine.currentStock <= 0
      ? 'danger'
      : 'warning'
    : undefined;

  return (
    <article className="card">
      <div className="card__body">
        <div className="row mb-3" style={{ alignItems: 'flex-start' }}>
          {medicine.image?.filename ? (
            <img
              className="medicine-thumb"
              src={medicineApi.imageUrl(medicine.id, 'thumbnail')}
              alt={`Photo of ${medicine.name}`}
              loading="lazy"
            />
          ) : (
            <div className="medicine-thumb medicine-thumb--placeholder" aria-hidden="true">
              💊
            </div>
          )}
          <div className="flex-1" style={{ minWidth: 0 }}>
            <Link to={`/medicines/${medicine.id}`}>
              <strong>{medicine.name}</strong>
            </Link>
            {medicine.strength && <div className="text-sm text-muted">{medicine.strength}</div>}
            {medicine.genericName && medicine.genericName !== medicine.name && (
              <div className="text-xs text-muted">{medicine.genericName}</div>
            )}
          </div>
          {!medicine.isActive && <Badge variant="neutral">Archived</Badge>}
        </div>

        {medicine.purpose && <p className="text-sm text-muted">{medicine.purpose}</p>}

        <div className="row row--between text-sm mb-2">
          <span className="text-muted">Stock</span>
          <span className="font-semibold">
            {pluralUnit(medicine.currentStock, medicine.unit)}
            {medicine.needsRefill && (
              <>
                {' '}
                <Badge variant={medicine.currentStock <= 0 ? 'danger' : 'warning'}>
                  {medicine.currentStock <= 0 ? 'Out of stock' : 'Low'}
                </Badge>
              </>
            )}
          </span>
        </div>
        <Meter value={stockPct} variant={stockVariant} />
        <div className="text-xs text-muted mt-2">
          Refill threshold: {medicine.refillThreshold} {medicine.unit}(s)
          {medicine.expiryDate && ` · Expires ${formatDate(medicine.expiryDate)}`}
        </div>

        {medicine.isExpired && (
          <div className="text-xs text-danger mt-2">⚠️ This medicine is past its expiry date.</div>
        )}
      </div>
      <div className="card__footer row">
        <Link to={`/medicines/${medicine.id}`} className="btn btn--secondary btn--sm">
          Details
        </Link>
        <Link to={`/medicines/${medicine.id}/edit`} className="btn btn--ghost btn--sm">
          Edit
        </Link>
      </div>
    </article>
  );
}
