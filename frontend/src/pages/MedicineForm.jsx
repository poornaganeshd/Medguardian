import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { medicineApi } from '../services/endpoints';
import { useToast } from '../context/ToastContext';
import { Card, Field, Alert, Spinner, ErrorState } from '../components/ui';

const DOSAGE_FORMS = [
  'tablet', 'capsule', 'syrup', 'suspension', 'injection', 'drops',
  'inhaler', 'cream', 'ointment', 'gel', 'patch', 'suppository',
  'powder', 'spray', 'other'
];
const UNITS = ['tablet', 'capsule', 'ml', 'mg', 'drop', 'puff', 'unit', 'sachet', 'application'];

const EMPTY = {
  name: '',
  genericName: '',
  manufacturer: '',
  strength: '',
  dosageForm: 'tablet',
  unit: 'tablet',
  color: '',
  shape: '',
  purpose: '',
  instructions: '',
  prescriberNotes: '',
  prescribedBy: '',
  storageInstructions: '',
  initialQuantity: '',
  currentStock: '',
  refillThreshold: '5',
  expiryDate: ''
};

export default function MedicineForm() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const toast = useToast();
  const fileInput = useRef(null);

  const [form, setForm] = useState(EMPTY);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [existingImage, setExistingImage] = useState(null);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isEdit) return;
    let cancelled = false;
    medicineApi
      .get(id)
      .then(({ medicine }) => {
        if (cancelled) return;
        setForm({
          ...EMPTY,
          ...Object.fromEntries(
            Object.keys(EMPTY).map((key) => [key, medicine[key] ?? EMPTY[key]])
          ),
          expiryDate: medicine.expiryDate ? medicine.expiryDate.slice(0, 10) : ''
        });
        setExistingImage(medicine.image || null);
      })
      .catch((err) => !cancelled && setError(err))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [id, isEdit]);

  const update = (fieldName) => (event) =>
    setForm((current) => ({ ...current, [fieldName]: event.target.value }));

  const pickImage = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error('That image is larger than 10 MB. Please choose a smaller photo.');
      return;
    }
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    setSaving(true);

    // Blank optional fields are omitted rather than sent as empty strings.
    const payload = {};
    for (const [key, value] of Object.entries(form)) {
      if (value === '' || value === null) continue;
      payload[key] = ['initialQuantity', 'currentStock', 'refillThreshold'].includes(key)
        ? Number(value)
        : value;
    }

    try {
      const result = isEdit
        ? await medicineApi.update(id, payload)
        : await medicineApi.create(payload);
      const medicineId = result.medicine.id;

      if (imageFile) {
        try {
          await medicineApi.uploadImage(medicineId, imageFile);
        } catch (uploadError) {
          toast.warning(`Medicine saved, but the photo failed to upload: ${uploadError.message}`);
        }
      }

      toast.success(isEdit ? 'Medicine updated.' : 'Medicine added.');
      navigate(`/medicines/${medicineId}`);
    } catch (err) {
      setError(err);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spinner large label="Loading medicine…" />;
  if (error && isEdit && !form.name) return <ErrorState error={error} />;

  const previewSrc =
    imagePreview ||
    (existingImage?.filename ? medicineApi.imageUrl(id, 'thumbnail') : null);

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="mb-0">{isEdit ? 'Edit medicine' : 'Add a medicine'}</h1>
          <p className="page__subtitle">
            Only the name is required — everything else can be filled in later.
          </p>
        </div>
        <Link to={isEdit ? `/medicines/${id}` : '/medicines'} className="btn btn--secondary">
          Cancel
        </Link>
      </div>

      {error && <ErrorState error={error} />}

      <form onSubmit={submit}>
        <div className="stack">
          <Card title="What is this medicine?">
            <div className="form-grid">
              <Field label="Medicine name" htmlFor="name" required hint="The name on the pack.">
                <input
                  id="name"
                  className="input"
                  required
                  autoFocus
                  value={form.name}
                  onChange={update('name')}
                  placeholder="e.g. Metformin, or Glycomet"
                />
              </Field>
              <Field
                label="Generic / active substance"
                htmlFor="genericName"
                hint="Used for interaction checks — worth filling in for a brand name."
              >
                <input
                  id="genericName"
                  className="input"
                  value={form.genericName}
                  onChange={update('genericName')}
                  placeholder="e.g. Metformin Hydrochloride"
                />
              </Field>
              <Field label="Strength" htmlFor="strength">
                <input
                  id="strength"
                  className="input"
                  value={form.strength}
                  onChange={update('strength')}
                  placeholder="e.g. 500 mg"
                />
              </Field>
              <Field label="Manufacturer" htmlFor="manufacturer">
                <input
                  id="manufacturer"
                  className="input"
                  value={form.manufacturer}
                  onChange={update('manufacturer')}
                />
              </Field>
              <Field label="Form" htmlFor="dosageForm">
                <select id="dosageForm" className="select" value={form.dosageForm} onChange={update('dosageForm')}>
                  {DOSAGE_FORMS.map((f) => (
                    <option key={f} value={f}>
                      {f.charAt(0).toUpperCase() + f.slice(1)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Counted in" htmlFor="unit" hint="How you count a dose.">
                <select id="unit" className="select" value={form.unit} onChange={update('unit')}>
                  {UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Colour" htmlFor="color" hint="Helps you identify it.">
                <input id="color" className="input" value={form.color} onChange={update('color')} placeholder="e.g. white" />
              </Field>
              <Field label="Shape" htmlFor="shape">
                <input id="shape" className="input" value={form.shape} onChange={update('shape')} placeholder="e.g. oval" />
              </Field>
            </div>
          </Card>

          <Card title="Photo of the medicine">
            <p className="text-sm text-muted">
              Your reminder cards show this photo, so you can check you are holding the right tablet
              at a glance. Location data is removed from the image before it is stored.
            </p>
            <div className="row">
              {previewSrc ? (
                <img className="medicine-thumb medicine-thumb--lg" src={previewSrc} alt="Medicine preview" />
              ) : (
                <div className="medicine-thumb medicine-thumb--lg medicine-thumb--placeholder" aria-hidden="true">
                  💊
                </div>
              )}
              <div>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={pickImage}
                  style={{ display: 'none' }}
                  id="medicine-image"
                />
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => fileInput.current?.click()}
                >
                  {previewSrc ? 'Choose a different photo' : 'Choose a photo'}
                </button>
                {imageFile && (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => {
                      setImageFile(null);
                      setImagePreview(null);
                      if (fileInput.current) fileInput.current.value = '';
                    }}
                  >
                    Remove
                  </button>
                )}
                <div className="field__hint">JPEG, PNG or WebP, up to 10 MB.</div>
              </div>
            </div>
          </Card>

          <Card title="How to take it">
            <Field
              label="Instructions"
              htmlFor="instructions"
              hint="Shown on every reminder card."
            >
              <textarea
                id="instructions"
                className="textarea"
                value={form.instructions}
                onChange={update('instructions')}
                placeholder="e.g. Take one tablet after breakfast with a glass of water"
                maxLength={1000}
              />
            </Field>
            <div className="form-grid">
              <Field label="What it is for" htmlFor="purpose">
                <input
                  id="purpose"
                  className="input"
                  value={form.purpose}
                  onChange={update('purpose')}
                  placeholder="e.g. Blood sugar control"
                />
              </Field>
              <Field label="Prescribed by" htmlFor="prescribedBy">
                <input
                  id="prescribedBy"
                  className="input"
                  value={form.prescribedBy}
                  onChange={update('prescribedBy')}
                  placeholder="e.g. Dr. A. Kumar"
                />
              </Field>
            </div>
            <Field label="Prescriber notes" htmlFor="prescriberNotes">
              <textarea
                id="prescriberNotes"
                className="textarea"
                value={form.prescriberNotes}
                onChange={update('prescriberNotes')}
                placeholder="Anything your doctor told you about this medicine"
                maxLength={1000}
              />
            </Field>
            <Field label="Storage instructions" htmlFor="storageInstructions">
              <input
                id="storageInstructions"
                className="input"
                value={form.storageInstructions}
                onChange={update('storageInstructions')}
                placeholder="e.g. Keep refrigerated"
              />
            </Field>
          </Card>

          <Card title="Stock and refills">
            <Alert variant="info">
              MedGuardian deducts stock automatically when you record a dose as taken. A{' '}
              <strong>skipped</strong> dose is never deducted — the tablet stays in the box, and the
              refill prediction accounts for that.
            </Alert>
            <div className="form-grid">
              <Field
                label="Quantity in the pack"
                htmlFor="initialQuantity"
                hint="How many came in the pack."
              >
                <input
                  id="initialQuantity"
                  className="input"
                  type="number"
                  min="0"
                  step="0.5"
                  value={form.initialQuantity}
                  onChange={update('initialQuantity')}
                  placeholder="e.g. 30"
                />
              </Field>
              <Field
                label="How many you have now"
                htmlFor="currentStock"
                hint="Leave blank to use the pack quantity."
              >
                <input
                  id="currentStock"
                  className="input"
                  type="number"
                  min="0"
                  step="0.5"
                  value={form.currentStock}
                  onChange={update('currentStock')}
                />
              </Field>
              <Field
                label="Warn me when stock reaches"
                htmlFor="refillThreshold"
                hint="Your refill threshold."
              >
                <input
                  id="refillThreshold"
                  className="input"
                  type="number"
                  min="0"
                  step="0.5"
                  value={form.refillThreshold}
                  onChange={update('refillThreshold')}
                />
              </Field>
              <Field label="Expiry date" htmlFor="expiryDate">
                <input
                  id="expiryDate"
                  className="input"
                  type="date"
                  value={form.expiryDate}
                  onChange={update('expiryDate')}
                />
              </Field>
            </div>
          </Card>

          <div className="row row--end">
            <Link to={isEdit ? `/medicines/${id}` : '/medicines'} className="btn btn--secondary">
              Cancel
            </Link>
            <button type="submit" className="btn btn--primary btn--lg" disabled={saving || !form.name}>
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add medicine'}
            </button>
          </div>
        </div>
      </form>
    </>
  );
}
