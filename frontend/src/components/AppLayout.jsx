import { useState, useEffect } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { initials } from '../utils/format';

const NAV_SECTIONS = [
  {
    label: 'Overview',
    items: [
      { to: '/dashboard', icon: '🏠', label: 'Dashboard' },
      { to: '/reminders', icon: '🔔', label: "Today's reminders" }
    ]
  },
  {
    label: 'Medication',
    items: [
      { to: '/medicines', icon: '💊', label: 'My medicines' },
      { to: '/schedules', icon: '📅', label: 'Schedules' },
      { to: '/history', icon: '🕓', label: 'Medication history' },
      { to: '/adherence', icon: '📈', label: 'Adherence & refills' },
      { to: '/interactions', icon: '⚠️', label: 'Drug interactions' }
    ]
  },
  {
    label: 'Records & help',
    items: [
      { to: '/records', icon: '📄', label: 'Medical records' },
      { to: '/medicine-info', icon: '📚', label: 'Medicine information' },
      { to: '/visit-summary', icon: '📝', label: 'Visit summary' },
      { to: '/insights', icon: '💡', label: 'Health insights' }
    ]
  },
  {
    label: 'Account',
    items: [
      { to: '/caregivers', icon: '👥', label: 'Caregivers' },
      { to: '/profile', icon: '⚙️', label: 'Profile & security' }
    ]
  }
];

const TITLES = {
  '/dashboard': 'Dashboard',
  '/reminders': "Today's reminders",
  '/medicines': 'My medicines',
  '/medicines/new': 'Add a medicine',
  '/schedules': 'Medication schedules',
  '/history': 'Medication history',
  '/adherence': 'Adherence & refill prediction',
  '/interactions': 'Drug interaction check',
  '/records': 'Medical records',
  '/medicine-info': 'Medicine information',
  '/visit-summary': 'Visit summary',
  '/insights': 'Health insights',
  '/caregivers': 'Caregivers',
  '/profile': 'Profile & security'
};

export default function AppLayout() {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  // Close the mobile drawer whenever the route changes.
  useEffect(() => setMenuOpen(false), [location.pathname]);

  const title =
    TITLES[location.pathname] ||
    (location.pathname.startsWith('/medicines/') ? 'Medicine details' : 'MedGuardian');

  useEffect(() => {
    document.title = `${title} · MedGuardian`;
  }, [title]);

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="app-shell">
      {menuOpen && (
        <div
          className="sidebar__backdrop"
          onClick={() => setMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside className={`sidebar ${menuOpen ? 'sidebar--open' : ''}`}>
        <NavLink to="/dashboard" className="sidebar__brand">
          <span className="sidebar__logo" aria-hidden="true">
            🛡️
          </span>
          MedGuardian
        </NavLink>

        <nav className="sidebar__nav" aria-label="Main navigation">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label}>
              <div className="sidebar__section">{section.label}</div>
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `sidebar__link ${isActive ? 'sidebar__link--active' : ''}`
                  }
                >
                  <span className="sidebar__icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar__footer">
          MedGuardian · Academic project build
          <br />
          Not a medical device.
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button
            type="button"
            className="menu-toggle"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="Toggle navigation"
            aria-expanded={menuOpen}
          >
            ☰
          </button>
          <span className="topbar__title">{title}</span>
          <div className="topbar__spacer" />
          <div className="topbar__user">
            <div className="avatar" aria-hidden="true">
              {initials(user?.name)}
            </div>
            <div className="text-sm" style={{ lineHeight: 1.3 }}>
              <div className="font-semibold">{user?.name}</div>
              <div className="text-muted text-xs" style={{ textTransform: 'capitalize' }}>
                {user?.role}
              </div>
            </div>
            <button type="button" className="btn btn--ghost btn--sm" onClick={handleLogout}>
              Sign out
            </button>
          </div>
        </header>

        <main className="page">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
