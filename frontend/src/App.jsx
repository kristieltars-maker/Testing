import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx';
import { ROLE_LABELS } from './constants/roles.js';
import LoginPage from './pages/LoginPage.jsx';
import ProjectsPage from './pages/ProjectsPage.jsx';
import IssuesPage from './pages/IssuesPage.jsx';
import IssueDetailPage from './pages/IssueDetailPage.jsx';
import IssueCreatePage from './pages/IssueCreatePage.jsx';
import UsersPage from './pages/UsersPage.jsx';
import ProjectManagePage from './pages/ProjectManagePage.jsx';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="empty">Загрузка...</div>;
  if (!user) return <Navigate to="/login" />;
  return children;
}

function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div>
      <nav style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '12px 20px',
        borderBottom: '1px solid #e5e7eb',
        background: '#fff',
        position: 'sticky',
        top: 0,
        zIndex: 100
      }}>
        <Link to="/" style={{ textDecoration: 'none', color: '#111827', fontWeight: 'bold', fontSize: 18 }}>
          Тестирование ботов
          <span style={{ fontSize: 11, color: '#aaa', fontWeight: 'normal', marginLeft: 8 }}>
            {typeof __BUILD_DATE__ !== 'undefined' ? new Date(__BUILD_DATE__).toLocaleString('ru-RU') : 'dev'}
          </span>
        </Link>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          {user.role === 'admin' && (
            <Link to="/admin/users" style={{ textDecoration: 'none' }}>Пользователи</Link>
          )}
          <span className="muted">
            {user.name} · {ROLE_LABELS[user.role] || user.role}
          </span>
          <button className="btn-secondary btn-sm" onClick={handleLogout}>Выход</button>
        </div>
      </nav>
      {children}
    </div>
  );
}

function useAutoUpdate() {
  useEffect(() => {
    if (!import.meta.env.PROD) return;

    const current = document
      .querySelector('script[type="module"][src*="/assets/index-"]')
      ?.getAttribute('src');

    const check = async () => {
      try {
        const res = await fetch('/index.html', { cache: 'no-store' });
        const html = await res.text();
        const match = html.match(/src="(\/assets\/index-[^"]+\.js)"/);
        if (match && current && match[1] !== current) {
          window.location.reload();
        }
      } catch (e) {
        // сеть недоступна — пропускаем
      }
    };

    check();
    const onFocus = () => check();
    window.addEventListener('focus', onFocus);
    const interval = setInterval(check, 60000);

    return () => {
      window.removeEventListener('focus', onFocus);
      clearInterval(interval);
    };
  }, []);
}

function App() {
  useAutoUpdate();

  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<ProtectedRoute><Layout><ProjectsPage /></Layout></ProtectedRoute>} />
          <Route path="/projects/:projectId" element={<ProtectedRoute><Layout><IssuesPage /></Layout></ProtectedRoute>} />
          <Route path="/projects/:projectId/manage" element={<ProtectedRoute><Layout><ProjectManagePage /></Layout></ProtectedRoute>} />
          <Route path="/projects/:projectSlug/issues/new" element={<ProtectedRoute><Layout><IssueCreatePage /></Layout></ProtectedRoute>} />
          <Route path="/projects/:projectSlug/issues/:issueId" element={<ProtectedRoute><Layout><IssueDetailPage /></Layout></ProtectedRoute>} />
          <Route path="/issues/:issueId" element={<ProtectedRoute><Layout><IssueDetailPage /></Layout></ProtectedRoute>} />
          <Route path="/admin/users" element={<ProtectedRoute><Layout><UsersPage /></Layout></ProtectedRoute>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
