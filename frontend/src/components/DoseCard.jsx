import { medicineApi } from '../services/endpoints';
import {
  formatClock,
  STATUS_LABEL,
  STATUS_VARIANT,
  pluralUnit,
  formatTime
} from '../utils/format';
import { Badge } from './ui';

const MEAL_LABEL = {
  before_meal: 'Before food',
  with_meal: 'With food',
  after_meal: 'After food',
  empty_stomach: 'On an empty stomach',
  any: null
};

/**
 * The visual reminder card.
 *
 * Showing the patient's own photograph of the medicine is the point of this
 * component: it lets someone confirm they are holding the right tablet without
 * having to read a name they may not recognise. (Project scope explicitly
 * excludes voice reminders — this is the visual alternative.)
 */
export default function DoseCard({ occurrence, onRecord, busy, compact = false }) {
  const { medicine, status, time, doseQuantity, mealRelation, takenAt, notes, isAsNeeded } =
    occurrence;

  const actionable = ['due', 'late', 'upcoming', 'missed'].includes(status);
  const imageUrl = medicine?.image?.filename ? medicineApi.imageUrl(medicine.id, 'thumbnail') : null;

  return (
    <article className={`dose-card dose-card--${status}`}>
      {imageUrl ? (
        <img
          className="medicine-thumb"
          src={imageUrl}
          alt={`Photo of ${medicine?.name || 'this medicine'}`}
          loading="lazy"
        />
      ) : (
        <div className="medicine-thumb medicine-thumb--placeholder" aria-hidden="true">
          💊
        </div>
      )}

      <div className="dose-card__body">
        <div className="dose-card__time">
          {isAsNeeded ? formatTime(takenAt) : formatClock(time)}
          {isAsNeeded && <span className="text-xs text-muted"> · as needed</span>}
        </div>
        <div className="dose-card__name">
          {medicine?.name || 'Medicine'}{' '}
          {medicine?.strength && <span className="text-muted">{medicine.strength}</span>}
        </div>
        <div className="dose-card__meta">
          {pluralUnit(doseQuantity, medicine?.unit || 'dose')}
          {MEAL_LABEL[mealRelation] ? ` · ${MEAL_LABEL[mealRelation]}` : ''}
          {medicine?.instructions && !compact ? ` · ${medicine.instructions}` : ''}
        </div>
        {status === 'taken' && takenAt && (
          <div className="text-xs text-success mt-2">Recorded at {formatTime(takenAt)}</div>
        )}
        {notes && <div className="text-xs text-muted mt-2">Note: {notes}</div>}
      </div>

      <div className="dose-card__actions">
        {actionable && onRecord ? (
          <>
            <button
              type="button"
              className="btn btn--success btn--sm"
              disabled={busy}
              onClick={() => onRecord(occurrence, 'taken')}
            >
              ✓ Taken
            </button>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={busy}
              onClick={() => onRecord(occurrence, 'skipped')}
            >
              Skip
            </button>
          </>
        ) : (
          <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status] || status}</Badge>
        )}
        {actionable && onRecord && (
          <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>
        )}
      </div>
    </article>
  );
}
