import { useEffect } from 'react';

/* ------------------------------------------------------------------ Card */
export function Card({ title, actions, children, footer, className = '', bodyClassName = '' }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card__header">
          {title ? <h3 className="card__title">{title}</h3> : <span />}
          {actions}
        </header>
      )}
      <div className={`card__body ${bodyClassName}`}>{children}</div>
      {footer && <footer className="card__footer">{footer}</footer>}
    </section>
  );
}

/* ----------------------------------------------------------------- Badge */
export function Badge({ variant = 'neutral', children }) {
  return <span className={`badge badge--${variant}`}>{children}</span>;
}

/* ----------------------------------------------------------------- Alert */
const ALERT_ICON = {
  info: 'ℹ️',
  success: '✅',
  warning: '⚠️',
  danger: '⛔',
  neutral: '📋'
};

export function Alert({ variant = 'info', title, children, icon }) {
  return (
    <div className={`alert alert--${variant}`} role={variant === 'danger' ? 'alert' : 'status'}>
      <span className="alert__icon" aria-hidden="true">
        {icon ?? ALERT_ICON[variant]}
      </span>
      <div className="alert__body">
        {title && <div className="alert__title">{title}</div>}
        {children}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- Spinner */
export function Spinner({ large = false, label }) {
  return (
    <div className="loading-block">
      <div
        className={`spinner ${large ? 'spinner--lg' : ''}`}
        role="status"
        aria-label={label || 'Loading'}
      />
      {label && <span className="text-sm">{label}</span>}
    </div>
  );
}

/* ----------------------------------------------------------- EmptyState */
export function EmptyState({ icon = '📭', title, children, action }) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon" aria-hidden="true">
        {icon}
      </div>
      {title && <div className="empty-state__title">{title}</div>}
      {children && <p className="text-sm">{children}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/* ----------------------------------------------------------------- Field */
export function Field({ label, htmlFor, hint, error, required, children }) {
  return (
    <div className="field">
      {label && (
        <label className="field__label" htmlFor={htmlFor}>
          {label}
          {required && (
            <span className="field__required" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      {children}
      {hint && !error && <div className="field__hint">{hint}</div>}
      {error && (
        <div className="field__error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- Modal */
export function Modal({ title, onClose, children, footer, wide = false }) {
  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}
    >
      <div
        className={`modal ${wide ? 'modal--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="modal__header">
          <h3 className="card__title">{title}</h3>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__footer">{footer}</footer>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Stat */
export function Stat({ label, value, meta, variant }) {
  return (
    <div className="card stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value" style={variant ? { color: `var(--${variant})` } : undefined}>
        {value}
      </div>
      {meta && <div className="stat__meta">{meta}</div>}
    </div>
  );
}

/* ----------------------------------------------------------------- Meter */
export function Meter({ value, max = 100, variant }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div
      className="meter"
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={`meter__fill ${variant ? `meter__fill--${variant}` : ''}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/* ------------------------------------------------------------ ErrorState */
export function ErrorState({ error, onRetry }) {
  return (
    <Alert variant="danger" title="Something went wrong">
      <p>{error?.message || 'An unexpected error occurred.'}</p>
      {error?.details?.length > 0 && (
        <ul className="mb-0">
          {error.details.map((d, i) => (
            <li key={i}>
              {d.field?.replace(/^body\./, '')}: {d.message}
            </li>
          ))}
        </ul>
      )}
      {onRetry && (
        <button type="button" className="btn btn--secondary btn--sm mt-2" onClick={onRetry}>
          Try again
        </button>
      )}
    </Alert>
  );
}
