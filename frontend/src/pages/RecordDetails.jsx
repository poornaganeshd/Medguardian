import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { recordApi } from '../services/endpoints';
import useApi from '../hooks/useApi';
import useStepUp from '../hooks/useStepUp';
import { useToast } from '../context/ToastContext';
import PinGate from '../components/PinGate';
import { Card, Badge, Alert, Spinner, ErrorState, Modal } from '../components/ui';
import { formatDate, formatDateTime, RECORD_CATEGORY_LABEL } from '../utils/format';

export default function RecordDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const stepUp = useStepUp();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [runningOcr, setRunningOcr] = useState(false);

  const { data, loading, error, reload } = useApi(() => recordApi.get(id), [id]);

  if (loading) return <Spinner large label="Opening record…" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const record = data?.record;
  if (!record) return null;

  const download = async () => {
    setDownloading(true);
    try {
      const response = await recordApi.download(id);
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = record.file?.originalName || 'document';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success('Downloaded. This access was recorded in your audit trail.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDownloading(false);
    }
  };

  const toggleSharing = async () => {
    try {
      await recordApi.update(id, { shareableWithCaregivers: !record.shareableWithCaregivers });
      toast.success(
        record.shareableWithCaregivers
          ? 'This record is private again.'
          : 'This record is now shared with authorised caregivers.'
      );
      reload();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const runOcr = async () => {
    setRunningOcr(true);
    try {
      const result = await recordApi.runOcr(id);
      toast.success(result.ocr?.suggestedMedicines?.length
        ? `Found ${result.ocr.suggestedMedicines.length} possible medicine(s) — please review them.`
        : 'Text extracted, but no medicines were recognised.');
      reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRunningOcr(false);
    }
  };

  const remove = async () => {
    try {
      await stepUp.run(() => recordApi.remove(id), 'delete this record');
      toast.success('Record and its file deleted.');
      navigate('/records');
    } catch (err) {
      if (!err.cancelled) toast.error(err.message);
    } finally {
      setConfirmDelete(false);
    }
  };

  const ocr = record.ocr || {};

  return (
    <>
      <div className="page__header">
        <div>
          <Link to="/records" className="text-sm">
            ← All records
          </Link>
          <h1 className="mb-0 mt-2">{record.title}</h1>
          <p className="page__subtitle">
            <Badge variant="primary">{RECORD_CATEGORY_LABEL[record.category]}</Badge>{' '}
            {formatDate(record.recordDate)}
            {record.provider && ` · ${record.provider}`}
            {record.doctorName && ` · ${record.doctorName}`}
          </p>
        </div>
        <div className="row">
          {record.hasFile && (
            <button type="button" className="btn btn--secondary" onClick={download} disabled={downloading}>
              {downloading ? 'Preparing…' : '⬇ Download file'}
            </button>
          )}
          <button type="button" className="btn btn--danger" onClick={() => setConfirmDelete(true)}>
            Delete
          </button>
        </div>
      </div>

      <div className="grid grid--2" style={{ alignItems: 'start' }}>
        <div className="stack">
          <Card title="Details">
            <dl style={{ margin: 0 }} className="text-sm">
              {[
                ['Description', record.description],
                ['Date on the document', formatDate(record.recordDate)],
                ['Added to MedGuardian', formatDateTime(record.createdAt)],
                ['Last opened', record.lastAccessedAt ? formatDateTime(record.lastAccessedAt) : 'Never'],
                ['Times opened', String(record.accessCount ?? 0)]
              ]
                .filter(([, value]) => value)
                .map(([label, value]) => (
                  <div key={label} className="mb-3">
                    <dt className="text-muted text-xs">{label}</dt>
                    <dd style={{ margin: 0 }}>{value}</dd>
                  </div>
                ))}
            </dl>

            {(record.tags || []).length > 0 && (
              <div className="row mt-3">
                {record.tags.map((tag) => (
                  <Badge key={tag} variant="neutral">
                    #{tag}
                  </Badge>
                ))}
              </div>
            )}

            {record.file && (
              <div className="mt-4" style={{ padding: 'var(--space-3)', background: 'var(--slate-50)', borderRadius: 'var(--radius)' }}>
                <div className="text-xs text-muted">Attached file</div>
                <strong>{record.file.originalName}</strong>
                <div className="text-xs text-muted">
                  {record.file.mimeType} · {Math.round((record.file.size || 0) / 1024)} KB
                </div>
                <div className="text-xs text-muted mono mt-2" style={{ wordBreak: 'break-all' }}>
                  SHA-256: {record.file.checksum}
                </div>
              </div>
            )}
          </Card>

          <Card title="Privacy and sharing">
            <div className="row row--between mb-3">
              <div>
                <strong>Shared with caregivers</strong>
                <div className="text-sm text-muted">
                  {record.shareableWithCaregivers
                    ? 'Caregivers holding the "view records" permission can open this.'
                    : 'Private to you. No caregiver can see it.'}
                </div>
              </div>
              <button type="button" className="btn btn--secondary btn--sm" onClick={toggleSharing}>
                {record.shareableWithCaregivers ? 'Make private' : 'Share'}
              </button>
            </div>
            {record.isSensitive && (
              <Alert variant="warning" title="Marked sensitive">
                This record is never shown to a caregiver, whatever permissions they hold.
              </Alert>
            )}
            <p className="text-xs text-muted mb-0">
              Every time this record is opened or its file is downloaded, an entry is written to
              your audit trail with who did it and when.
            </p>
          </Card>
        </div>

        <div className="stack">
          <Card
            title="Extracted text (OCR)"
            actions={
              record.hasFile && (
                <button type="button" className="btn btn--secondary btn--sm" onClick={runOcr} disabled={runningOcr}>
                  {runningOcr ? 'Reading…' : ocr.status === 'completed' ? 'Run again' : 'Run OCR'}
                </button>
              )
            }
          >
            {!record.hasFile ? (
              <p className="text-sm text-muted mb-0">No file is attached to this record.</p>
            ) : ocr.status === 'unsupported' ? (
              <Alert variant="info">{ocr.error}</Alert>
            ) : ocr.status === 'failed' ? (
              <Alert variant="warning" title="OCR could not read this file">
                {ocr.error}
              </Alert>
            ) : ocr.status !== 'completed' ? (
              <p className="text-sm text-muted mb-0">OCR has not been run on this record yet.</p>
            ) : (
              <>
                <div className="row row--between mb-3">
                  <span className="text-sm text-muted">
                    Engine: {ocr.engine} · confidence {ocr.confidence}%
                  </span>
                  {ocr.verificationStatus === 'awaiting_verification' && (
                    <Badge variant="warning">Needs your review</Badge>
                  )}
                  {ocr.verificationStatus === 'verified' && <Badge variant="success">Verified</Badge>}
                  {ocr.verificationStatus === 'rejected' && <Badge variant="neutral">Discarded</Badge>}
                </div>

                {ocr.suggestedMedicines?.length > 0 &&
                  ocr.verificationStatus === 'awaiting_verification' && (
                    <Alert variant="warning" title={`${ocr.suggestedMedicines.length} possible medicine(s) found`}>
                      <p className="mb-2">
                        These are suggestions from automatic text recognition, which is often wrong.
                        Nothing has been added to your medicine list.
                      </p>
                      <Link to={`/records/${id}/verify`} className="btn btn--primary btn--sm">
                        Review the suggestions
                      </Link>
                    </Alert>
                  )}

                <details>
                  <summary className="text-sm font-semibold" style={{ cursor: 'pointer' }}>
                    Show the raw extracted text
                  </summary>
                  <pre
                    className="mono text-xs mt-2"
                    style={{
                      whiteSpace: 'pre-wrap',
                      background: 'var(--slate-50)',
                      padding: 'var(--space-3)',
                      borderRadius: 'var(--radius)',
                      maxHeight: 300,
                      overflow: 'auto'
                    }}
                  >
                    {ocr.extractedText || '(no text was recognised)'}
                  </pre>
                </details>

                <Link to="/visit-summary" className="btn btn--secondary btn--sm mt-3">
                  📝 Summarise this document
                </Link>
              </>
            )}
          </Card>

          {(record.relatedMedicines || []).length > 0 && (
            <Card title="Linked medicines">
              <ul style={{ listStyle: 'none', paddingLeft: 0, marginBottom: 0 }}>
                {record.relatedMedicines.map((medicine) => (
                  <li key={medicine._id || medicine.id} style={{ padding: '6px 0' }}>
                    <Link to={`/medicines/${medicine._id || medicine.id}`}>
                      {medicine.name} {medicine.strength || ''}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      {confirmDelete && (
        <Modal
          title="Delete this record?"
          onClose={() => setConfirmDelete(false)}
          footer={
            <>
              <button type="button" className="btn btn--secondary" onClick={() => setConfirmDelete(false)}>
                Keep it
              </button>
              <button type="button" className="btn btn--danger" onClick={remove}>
                Delete permanently
              </button>
            </>
          }
        >
          <Alert variant="danger" title="This cannot be undone">
            "{record.title}" and its attached file will be permanently removed. You will be asked to
            confirm your PIN.
          </Alert>
        </Modal>
      )}

      {stepUp.gateProps && <PinGate {...stepUp.gateProps} />}
    </>
  );
}
