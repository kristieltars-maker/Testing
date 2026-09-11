import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { STATUS_LABELS, STATUS_COLORS, STATUS_DESCRIPTIONS, STATUS_ORDER } from '../constants/statuses.js';
import { formatDateTime } from '../utils/datetime.js';
import TrashIcon from '../components/TrashIcon.jsx';

export default function IssuesPage() {
  const { projectId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [issues, setIssues] = useState([]);
  const [bots, setBots] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ status: '', bot_id: '', created_by: '', assigned_to: '' });

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

  const developers = members.filter(m => m.role_in_project === 'developer');
  const testers = members.filter(m => m.role_in_project === 'tester');
  const hasFilters = Object.values(filters).some(Boolean);

  const openCreate = () => {
    navigate(`/projects/${project.slug}/issues/new`);
  };

  const handleDelete = async (e, issue) => {
    e.stopPropagation();
    if (!confirm(`Удалить замечание #${issue.local_number}? Действие необратимо.`)) return;
    try {
      await api.deleteIssue(issue.id);
      load();
    } catch (err) {
      alert(err.message);
    }
  };

  if (loading) return <div className="empty">Загрузка...</div>;
  if (!project) return <div className="empty">Проект не найден</div>;

  const canCreate = user.role === 'admin' || members.some(m => m.id === user.id && m.role_in_project === 'tester');

  return (
    <div className="page">
      <Link to="/" style={{ fontSize: 14, textDecoration: 'none' }}>← Проекты</Link>

      <div className="page-header">
        <div>
          <div className="title">{project.name}</div>
          <div className="muted">Заказчик: {project.client_name}</div>
          {project.manager_name && <div className="muted">Руководитель проекта: {project.manager_name}</div>}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {user.role === 'admin' && (
            <Link
              to={`/projects/${project.slug}/manage`}
              style={{
                fontSize: 14,
                textDecoration: 'none',
                color: '#4b5563',
                border: '1px solid #d1d5db',
                borderRadius: 6,
                padding: '8px 14px',
                background: '#fff'
              }}
            >
              ⚙ Управление проектом
            </Link>
          )}
          {canCreate && (
            <button onClick={openCreate}>+ Новое замечание</button>
          )}
        </div>
      </div>

      <div className="filters">
        <select value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })} title="Фильтр по статусу замечания">
          <option value="">Все статусы</option>
          {STATUS_ORDER.map(k => (
            <option key={k} value={k} title={STATUS_DESCRIPTIONS[k]}>{STATUS_LABELS[k]}</option>
          ))}
        </select>
        {bots.length > 0 && (
          <select value={filters.bot_id} onChange={e => setFilters({ ...filters, bot_id: e.target.value })}>
            <option value="">Все боты</option>
            {bots.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        <select value={filters.created_by} onChange={e => setFilters({ ...filters, created_by: e.target.value })}>
          <option value="">Все тестировщики</option>
          {testers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <select value={filters.assigned_to} onChange={e => setFilters({ ...filters, assigned_to: e.target.value })}>
          <option value="">Все скриптологи</option>
          {developers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        {hasFilters && (
          <button
            className="btn-secondary btn-sm"
            onClick={() => setFilters({ status: '', bot_id: '', created_by: '', assigned_to: '' })}
          >
            Сбросить
          </button>
        )}
      </div>

      <div className="card">
        <table className="issues-table">
          <thead>
            <tr>
              <th style={{ width: 60 }}>#</th>
              <th>Описание</th>
              <th>Статус</th>
              <th>Автор</th>
              <th>Ответственный</th>
              <th>Обновлено</th>
              <th style={{ width: 48 }} aria-label="Действия"></th>
            </tr>
          </thead>
          <tbody>
            {issues.map(issue => (
              <tr key={issue.id} onClick={() => navigate(`/projects/${project.slug}/issues/${issue.id}`)}>
                <td><strong>#{issue.local_number}</strong></td>
                <td className="preview">{issue.first_message?.slice(0, 80) || '—'}</td>
                <td>
                  <span
                    className="badge"
                    style={{ background: STATUS_COLORS[issue.status], cursor: 'help' }}
                    title={STATUS_DESCRIPTIONS[issue.status]}
                  >
                    {STATUS_LABELS[issue.status]}
                  </span>
                </td>
                <td>{issue.creator_name}</td>
                <td>{issue.assignee_name || '—'}</td>
                <td className="muted">{formatDateTime(issue.updated_at)}</td>
                <td onClick={e => e.stopPropagation()} style={{ textAlign: 'center', width: 48 }}>
                  {(user.role === 'admin' || issue.created_by === user.id) && (
                    <button
                      className="icon-btn danger"
                      title="Удалить замечание"
                      onClick={e => handleDelete(e, issue)}
                    >
                      <TrashIcon />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {issues.length === 0 && (
          <div className="empty">
            {hasFilters ? 'Замечаний по выбранным фильтрам нет' : 'Замечаний пока нет'}
          </div>
        )}
      </div>
    </div>
  );
}
