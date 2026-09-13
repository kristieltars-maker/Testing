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
  const [sort, setSort] = useState({ by: 'updated_at', order: 'desc' });
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const load = () => {
    Promise.all([
      api.getProject(projectId),
      api.getIssues({
        project_id: projectId,
        sort_by: sort.by,
        sort_order: sort.order,
        ...(search ? { search } : {}),
        ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v))
      })
    ]).then(([proj, iss]) => {
      setProject(proj.project);
      setBots(proj.bots);
      setMembers(proj.members);
      setIssues(iss.issues);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [projectId, filters, sort, search]);

  const handleSort = (by) => {
    setSort(prev => {
      if (prev.by === by) {
        return { by, order: prev.order === 'asc' ? 'desc' : 'asc' };
      }
      const defaultOrder = (by === 'updated_at' || by === 'created_at') ? 'desc' : 'asc';
      return { by, order: defaultOrder };
    });
  };

  const SortableHeader = ({ by, children, style }) => (
    <th
      style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', ...style }}
      onClick={() => handleSort(by)}
      title="Сортировать"
    >
      {children}
      <span style={{ marginLeft: 6, color: sort.by === by ? '#3498db' : '#cbd5e1' }}>
        {sort.by === by ? (sort.order === 'asc' ? '▲' : '▼') : '↕'}
      </span>
    </th>
  );

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
        <input
          type="text"
          placeholder="Поиск по описанию..."
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          style={{ minWidth: 220 }}
        />
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
        {(hasFilters || search) && (
          <button
            className="btn-secondary btn-sm"
            onClick={() => { setFilters({ status: '', bot_id: '', created_by: '', assigned_to: '' }); setSearchInput(''); setSearch(''); }}
          >
            Сбросить
          </button>
        )}
      </div>

      <div className="card">
        <table className="issues-table">
          <thead>
            <tr>
              <SortableHeader by="local_number" style={{ width: 60 }}>#</SortableHeader>
              <SortableHeader by="description">Описание</SortableHeader>
              <SortableHeader by="status">Статус</SortableHeader>
              <SortableHeader by="creator">Автор</SortableHeader>
              <SortableHeader by="assignee">Ответственный</SortableHeader>
              <SortableHeader by="updated_at">Обновлено</SortableHeader>
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
