import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { STATUS_LABELS, STATUS_DESCRIPTIONS, STATUS_BADGE_CLASS } from '../constants/statuses.js';
import MessageComposer from '../components/MessageComposer.jsx';
import { usePageTitle } from '../utils/pageTitle.js';

export default function IssueCreatePage() {
  const { projectSlug } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  usePageTitle(project?.name ? `${project.name} · Новое замечание` : 'Новое замечание');
  const [developers, setDevelopers] = useState([]);
  const [bots, setBots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [assignedTo, setAssignedTo] = useState('');
  const [botId, setBotId] = useState('');
  const [creating, setCreating] = useState(false);
  const [composerH, setComposerH] = useState(() => Number(localStorage.getItem('issueComposerH2')) || 90);

  useEffect(() => { localStorage.setItem('issueComposerH2', String(composerH)); }, [composerH]);

  const startResizeHeight = (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = composerH;
    const onMove = (ev) => setComposerH(Math.max(36, Math.min(420, startH + (startY - ev.clientY))));
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  useEffect(() => {
    api.getProject(projectSlug)
      .then(proj => {
        setProject(proj.project);
        setBots(proj.bots);
        setDevelopers(proj.members.filter(m => m.role_in_project === 'developer'));
      })
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, [projectSlug]);

  useEffect(() => {
    setAssignedTo(prev => prev || String(developers[0]?.id || ''));
  }, [developers]);

  const handleCreate = async () => {
    if (!text.trim() && files.length === 0) {
      alert('Введите описание замечания');
      return;
    }
    setCreating(true);
    try {
      const formData = new FormData();
      formData.append('project_id', project.id);
      if (botId) formData.append('bot_id', botId);
      if (assignedTo) formData.append('assigned_to', assignedTo);
      formData.append('text', text);
      for (const file of files) formData.append('attachments', file);
      const res = await api.createIssue(formData, project.id);
      navigate(`/projects/${project.slug}/issues/${res.issue.id}`);
    } catch (err) {
      alert(err.message);
    } finally {
      setCreating(false);
    }
  };

  if (loading) return <div className="empty">Загрузка...</div>;
  if (!project) return <div className="empty">Проект не найден</div>;

  return (
    <div style={{ maxWidth: 1500, margin: '0 auto', padding: '16px 20px' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'stretch', height: 'calc(100vh - 96px)' }}>

        {/* Левая колонка: ввод замечания */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <Link to={`/projects/${project.slug}`} style={{ color: '#3498db', fontSize: 14, marginBottom: 8 }}>← К замечаниям</Link>

          <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #eee', borderRadius: 8, padding: 16, background: '#fafafa', marginBottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="muted" style={{ textAlign: 'center', maxWidth: 360 }}>
              Опишите замечание в поле ниже и при необходимости прикрепите скриншоты.
            </div>
          </div>

          <MessageComposer
            text={text}
            setText={setText}
            files={files}
            setFiles={setFiles}
            onSubmit={handleCreate}
            submitLabel={null}
            sendOnEnter={false}
            disabled={creating}
            placeholder="Описание замечания..."
            height={composerH}
            onResizeStart={startResizeHeight}
          />
        </div>

        {/* Правая колонка */}
        <aside style={{ width: 340, flexShrink: 0, overflowY: 'auto' }}>
          <div className="card" style={{ padding: 16, marginBottom: 16 }}>
            <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
              Проект: <Link to={`/projects/${project.slug}`} style={{ textDecoration: 'none' }}>{project.name}</Link>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <h2 style={{ margin: 0 }}>*</h2>
              <span
                title={STATUS_DESCRIPTIONS.new}
                className={`rounded-full border px-3 py-1 text-xs font-bold cursor-help ${STATUS_BADGE_CLASS('new')}`}
              >
                {STATUS_LABELS.new}
              </span>
            </div>

            <div className="muted" style={{ fontSize: 13 }}>Автор: {user.name}</div>

            {bots.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <label className="muted" style={{ fontSize: 13 }}>Бот</label>
                <select value={botId} onChange={e => setBotId(e.target.value)} style={{ width: '100%', marginTop: 4 }}>
                  <option value="">Без привязки к боту</option>
                  {bots.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            )}

            <div style={{ marginTop: 12 }}>
              <label className="muted" style={{ fontSize: 13 }}>Ответственный скриптолог</label>
              <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)} style={{ width: '100%', marginTop: 4 }}>
                <option value="">— не назначен —</option>
                {developers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => navigate(`/projects/${project.slug}`)}
                disabled={creating}
              >
                Отмена
              </button>
              <button type="button" onClick={handleCreate} disabled={creating}>
                {creating ? 'Создание...' : 'Создать'}
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
