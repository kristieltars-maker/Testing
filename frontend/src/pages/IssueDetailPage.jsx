import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { STATUS_LABELS, STATUS_DESCRIPTIONS, STATUS_BADGE_CLASS, STATUS_PILL_BUTTON_CLASS } from '../constants/statuses.js';
import { formatDateTime } from '../utils/datetime.js';
import { renderFormatted } from '../utils/format.js';
import TrashIcon from '../components/TrashIcon.jsx';
import PencilIcon from '../components/PencilIcon.jsx';
import MessageComposer from '../components/MessageComposer.jsx';
import { usePageTitle } from '../utils/pageTitle.js';

export default function IssueDetailPage() {
  const { issueId, projectSlug } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [issue, setIssue] = useState(null);
  usePageTitle(issue?.local_number ? `Замечание #${issue.local_number}` : 'Замечание');
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
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [quoteNonce, setQuoteNonce] = useState(0);
  const composerRef = useRef(null);
  const [replyTo, setReplyTo] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [editMsgText, setEditMsgText] = useState('');
  const [editMsgFiles, setEditMsgFiles] = useState([]);
  const [editMsgRemove, setEditMsgRemove] = useState([]);
  const [sidebarWidth, setSidebarWidth] = useState(() => Number(localStorage.getItem('issueSidebarWidth')) || 340);
  const [composerH, setComposerH] = useState(() => Number(localStorage.getItem('issueComposerH2')) || 38);
  const bottomRef = useRef(null);

  useEffect(() => { localStorage.setItem('issueSidebarWidth', String(sidebarWidth)); }, [sidebarWidth]);
  useEffect(() => { localStorage.setItem('issueComposerH2', String(composerH)); }, [composerH]);

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
      await api.issueView(issueId).catch(() => {});
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

  useEffect(() => {
    if (!contextMenu) return;
    const onKey = (e) => { if (e.key === 'Escape') setContextMenu(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [contextMenu]);

  const handleSend = useCallback(async (statusChange) => {
    if (!text && files.length === 0 && !statusChange) return;
    setSending(true);
    let prefix = '';
    try {
      prefix = buildReplyPrefix();
    } catch {
      prefix = '';
    }
    const finalText = prefix ? `${prefix}\n${text}` : text;
    const formData = new FormData();
    if (finalText) formData.append('text', finalText);
    if (statusChange) formData.append('status_change', statusChange);
    for (const file of files) formData.append('attachments', file);

    try {
      await api.addMessage(issueId, formData);
      setText('');
      setFiles([]);
      setReplyTo(null);
      load();
    } catch (err) {
      alert(err.message);
    } finally {
      setSending(false);
    }
  }, [text, files, issueId, replyTo]);

  const startEditMessage = (msg) => {
    setEditingMessageId(msg.id);
    setEditMsgText(msg.text || '');
    setEditMsgFiles([]);
    setEditMsgRemove([]);
  };

  const cancelEdit = () => {
    setEditingMessageId(null);
    setEditMsgText('');
    setEditMsgFiles([]);
    setEditMsgRemove([]);
  };

  // Ответ на конкретное сообщение (Telegram-style):
  // — «шапка» ответа над редактором (как заблокированная),
  // — в открытый текст ответ ничего не подмешивается,
  // — при отправке к тексту добавляется markdown-блок цитаты, чтобы ссылка
  //   на источник сохранилась в истории ленты.
  const selectionInBubble = (msgId) => {
    try {
      const sel = window.getSelection();
      const bubble = document.querySelector(`[data-msg-id="${msgId}"]`);
      if (!bubble || !sel || sel.isCollapsed || sel.rangeCount === 0) return '';
      const range = sel.getRangeAt(0);
      if (!bubble.contains(range.commonAncestorContainer)) return '';
      return sel.toString().replace(/\s+/g, ' ').trim();
    } catch {
      return '';
    }
  };

  const clampLine = (value, max) => {
    const str = String(value || '').replace(/\s+/g, ' ').trim();
    return str.length > max ? str.slice(0, max).trimEnd() + '…' : str;
  };

  const cancelReply = () => setReplyTo(null);

  const startReply = (msg, selection = '') => {
    const mode = selection ? 'quote' : 'full';
    setReplyTo({
      msgId: msg.id,
      authorName: msg.author_name || '',
      mode,
      quote: selection || String(msg.text || ''),
    });
    setQuoteNonce(n => n + 1);
    requestAnimationFrame(() => {
      composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });
  };

  const openMessageMenu = (event, msg) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      msg,
      hasSelection: Boolean(selectionInBubble(msg.id)),
      x: event.clientX,
      y: event.clientY,
    });
  };

  const closeMessageMenu = () => setContextMenu(null);

  const replyPrefixText = () => {
    if (!replyTo) return '';
    const isQuote = replyTo.mode === 'quote';
    const label = isQuote ? 'Цитата' : 'Ответ';
    const body = clampLine(replyTo.quote, 300);
    if (!body) return '';
    const lines = body.split('\n').map(line => `> ${line.replace(/^>\s*/, '')}`);
    return `> **${label} @${replyTo.authorName}:**\n${lines.join('\n')}`;
  };

  const toggleEditRemove = (attId) => {
    setEditMsgRemove(prev => prev.includes(attId) ? prev.filter(x => x !== attId) : [...prev, attId]);
  };

  const saveEditMessage = async () => {
    if (!editingMessageId) return;
    try {
      const formData = new FormData();
      formData.append('text', editMsgText);
      if (editMsgRemove.length) formData.append('remove_attachment_ids', editMsgRemove.join(','));
      for (const f of editMsgFiles) formData.append('attachments', f);
      await api.editMessage(issueId, editingMessageId, formData);
      cancelEdit();
      load();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDeleteMessage = async (msg) => {
    if (!confirm('Удалить сообщение? Действие необратимо.')) return;
    try {
      await api.deleteMessage(issueId, msg.id);
      load();
    } catch (err) {
      alert(err.message);
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
  const canDelete = isAdmin || issue.created_by === user.id;
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
                    background: editingMessageId === msg.id
                      ? '#fff3cd'
                      : (msg.author_id === user.id ? '#e8f4fd' : '#f5f5f5'),
                    outline: editingMessageId === msg.id ? '1px solid #f0c36d' : 'none',
                    padding: 10, borderRadius: 8,
                    cursor: 'default'
                  }} data-msg-id={msg.id} onContextMenu={e => openMessageMenu(e, msg)}>
                    <div style={{ fontWeight: 'bold', fontSize: 13, marginBottom: 4 }}>{msg.author_name}</div>

                    {msg.attachments.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: msg.text ? 8 : 0, alignItems: 'center' }}>
                        {msg.attachments.map(att => {
                          const removed = editingMessageId === msg.id && editMsgRemove.includes(att.id);
                          return (
                            <div key={att.id} style={{ position: 'relative', maxWidth: '100%' }}>
                              <img
                                src={`/${att.file_path}`}
                                alt={att.file_name}
                                title={editingMessageId === msg.id ? '' : `${att.file_name} — нажмите для увеличения`}
                                style={{
                                  maxWidth: '100%', maxHeight: 420, borderRadius: 8,
                                  cursor: editingMessageId === msg.id ? 'default' : 'zoom-in',
                                  border: '1px solid #e5e7eb', display: 'block',
                                  opacity: removed ? 0.3 : 1
                                }}
                                onClick={() => {
                                  if (editingMessageId !== msg.id) {
                                    setLightbox({ url: `/${att.file_path}`, text: msg.text, author: msg.author_name, created_at: msg.created_at });
                                  }
                                }}
                              />
                              {editingMessageId === msg.id && (
                                <button
                                  type="button"
                                  title={removed ? 'Вернуть скриншот' : 'Убрать скриншот'}
                                  onClick={() => toggleEditRemove(att.id)}
                                  style={{
                                    position: 'absolute', top: 6, right: 6, width: 26, height: 26,
                                    padding: 0, borderRadius: '50%',
                                    background: removed ? '#27ae60' : '#e74c3c',
                                    color: '#fff', lineHeight: '22px', fontSize: 15
                                  }}
                                >
                                  {removed ? '↺' : '×'}
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {msg.text && (
                      <div
                        className="msg-text"
                        style={{ whiteSpace: 'pre-wrap' }}
                        dangerouslySetInnerHTML={{ __html: renderFormatted(msg.text) }}
                      />
                    )}

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 4 }}>
                      <div style={{ fontSize: 11, color: '#999' }}>{formatDateTime(msg.created_at)}</div>
                      {msg.author_id === user.id && editingMessageId !== msg.id && (
                        <div style={{ display: 'flex', gap: 2 }}>
                          <button
                            className="icon-btn"
                            title="Редактировать сообщение"
                            onClick={() => startEditMessage(msg)}
                          >
                            <PencilIcon size={13} />
                          </button>
                          <button
                            className="icon-btn danger"
                            title="Удалить сообщение"
                            onClick={() => handleDeleteMessage(msg)}
                          >
                            <TrashIcon size={13} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {chatMessages.length === 0 && <div className="empty" style={{ padding: 24 }}>Сообщений пока нет</div>}
            <div ref={bottomRef} />
          </div>

          {editingMessageId ? (
            <>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: '#fff3cd', border: '1px solid #f0c36d', borderBottom: 'none',
                borderRadius: '10px 10px 0 0', padding: '6px 12px', fontSize: 13, color: '#8a6d3b'
              }}>
                <span>✎ Редактирование сообщения</span>
                <button className="icon-btn" title="Отменить редактирование" onClick={cancelEdit}>×</button>
              </div>
              <MessageComposer
                text={editMsgText}
                setText={setEditMsgText}
                files={editMsgFiles}
                setFiles={setEditMsgFiles}
                onSubmit={saveEditMessage}
                submitLabel="Сохранить"
                sendOnEnter={false}
                placeholder="Текст сообщения..."
                height={composerH}
                onResizeStart={startResizeHeight}
              />
            </>
          ) : (
            <div ref={composerRef} style={{ flexShrink: 0 }}>
              {replyTo && (
                <div
                  className="flex items-start gap-2 rounded-t-lg border-b-0 bg-background p-2.5 shadow-sm"
                  style={{ borderLeft: `3px solid #3498db` }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#3498db" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'block', marginTop: 2, flexShrink: 0 }}>
                    <path d="M9 17l-5-5 5-5" />
                    <path d="M4 12h9a5 5 0 0 1 5 5v2" />
                  </svg>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold" style={{ color: '#3498db' }}>
                      {replyTo.mode === 'quote' ? 'Ответ на цитату' : 'Ответ на сообщение'} · {replyTo.authorName}
                    </div>
                    <div className="truncate text-sm text-muted-foreground">
                      {replyTo.quote}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="icon-btn"
                    title="Отменить ответ"
                    aria-label="Отменить ответ"
                    onClick={cancelReply}
                  >
                    ×
                  </button>
                </div>
              )}
              <MessageComposer
                text={text}
                setText={setText}
                files={files}
                setFiles={setFiles}
                onSubmit={() => handleSend(null)}
                submitLabel={sending ? 'Отправка...' : 'Отправить'}
                disabled={sending || (!text && files.length === 0)}
                sendOnEnter
                placeholder="Написать сообщение... (Enter — отправить, Shift+Enter — новая строка)"
                height={composerH}
                onResizeStart={startResizeHeight}
                focusSignal={quoteNonce}
              />
            </div>
          )}
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
                className={`rounded-full border px-3 py-1 text-xs font-bold cursor-help ${STATUS_BADGE_CLASS(issue.status)}`}
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
              <button onClick={() => setEditing(!editing)} className="btn-secondary btn-sm" style={{ marginTop: 12 }}>
                Редактировать
              </button>
            )}
            {canDelete && (
              <button
                onClick={handleDelete}
                className="btn-danger btn-sm"
                title="Удалить замечание"
                style={{ marginTop: 12, marginLeft: isAdmin ? 8 : 0, display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <TrashIcon /> Удалить
              </button>
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
                    className={`rounded-md border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${STATUS_PILL_BUTTON_CLASS(status)}`}
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

      {/* Контекстное меню сообщения (правый клик) */}
      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-[60]"
            onClick={closeMessageMenu}
            onContextMenu={e => { e.preventDefault(); closeMessageMenu(); }}
          />
          <div
            className="fixed z-[61] min-w-52 rounded-lg border bg-popover py-1 shadow-lg"
            style={{
              left: Math.min(contextMenu.x, window.innerWidth - 230),
              top: Math.min(contextMenu.y, window.innerHeight - 170)
            }}
            onContextMenu={e => e.preventDefault()}
          >
            {contextMenu.hasSelection ? (
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent"
                onClick={() => { closeMessageMenu(); startReply(contextMenu.msg, selectionInBubble(contextMenu.msg.id)); }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'block' }}>
                  <path d="M9 17l-5-5 5-5" />
                  <path d="M4 12h9a5 5 0 0 1 5 5v2" />
                </svg>
                Ответить с цитатой
              </button>
            ) : (
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent"
                onClick={() => { closeMessageMenu(); startReply(contextMenu.msg); }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'block' }}>
                  <path d="M9 17l-5-5 5-5" />
                  <path d="M4 12h9a5 5 0 0 1 5 5v2" />
                </svg>
                Ответить
              </button>
            )}
            {contextMenu.msg.author_id === user.id && (
              <>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent"
                  onClick={() => { closeMessageMenu(); startEditMessage(contextMenu.msg); }}
                >
                  <PencilIcon size={13} />
                  Редактировать
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10"
                  onClick={() => { closeMessageMenu(); handleDeleteMessage(contextMenu.msg); }}
                >
                  <TrashIcon size={13} />
                  Удалить
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
