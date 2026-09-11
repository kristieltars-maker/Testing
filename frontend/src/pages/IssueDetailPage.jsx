import { useState, useEffect, useRef } from 'react';
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
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    const urls = files.map(f => ({ file: f, url: URL.createObjectURL(f) }));
    setPreviews(urls);
    return () => urls.forEach(u => URL.revokeObjectURL(u.url));
  }, [files]);

  const addFiles = (list) => {
    const images = Array.from(list).filter(f => f.type.startsWith('image/'));
    if (images.length) setFiles(prev => [...prev, ...images]);
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

  const handleSend = async (statusChange) => {
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

  if (loading) return <div>Загрузка...</div>;
  if (!issue) return <div>Замечание не найдено</div>;

  const isAdmin = user.role === 'admin';

  const projectLink = issue.project_slug || projectSlug || issue.project_id;

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: 20 }}>
      <Link to={`/projects/${projectLink}`} style={{ color: '#3498db' }}>← К замечаниям</Link>

      <div className="muted" style={{ margin: '10px 0 2px' }}>
        Проект: <Link to={`/projects/${projectLink}`} style={{ textDecoration: 'none' }}>{issue.project_name || '—'}</Link>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, marginTop: 4, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>#{issue.local_number}</h2>
        <span
          title={STATUS_DESCRIPTIONS[issue.status]}
          style={{
            background: STATUS_COLORS[issue.status],
            color: '#fff',
            padding: '4px 12px',
            borderRadius: 999,
            fontWeight: 'bold',
            cursor: 'help'
          }}
        >
          {STATUS_LABELS[issue.status]}
        </span>
        {issue.bot_name && <span style={{ color: '#666' }}>Бот: {issue.bot_name}</span>}
        <span style={{ color: '#666' }}>Автор: {issue.creator_name}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {isAdmin && (
            <>
              <button onClick={() => setEditing(!editing)} style={{ padding: '4px 12px', fontSize: 13, background: '#7f8c8d' }}>
                Редактировать
              </button>
              <button onClick={handleDelete} style={{ padding: '4px 12px', fontSize: 13, background: '#c0392b' }}>
                Удалить
              </button>
            </>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <label style={{ fontSize: 14, color: '#666' }}>Ответственный скриптолог:</label>
        <select
          value={issue.assigned_to || ''}
          onChange={e => handleAssign(e.target.value)}
          style={{ padding: 6 }}
        >
          <option value="">— не назначен —</option>
          {developers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>

      {editing && (
        <form onSubmit={handleEditSave} style={{ marginBottom: 16, padding: 12, border: '1px solid #ccc', background: '#fafafa' }}>
          <div style={{ marginBottom: 8, fontSize: 13, color: '#666' }}>Редактирование замечания (admin)</div>
          <textarea
            value={editForm.text}
            onChange={e => setEditForm({ ...editForm, text: e.target.value })}
            rows={3}
            style={{ width: '100%', padding: 8, marginBottom: 8 }}
          />
          {bots.length > 0 && (
            <select value={editForm.bot_id} onChange={e => setEditForm({ ...editForm, bot_id: e.target.value })} style={{ padding: 6, marginBottom: 8, width: '100%' }}>
              <option value="">Без привязки к боту</option>
              {bots.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <button type="submit" style={{ padding: '6px 16px' }}>Сохранить</button>
        </form>
      )}

      {transitions.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div className="muted" style={{ marginBottom: 6 }}>Сменить статус (наведите, чтобы увидеть пояснение):</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {transitions.map(status => (
              <button
                key={status}
                onClick={() => handleSend(status)}
                disabled={sending}
                title={`${STATUS_LABELS[status]} — ${STATUS_DESCRIPTIONS[status]}`}
                style={{
                  padding: '6px 14px',
                  background: STATUS_COLORS[status],
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6
                }}
              >
                {STATUS_LABELS[status]}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ border: '1px solid #eee', borderRadius: 8, padding: 16, marginBottom: 16, minHeight: 320, maxHeight: '70vh', overflowY: 'auto', background: '#fafafa' }}>
        {messages.map(msg => (
          <div key={msg.id} style={{ marginBottom: 16 }}>
            {msg.is_system ? (
              <div style={{ textAlign: 'center', color: '#999', fontSize: 13, padding: '8px 0' }}>
                {msg.text}
                <div style={{ fontSize: 11, color: '#bbb', marginTop: 2 }}>{formatDateTime(msg.created_at)}</div>
              </div>
            ) : (
              <div style={{
                display: 'flex',
                flexDirection: msg.author_id === user.id ? 'row-reverse' : 'row',
                gap: 10
              }}>
                <div style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  background: msg.author_role === 'tester' ? '#3498db' : (msg.author_role === 'admin' ? '#8e44ad' : '#27ae60'),
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 14,
                  fontWeight: 'bold',
                  flexShrink: 0
                }}>
                  {msg.author_name[0]}
                </div>
                <div style={{
                  maxWidth: msg.attachments.length > 0 ? '88%' : '70%',
                  background: msg.author_id === user.id ? '#e8f4fd' : '#f5f5f5',
                  padding: 10,
                  borderRadius: 8
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
                          onClick={() => setLightbox(`/${att.file_path}`)}
                        />
                      ))}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>
                    {formatDateTime(msg.created_at)}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
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
          transition: 'background .15s ease, border-color .15s ease'
        }}
      >
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 10, background: '#fff' }}>
          {previews.length > 0 && (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
              {previews.map((p, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  <img
                    src={p.url}
                    alt={p.file.name}
                    title={p.file.name}
                    style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 8, border: '1px solid #e5e7eb' }}
                  />
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
            onPaste={e => { if (e.clipboardData?.files?.length) { e.preventDefault(); addFiles(e.clipboardData.files); } }}
            placeholder={previews.length > 0 ? 'Подпись к изображению...' : 'Написать сообщение...'}
            rows={previews.length > 0 ? 2 : 3}
            style={{ width: '100%', padding: 8, border: 'none', outline: 'none', resize: 'vertical', background: 'transparent' }}
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

      {lightbox && (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.9)', display: 'flex', alignItems: 'center',
            justifyContent: 'center', zIndex: 1000, cursor: 'pointer'
          }}
          onClick={() => setLightbox(null)}
        >
          <img src={lightbox} style={{ maxWidth: '90%', maxHeight: '90%' }} />
        </div>
      )}
    </div>
  );
}
