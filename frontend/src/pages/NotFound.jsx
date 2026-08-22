import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function NotFound() {
  const { isAuthenticated } = useAuth();

  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 24 }}>
      <div className="text-center" style={{ maxWidth: 460 }}>
        <div style={{ fontSize: '4rem', marginBottom: 'var(--space-3)' }} aria-hidden="true">
          🧭
        </div>
        <h1>We couldn't find that page</h1>
        <p className="text-muted">
          The link may be out of date, or the page may have been moved. Nothing is wrong with your
          data.
        </p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <Link to={isAuthenticated ? '/dashboard' : '/'} className="btn btn--primary">
            {isAuthenticated ? 'Back to dashboard' : 'Back to home'}
          </Link>
          {isAuthenticated && (
            <Link to="/medicines" className="btn btn--secondary">
              My medicines
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
