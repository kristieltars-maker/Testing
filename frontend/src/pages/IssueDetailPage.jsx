import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { STATUS_LABELS, STATUS_COLORS, STATUS_DESCRIPTIONS } from '../constants/statuses.js';
import { formatDateTime } from '../utils/datetime.js';

export default function IssueDetailPage() {
  const { issueId, projectSlug } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [issue, setIssue] = useState(null);
  const [messages, setMessages] = useState([]);
  const [transitions, setTransitions] = useState([]);
  const [developers, setDevelopers] = useState([]);
  const [bots, setBots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ text: '', bot_id: '' });
  const [drag, setDrag] = useState(false);
  const [previews, setPreviews] = useState([]);
  const [sidebarWidth, setSidebarWidth] = useState(() => Number(localStorage.getItem('issueSidebarWidth')) || 340);
  const [composerH, setComposerH] = useState(() => Number(localStorage.getItem('issueComposerH2')) || 38);
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    const urls = files.map(f => ({ file: f, url: URL.createObjectURL(f) }));
    setPreviews(urls);
    return () => urls.forEach(u => URL.revokeObjectURL(u.url));
  }, [files]);

  useEffect(() => { localStorage.setItem('issueSidebarWidth', String(sidebarWidth)); }, [sidebarWidth]);
  useEffect(() => { localStorage.setItem('issueComposerH2', String(composerH)); }, [composerH]);

  const addFiles = (list) => {
    const images = Array.from(list).filter(f => f.type.startsWith('image/'));
    if (images.length) setFiles(prev => [...prev, ...images]);
  };

  const startResizeWidth = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (ev) => {
      const next = startW + (startX - ev.clientX);
      setSidebarWidth(Math.max(240, Math.min(640, next)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const startResizeHeight = (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = composerH;
    const onMove = (ev) => {
      const next = startH + (startY - ev.clientY);
      setComposerH(Math.max(36, Math.min(420, next)));
    };
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

  const load = async () => {
    try {
      const data = await api.getIssue(issueId);
      setIssue(data.issue);
      setMessages(data.messages);
      setTransitions(data.available_transitions);

      const proj = await api.getProject(data.issue.project_id);
      setDevelopers(proj.members.filter(m => m.role_in_project === 'developer'));
      setBots(proj.bots);

      const first = data.messages.find(m => !m.is_system);
      setEditForm({ text: first?.text || '', bot_id: data.issue.bot_id || '' });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [issueId]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e) => { if (e.key === 'Escape') setLightbox(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);

  const handleSend = useCallback(async (statusChange) => {
    if (!text && files.length === 0 && !statusChange) return;
    setSending(true);
    const formData = new FormData();
    if (text) formData.append('text', text);
    if (statusChange) formData.append('status_change', statusChange);
    for (const file of files) formData.append('attachments', file);

    try {
      await api.addMessage(issueId, formData);
      setText('');
      setFiles([]);
      load();
    } catch (err) {
      alert(err.message);
    } finally {
      setSending(false);
    }
  }, [text, files, issueId]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
      e.preventDefault();
      handleSend(null);
    }
  };

  const handleAssign = async (value) => {
    try {
      await api.assignIssue(issueId, value || null);
      load();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleEditSave = async (e) => {
    e.preventDefault();
    try {
      await api.updateIssue(issueId, { text: editForm.text, bot_id: editForm.bot_id || null });
      setEditing(false);
      load();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Удалить замечание #${issue.local_number}? Действие необратимо.`)) return;
    try {
      await api.deleteIssue(issueId);
      navigate(`/projects/${issue.project_slug || issue.project_id}`);
    } catch (err) {
      alert(err.message);
    }
  };

  if (loading) return <div className="empty">Загрузка...</div>;
  if (!issue) return <div className="empty">Замечание не найдено</div>;

  const isAdmin = user.role === 'admin';
  const projectLink = issue.project_slug || projectSlug || issue.project_id;
  const chatMessages = messages.filter(m => !m.is_system);
  const history = messages.filter(m => m.is_system);

  return (
    <div style={{ maxWidth: 1500, margin: '0 auto', padding: '16px 20px' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'stretch', height: 'calc(100vh - 96px)' }}>

        {/* Левая колонка: чат + закреплённое поле ввода */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <Link to={`/projects/${projectLink}`} style={{ color: '#3498db', fontSize: 14, marginBottom: 8 }}>← К замечаниям</Link>

          <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #eee', borderRadius: 8, padding: 16, background: '#fafafa', marginBottom: 0 }}>
            {chatMessages.map(msg => (
              <div key={msg.id} style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', flexDirection: msg.author_id === user.id ? 'row-reverse' : 'row', gap: 10 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%',
                    background: msg.author_role === 'tester' ? '#3498db' : (msg.author_role === 'admin' ? '#8e44ad' : '#27ae60'),
                    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, fontWeight: 'bold', flexShrink: 0
                  }}>
                    {msg.author_name[0]}
                  </div>
                  <div style={{
                    maxWidth: msg.attachments.length > 0 ? '88%' : '70%',
                    background: msg.author_id === user.id ? '#e8f4fd' : '#f5f5f5',
                    padding: 10, borderRadius: 8
                  }}>
                    <div style={{ fontWeight: 'bold', fontSize: 13, marginBottom: 4 }}>{msg.author_name}</div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</div>
                    {msg.attachments.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8, alignItems: 'center' }}>
                        {msg.attachments.map(att => (
                          <img
                            key={att.id}
                            src={`/${att.file_path}`}
                            alt={att.file_name}
                            title={`${att.file_name} — нажмите для увеличения`}
                            style={{ maxWidth: '100%', maxHeight: 420, borderRadius: 8, cursor: 'zoom-in', border: '1px solid #e5e7eb', display: 'block' }}
                            onClick={() => setLightbox({ url: `/${att.file_path}`, text: msg.text, author: msg.author_name, created_at: msg.created_at })}
                          />
                        ))}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>{formatDateTime(msg.created_at)}</div>
                  </div>
                </div>
              </div>
            ))}
            {chatMessages.length === 0 && <div className="empty" style={{ padding: 24 }}>Сообщений пока нет</div>}
            <div ref={bottomRef} />
          </div>

          {/* Ручка изменения высоты поля ввода */}
          <div
            onMouseDown={startResizeHeight}
            title="Потяните, чтобы изменить высоту поля ввода"
            style={{ height: 10, cursor: 'row-resize', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
          >
            <div style={{ width: 44, height: 4, borderRadius: 2, background: '#d1d5db' }} />
          </div>

          <div
            onDragOver={e => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files); }}
            style={{
              border: `2px dashed ${drag ? '#3498db' : 'transparent'}`,
              background: drag ? '#eef6fd' : 'transparent',
              borderRadius: 12,
              padding: 4,
              flexShrink: 0,
              transition: 'background .15s ease, border-color .15s ease'
            }}
          >
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 10, background: '#fff' }}>
              {previews.length > 0 && (
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                  {previews.map((p, i) => (
                    <div key={i} style={{ position: 'relative' }}>
                      <img src={p.url} alt={p.file.name} title={p.file.name} style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: '1px solid #e5e7eb' }} />
                      <button
                        type="button"
                        title="Убрать"
                        onClick={() => setFiles(files.filter((_, idx) => idx !== i))}
                        style={{ position: 'absolute', top: -8, right: -8, width: 22, height: 22, padding: 0, borderRadius: '50%', background: '#e74c3c', lineHeight: '18px', fontSize: 14 }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {previews.length > 0 && (
                <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Подпись</div>
              )}

              <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={e => { if (e.clipboardData?.files?.length) { e.preventDefault(); addFiles(e.clipboardData.files); } }}
                placeholder={previews.length > 0 ? 'Подпись к изображению...' : 'Написать сообщение... (Enter — отправить, Shift+Enter — новая строка)'}
                style={{ width: '100%', height: composerH, padding: 8, border: 'none', outline: 'none', resize: 'none', background: 'transparent', overflowY: 'auto' }}
              />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  title="Прикрепить скриншот (можно перетащить или вставить Ctrl+V)"
                  onClick={() => fileInputRef.current?.click()}
                >
                  📎 Скриншот
                </button>
                <button
                  onClick={() => handleSend(null)}
                  disabled={sending || (!text && files.length === 0)}
                  style={{ padding: '8px 20px' }}
                >
                  {sending ? 'Отправка...' : 'Отправить'}
                </button>
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*"
              style={{ display: 'none' }}
              onChange={e => { addFiles(e.target.files); e.target.value = ''; }}
            />
          </div>
        </div>

        {/* Ручка изменения ширины чата */}
        <div
          onMouseDown={startResizeWidth}
          title="Потяните, чтобы изменить ширину чата"
          style={{ width: 10, cursor: 'col-resize', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
        >
          <div style={{ width: 4, height: 44, borderRadius: 2, background: '#d1d5db' }} />
        </div>

        {/* Правая колонка: информация, статусы, история */}
        <aside style={{ width: sidebarWidth, flexShrink: 0, overflowY: 'auto' }}>
          <div className="card" style={{ padding: 16, marginBottom: 16 }}>
            <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
              Проект: <Link to={`/projects/${projectLink}`} style={{ textDecoration: 'none' }}>{issue.project_name || '—'}</Link>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <h2 style={{ margin: 0 }}>#{issue.local_number}</h2>
              <span
                title={STATUS_DESCRIPTIONS[issue.status]}
                style={{
                  background: STATUS_COLORS[issue.status], color: '#fff',
                  padding: '4px 12px', borderRadius: 999, fontWeight: 'bold', fontSize: 13, cursor: 'help'
                }}
              >
                {STATUS_LABELS[issue.status]}
              </span>
            </div>

            <div className="muted" style={{ fontSize: 13 }}>Автор: {issue.creator_name}</div>
            {issue.bot_name && <div className="muted" style={{ fontSize: 13 }}>Бот: {issue.bot_name}</div>}

            <div style={{ marginTop: 12 }}>
              <label className="muted" style={{ fontSize: 13 }}>Ответственный скриптолог</label>
              <select
                value={issue.assigned_to || ''}
                onChange={e => handleAssign(e.target.value)}
                style={{ width: '100%', marginTop: 4 }}
              >
                <option value="">— не назначен —</option>
                {developers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>

            {isAdmin && (
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button onClick={() => setEditing(!editing)} className="btn-secondary btn-sm">Редактировать</button>
                <button onClick={handleDelete} className="btn-danger btn-sm">Удалить</button>
              </div>
            )}
          </div>

          {editing && (
            <form onSubmit={handleEditSave} className="card" style={{ padding: 16, marginBottom: 16 }}>
              <div className="muted" style={{ marginBottom: 8 }}>Редактирование замечания (admin)</div>
              <textarea
                value={editForm.text}
                onChange={e => setEditForm({ ...editForm, text: e.target.value })}
                rows={3}
                className="form-control"
                style={{ marginBottom: 8 }}
              />
              {bots.length > 0 && (
                <select
                  value={editForm.bot_id}
                  onChange={e => setEditForm({ ...editForm, bot_id: e.target.value })}
                  className="form-control"
                  style={{ marginBottom: 8 }}
                >
                  <option value="">Без привязки к боту</option>
                  {bots.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" className="btn-sm">Сохранить</button>
                <button type="button" className="btn-secondary btn-sm" onClick={() => setEditing(false)}>Отмена</button>
              </div>
            </form>
          )}

          {transitions.length > 0 && (
            <div className="card" style={{ padding: 16, marginBottom: 16 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Смена статуса</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {transitions.map(status => (
                  <button
                    key={status}
                    onClick={() => handleSend(status)}
                    disabled={sending}
                    title={`${STATUS_LABELS[status]} — ${STATUS_DESCRIPTIONS[status]}`}
                    style={{ padding: '8px 14px', background: STATUS_COLORS[status], color: '#fff', border: 'none', borderRadius: 6 }}
                  >
                    {STATUS_LABELS[status]}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>История статусов</div>
            {history.length === 0 && <div className="muted" style={{ fontSize: 13 }}>Пока нет изменений</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {history.map(h => (
                <div key={h.id} style={{ fontSize: 13, borderLeft: '2px solid #e5e7eb', paddingLeft: 10 }}>
                  <div>{h.text}</div>
                  <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{formatDateTime(h.created_at)}</div>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>

      {lightbox && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, cursor: 'zoom-out', padding: '48px 20px 20px'
          }}
          onClick={() => setLightbox(null)}
        >
          <button
            onClick={(e) => { e.stopPropagation(); setLightbox(null); }}
            title="Закрыть (Esc)"
            style={{ position: 'absolute', top: 12, right: 20, background: 'transparent', color: '#fff', fontSize: 30, lineHeight: 1, padding: '4px 10px' }}
          >
            ×
          </button>

          <img
            src={lightbox.url}
            alt={lightbox.text}
            style={{ maxWidth: '95%', maxHeight: lightbox.text ? '76vh' : '90vh', objectFit: 'contain', borderRadius: 6, cursor: 'zoom-out' }}
          />

          {lightbox.text && (
            <div style={{ marginTop: 16, color: '#fff', maxWidth: 720, textAlign: 'center' }}>
              <div style={{ whiteSpace: 'pre-wrap' }}>{lightbox.text}</div>
              <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, marginTop: 6 }}>
                {lightbox.author} · {formatDateTime(lightbox.created_at)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
