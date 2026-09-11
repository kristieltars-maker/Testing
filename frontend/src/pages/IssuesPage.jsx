import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../contexts/AuthContext.jsx';

const STATUS_LABELS = {
  new: 'Новое',
  waiting: 'В ожидании',
  done: 'Выполнено',
  cancelled: 'Отменено',
  rejected: 'Не принято',
  reopened: 'Вернули в работу'
};

const STATUS_COLORS = {
  new: '#3498db',
  waiting: '#f39c12',
  done: '#27ae60',
  cancelled: '#95a5a6',
  rejected: '#e74c3c',
  reopened: '#9b59b6'
};

export default function IssuesPage() {
  const { projectId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [issues, setIssues] = useState([]);
  const [bots, setBots] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [filters, setFilters] = useState({ status: '', bot_id: '', created_by: '', assigned_to: '' });
  const [newIssue, setNewIssue] = useState({ bot_id: '', text: '', files: [] });

  const load = () => {
    Promise.all([
      api.getProject(projectId),
      api.getIssues({ project_id: projectId, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) })
    ]).then(([proj, iss]) => {
      setProject(proj.project);
      setBots(proj.bots);
      setMembers(proj.members);
      setIssues(iss.issues);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [projectId, filters]);

  const handleCreate = async (e) => {
    e.preventDefault();
    const formData = new FormData();
    formData.append('project_id', projectId);
    if (newIssue.bot_id) formData.append('bot_id', newIssue.bot_id);
    formData.append('text', newIssue.text);
    for (const file of newIssue.files) {
      formData.append('attachments', file);
    }
    await api.createIssue(formData, projectId);
    setNewIssue({ bot_id: '', text: '', files: [] });
    setShowCreate(false);
    load();
  };

  if (loading) return <div>Загрузка...</div>;
  if (!project) return <div>Проект не найден</div>;

  const canCreate = user.role === 'admin' || (user.role === 'tester' && members.some(m => m.id === user.id && m.role_in_project === 'tester'));

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: 20 }}>
      <Link to="/" style={{ color: '#3498db' }}>← Проекты</Link>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h1 style={{ margin: '8px 0' }}>{project.name}</h1>
        {user.role === 'admin' && (
          <Link to={`/projects/${project.id}/manage`} style={{ color: '#3498db', fontSize: 14 }}>⚙ Управление проектом</Link>
        )}
      </div>
      <div style={{ color: '#666', marginBottom: 16 }}>Заказчик: {project.client_name}</div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })} style={{ padding: 6 }}>
          <option value="">Все статусы</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {bots.length > 0 && (
          <select value={filters.bot_id} onChange={e => setFilters({ ...filters, bot_id: e.target.value })} style={{ padding: 6 }}>
            <option value="">Все боты</option>
            {bots.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        <select value={filters.created_by} onChange={e => setFilters({ ...filters, created_by: e.target.value })} style={{ padding: 6 }}>
          <option value="">Все тестировщики</option>
          {members.filter(m => m.role_in_project === 'tester').map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <select value={filters.assigned_to} onChange={e => setFilters({ ...filters, assigned_to: e.target.value })} style={{ padding: 6 }}>
          <option value="">Все скриптологи</option>
          {members.filter(m => m.role_in_project === 'developer').map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        {canCreate && (
          <button onClick={() => setShowCreate(!showCreate)} style={{ padding: '6px 16px', marginLeft: 'auto' }}>
            + Новое замечание
          </button>
        )}
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} style={{ marginBottom: 20, padding: 15, border: '1px solid #ccc' }}>
          {bots.length > 0 && (
            <select value={newIssue.bot_id} onChange={e => setNewIssue({ ...newIssue, bot_id: e.target.value })} style={{ padding: 6, marginBottom: 8, width: '100%' }}>
              <option value="">Без привязки к боту</option>
              {bots.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <textarea
            placeholder="Описание замечания..."
            value={newIssue.text}
            onChange={e => setNewIssue({ ...newIssue, text: e.target.value })}
            required
            rows={4}
            style={{ width: '100%', padding: 8, marginBottom: 8 }}
          />
          <input
            type="file"
            multiple
            accept="image/*"
            onChange={e => setNewIssue({ ...newIssue, files: Array.from(e.target.files) })}
            style={{ marginBottom: 8 }}
          />
          <button type="submit" style={{ padding: '6px 16px' }}>Создать замечание</button>
        </form>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #ddd', textAlign: 'left' }}>
            <th style={{ padding: 8 }}>#</th>
            <th style={{ padding: 8 }}>Описание</th>
            <th style={{ padding: 8 }}>Статус</th>
            <th style={{ padding: 8 }}>Автор</th>
            <th style={{ padding: 8 }}>Ответственный</th>
            <th style={{ padding: 8 }}>Обновлено</th>
          </tr>
        </thead>
        <tbody>
          {issues.map(issue => (
            <tr key={issue.id} style={{ borderBottom: '1px solid #eee', cursor: 'pointer' }} onClick={() => navigate(`/issues/${issue.id}`)}>
              <td style={{ padding: 8 }}>#{issue.local_number}</td>
              <td style={{ padding: 8, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {issue.first_message?.slice(0, 80) || '—'}
              </td>
              <td style={{ padding: 8 }}>
                <span style={{ background: STATUS_COLORS[issue.status], color: '#fff', padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>
                  {STATUS_LABELS[issue.status]}
                </span>
              </td>
              <td style={{ padding: 8 }}>{issue.creator_name}</td>
              <td style={{ padding: 8 }}>{issue.assignee_name || '—'}</td>
              <td style={{ padding: 8, fontSize: 13, color: '#666' }}>{new Date(issue.updated_at).toLocaleString('ru-RU')}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {issues.length === 0 && <div style={{ textAlign: 'center', color: '#999', padding: 40 }}>Нет замечаний</div>}
    </div>
  );
}
