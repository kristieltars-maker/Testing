import { BrowserRouter, Routes, Route, Navigate, Link, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx';
import LoginPage from './pages/LoginPage.jsx';
import ProjectsPage from './pages/ProjectsPage.jsx';
import IssuesPage from './pages/IssuesPage.jsx';
import IssueDetailPage from './pages/IssueDetailPage.jsx';
import UsersPage from './pages/UsersPage.jsx';
import ProjectManagePage from './pages/ProjectManagePage.jsx';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Загрузка...</div>;
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
        borderBottom: '1px solid #eee',
        background: '#fff'
      }}>
        <Link to="/" style={{ textDecoration: 'none', color: '#333', fontWeight: 'bold', fontSize: 18 }}>
          Тестирование ботов
        </Link>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          {user.role === 'admin' && (
            <Link to="/admin/users" style={{ textDecoration: 'none', color: '#3498db' }}>Пользователи</Link>
          )}
          <span style={{ color: '#666', fontSize: 14 }}>{user.name} ({user.role})</span>
          <button onClick={handleLogout} style={{ padding: '4px 12px', cursor: 'pointer' }}>Выход</button>
        </div>
      </nav>
      {children}
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<ProtectedRoute><Layout><ProjectsPage /></Layout></ProtectedRoute>} />
          <Route path="/projects/:projectId" element={<ProtectedRoute><Layout><IssuesPage /></Layout></ProtectedRoute>} />
          <Route path="/projects/:projectId/manage" element={<ProtectedRoute><Layout><ProjectManagePage /></Layout></ProtectedRoute>} />
          <Route path="/issues/:issueId" element={<ProtectedRoute><Layout><IssueDetailPage /></Layout></ProtectedRoute>} />
          <Route path="/admin/users" element={<ProtectedRoute><Layout><UsersPage /></Layout></ProtectedRoute>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
