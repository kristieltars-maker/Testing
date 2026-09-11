import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function ProjectsPage() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', client_name: '', platform: 'ТВИН' });
  const { user } = useAuth();

  const load = () => {
    api.getProjects()
      .then(data => setProjects(data.projects))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    await api.createProject(form);
    setForm({ name: '', client_name: '', platform: 'ТВИН' });
    setShowForm(false);
    load();
  };

  if (loading) return <div>Загрузка...</div>;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Проекты</h1>
        {user.role === 'admin' && (
          <button onClick={() => setShowForm(!showForm)} style={{ padding: '8px 16px' }}>
            + Новый проект
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleCreate} style={{ marginBottom: 20, padding: 15, border: '1px solid #ccc' }}>
          <div style={{ marginBottom: 8 }}>
            <input
              placeholder="Название проекта"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              required
              style={{ padding: 6, width: '100%' }}
            />
          </div>
          <div style={{ marginBottom: 8 }}>
            <input
              placeholder="Заказчик"
              value={form.client_name}
              onChange={e => setForm({ ...form, client_name: e.target.value })}
              required
              style={{ padding: 6, width: '100%' }}
            />
          </div>
          <div style={{ marginBottom: 8 }}>
            <input
              placeholder="Платформа"
              value={form.platform}
              onChange={e => setForm({ ...form, platform: e.target.value })}
              style={{ padding: 6, width: '100%' }}
            />
          </div>
          <button type="submit" style={{ padding: '6px 16px' }}>Создать</button>
        </form>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
        {projects.map(p => (
          <div key={p.id} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, display: 'flex', flexDirection: 'column' }}>
            <Link to={`/projects/${p.id}`} style={{ textDecoration: 'none', color: 'inherit', flex: 1 }}>
              <h3 style={{ margin: '0 0 8px' }}>{p.name}</h3>
              <div style={{ color: '#666', fontSize: 14 }}>Заказчик: {p.client_name}</div>
              <div style={{ color: '#666', fontSize: 14 }}>Платформа: {p.platform}</div>
              <div style={{ marginTop: 8, fontWeight: 'bold', color: p.open_issues_count > 0 ? '#e74c3c' : '#27ae60' }}>
                {p.open_issues_count} открытых замечаний
              </div>
            </Link>
            {user.role === 'admin' && (
              <Link to={`/projects/${p.id}/manage`} style={{ marginTop: 12, fontSize: 13, color: '#3498db' }}>
                ⚙ Управление (боты, участники)
              </Link>
            )}
          </div>
        ))}
      </div>

      {projects.length === 0 && <div style={{ textAlign: 'center', color: '#999' }}>Нет доступных проектов</div>}
    </div>
  );
}
