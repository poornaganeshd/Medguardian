import { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { recordApi } from '../services/endpoints';
import useApi from '../hooks/useApi';
import { useToast } from '../context/ToastContext';
import { Card, Badge, Alert, Spinner, EmptyState, ErrorState, Modal, Field } from '../components/ui';
import { formatDate, RECORD_CATEGORY_LABEL, todayKey } from '../utils/format';

export default function Records() {
  const [filters, setFilters] = useState({ category: '', search: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);

  const { data, loading, error, reload } = useApi(
    () =>
      recordApi.list({
        page,
        limit: 20,
        category: filters.category || undefined,
        search: filters.search || undefined,
        from: filters.from || undefined,
        to: filters.to || undefined
      }),
    [page, filters.category, filters.search, filters.from, filters.to]
  );

  const update = (field) => (event) => {
    setFilters((current) => ({ ...current, [field]: event.target.value }));
    setPage(1);
  };

  const items = data?.items || [];

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="mb-0">Medical records</h1>
          <p className="page__subtitle">
            Prescriptions, pharmacy bills, lab reports and discharge summaries — private by default.
          </p>
        </div>
        <button type="button" className="btn btn--primary" onClick={() => setAdding(true)}>
          + Add a record
        </button>
      </div>

      <Card className="mb-4">
        <div className="form-grid">
          <Field label="Search" htmlFor="rec-search">
            <input
              id="rec-search"
              className="input"
              value={filters.search}
              onChange={update('search')}
              placeholder="Title, description, hospital or doctor"
            />
          </Field>
          <Field label="Category" htmlFor="rec-category">
            <select id="rec-category" className="select" value={filters.category} onChange={update('category')}>
              <option value="">All categories</option>
              {Object.entries(RECORD_CATEGORY_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="From" htmlFor="rec-from">
            <input id="rec-from" className="input" type="date" value={filters.from} onChange={update('from')} />
          </Field>
          <Field label="To" htmlFor="rec-to">
            <input id="rec-to" className="input" type="date" value={filters.to} onChange={update('to')} />
          </Field>
        </div>
      </Card>

      {loading && !data ? (
        <Spinner large label="Loading your records…" />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon="📄"
            title={filters.search || filters.category ? 'No matching records' : 'No records yet'}
            action={
              <button type="button" className="btn btn--primary btn--sm" onClick={() => setAdding(true)}>
                Add your first record
              </button>
            }
          >
            Keep your prescriptions, bills and reports here so they are with you at every
            appointment.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid grid--3">
          {items.map((record) => (
            <article key={record.id} className="card">
              <div className="card__body">
                <div className="row row--between mb-2">
                  <Badge variant="primary">{RECORD_CATEGORY_LABEL[record.category]}</Badge>
                  <div className="row">
                    {record.isSensitive && <Badge variant="danger">Sensitive</Badge>}
                    {record.shareableWithCaregivers && <Badge variant="info">Shared</Badge>}
                  </div>
                </div>
                <h3 className="mb-2">
                  <Link to={`/records/${record.id}`}>{record.title}</Link>
                </h3>
                <div className="text-sm text-muted mb-2">{formatDate(record.recordDate)}</div>
                {record.provider && <div className="text-sm">{record.provider}</div>}
                {record.description && (
                  <p className="text-sm text-muted mt-2" style={{ maxHeight: 60, overflow: 'hidden' }}>
                    {record.description}
                  </p>
                )}
                <div className="row mt-3">
                  {record.hasFile && <Badge variant="neutral">📎 File attached</Badge>}
                  {record.ocr?.status === 'completed' &&
                    record.ocr?.verificationStatus === 'awaiting_verification' && (
                      <Badge variant="warning">OCR needs review</Badge>
                    )}
                  {(record.tags || []).slice(0, 3).map((tag) => (
                    <Badge key={tag} variant="neutral">
                      #{tag}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="card__footer row">
                <Link to={`/records/${record.id}`} className="btn btn--secondary btn--sm">
                  Open
                </Link>
                {record.ocr?.verificationStatus === 'awaiting_verification' && (
                  <Link to={`/records/${record.id}/verify`} className="btn btn--primary btn--sm">
                    Review OCR
                  </Link>
                )}
              </div>
            </article>
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

      {adding && (
        <AddRecordModal
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            reload();
          }}
        />
      )}
    </>
  );
}

function AddRecordModal({ onClose, onSaved }) {
  const toast = useToast();
  const fileInput = useRef(null);
  const [form, setForm] = useState({
    title: '',
    category: 'prescription',
    recordDate: todayKey(),
    description: '',
    provider: '',
    doctorName: '',
    tags: '',
    shareableWithCaregivers: false,
    isSensitive: false,
    runOcr: true
  });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const update = (field) => (event) =>
    setForm((current) => ({
      ...current,
      [field]: event.target.type === 'checkbox' ? event.target.checked : event.target.value
    }));

  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    setBusy(true);

    const formData = new FormData();
    for (const [key, value] of Object.entries(form)) {
      if (value === '' || value === null || value === undefined) continue;
      formData.append(key, String(value));
    }
    if (file) formData.append('file', file);

    try {
      const result = await recordApi.create(formData);
      const suggestions = result.record.ocr?.suggestedMedicines?.length || 0;
      toast.success(
        suggestions > 0
          ? `Record saved. OCR found ${suggestions} possible medicine(s) for you to review.`
          : 'Record saved.'
      );
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const ocrCapable = file && ['image/jpeg', 'image/png', 'image/webp'].includes(file.type);

  return (
    <Modal
      title="Add a medical record"
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="record-form"
            className="btn btn--primary"
            disabled={busy || !form.title}
          >
            {busy ? 'Saving…' : 'Save record'}
          </button>
        </>
      }
    >
      {error && <ErrorState error={error} />}

      <form id="record-form" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Title" htmlFor="rec-title" required>
            <input
              id="rec-title"
              className="input"
              required
              autoFocus
              value={form.title}
              onChange={update('title')}
              placeholder="e.g. Blood test results, March 2026"
            />
          </Field>
          <Field label="Category" htmlFor="rec-cat" required>
            <select id="rec-cat" className="select" value={form.category} onChange={update('category')}>
              {Object.entries(RECORD_CATEGORY_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Date on the document" htmlFor="rec-date" required>
            <input
              id="rec-date"
              className="input"
              type="date"
              required
              value={form.recordDate}
              onChange={update('recordDate')}
            />
          </Field>
          <Field label="Hospital or clinic" htmlFor="rec-provider">
            <input id="rec-provider" className="input" value={form.provider} onChange={update('provider')} />
          </Field>
          <Field label="Doctor" htmlFor="rec-doctor">
            <input id="rec-doctor" className="input" value={form.doctorName} onChange={update('doctorName')} />
          </Field>
          <Field label="Tags" htmlFor="rec-tags" hint="Comma separated.">
            <input
              id="rec-tags"
              className="input"
              value={form.tags}
              onChange={update('tags')}
              placeholder="diabetes, annual"
            />
          </Field>
        </div>

        <Field label="Description" htmlFor="rec-desc">
          <textarea
            id="rec-desc"
            className="textarea"
            value={form.description}
            onChange={update('description')}
            maxLength={2000}
          />
        </Field>

        <Field label="Document" hint="JPEG, PNG, WebP, PDF or plain text, up to 10 MB.">
          <input
            ref={fileInput}
            id="rec-file"
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf,text/plain"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
            className="input"
          />
          {file && <div className="field__hint">Selected: {file.name}</div>}
        </Field>

        {ocrCapable && (
          <label className="checkbox mb-4">
            <input type="checkbox" checked={form.runOcr} onChange={update('runOcr')} />
            <span className="checkbox__text">
              <span className="checkbox__title">Read the text from this image (OCR)</span>
              <span className="checkbox__desc">
                MedGuardian will extract the text and suggest medicines it finds.{' '}
                <strong>Nothing is added to your medicine list until you review and confirm it.</strong>
              </span>
            </span>
          </label>
        )}

        <Alert variant="neutral" title="Who can see this record">
          <p className="mb-0 text-sm">
            Records are private to you by default. Sharing with caregivers is off unless you turn it
            on, and a record marked sensitive is never visible to a caregiver at all.
          </p>
        </Alert>

        <label className="checkbox mb-3">
          <input
            type="checkbox"
            checked={form.shareableWithCaregivers}
            onChange={update('shareableWithCaregivers')}
          />
          <span className="checkbox__text">
            <span className="checkbox__title">Share with my caregivers</span>
            <span className="checkbox__desc">
              Only caregivers you have granted the "view records" permission will see it.
            </span>
          </span>
        </label>

        <label className="checkbox">
          <input type="checkbox" checked={form.isSensitive} onChange={update('isSensitive')} />
          <span className="checkbox__text">
            <span className="checkbox__title">Mark as sensitive</span>
            <span className="checkbox__desc">Never shown to a caregiver, whatever their permissions.</span>
          </span>
        </label>
      </form>
    </Modal>
  );
}
