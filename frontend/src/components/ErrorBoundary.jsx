import { Component } from 'react';

/**
 * Catches render-time errors so a single broken screen never leaves the user
 * looking at a blank page.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('MedGuardian UI error:', error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 24 }}>
        <div className="card" style={{ maxWidth: 560, width: '100%' }}>
          <div className="card__body">
            <h2>Something went wrong on this screen</h2>
            <p className="text-muted">
              Your data is safe. Reloading usually fixes this. If it keeps happening, sign out and
              back in.
            </p>
            <details className="mb-4">
              <summary className="text-sm text-muted" style={{ cursor: 'pointer' }}>
                Technical details
              </summary>
              <pre className="mono text-xs" style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>
                {error.message}
              </pre>
            </details>
            <div className="row">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => window.location.reload()}
              >
                Reload the page
              </button>
              <a className="btn btn--secondary" href="/dashboard">
                Back to dashboard
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
