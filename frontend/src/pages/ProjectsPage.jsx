import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { plural } from '../utils/plural.js';

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

  if (loading) return <div className="empty">Загрузка...</div>;

  return (
    <div className="page">
      <div className="page-header">
        <div className="title">Проекты</div>
        {(user.role === 'admin' || user.role === 'manager') && (
          <button onClick={() => setShowForm(!showForm)}>+ Новый проект</button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="card" style={{ padding: 16, marginBottom: 20 }}>
          <div className="form-group">
            <label>Название проекта *</label>
            <input className="form-control" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="form-group">
            <label>Заказчик *</label>
            <input className="form-control" value={form.client_name} onChange={e => setForm({ ...form, client_name: e.target.value })} required />
          </div>
          <div className="form-group">
            <label>Платформа</label>
            <input className="form-control" value={form.platform} onChange={e => setForm({ ...form, platform: e.target.value })} />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="submit">Создать</button>
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Отмена</button>
          </div>
        </form>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
        {projects.map(p => (
          <div
            key={p.id}
            className="card"
            style={{ padding: 18, display: 'flex', flexDirection: 'column', transition: 'box-shadow 0.15s ease' }}
          >
            <Link to={`/projects/${p.slug}`} style={{ textDecoration: 'none', color: 'inherit', flex: 1 }}>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{p.name}</div>
              <div className="muted">Заказчик: {p.client_name}</div>
              <div className="muted">Платформа: {p.platform}</div>
              <div style={{
                marginTop: 12,
                fontWeight: 600,
                color: p.open_issues_count > 0 ? '#e74c3c' : '#27ae60'
              }}>
                {p.open_issues_count} {plural(p.open_issues_count, ['открытое замечание', 'открытых замечания', 'открытых замечаний'])}
              </div>
            </Link>
            {(user.role === 'admin' || (user.role === 'manager' && p.manager_id === user.id)) && (
              <Link
                to={`/projects/${p.slug}/manage`}
                style={{ marginTop: 12, fontSize: 13, textDecoration: 'none' }}
              >
                ⚙ Управление проектом
              </Link>
            )}
          </div>
        ))}
      </div>

      {projects.length === 0 && <div className="empty">Нет доступных проектов</div>}
    </div>
  );
}
