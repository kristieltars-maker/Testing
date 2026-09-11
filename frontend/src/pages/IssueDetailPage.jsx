import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
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

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

export default function IssueDetailPage() {
  const { issueId } = useParams();
  const { user } = useAuth();
  const [issue, setIssue] = useState(null);
  const [messages, setMessages] = useState([]);
  const [transitions, setTransitions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const bottomRef = useRef(null);

  const load = () => {
    api.getIssue(issueId)
      .then(data => {
        setIssue(data.issue);
        setMessages(data.messages);
        setTransitions(data.available_transitions);
      })
      .finally(() => setLoading(false));
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

  if (loading) return <div>Загрузка...</div>;
  if (!issue) return <div>Замечание не найдено</div>;

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 20 }}>
      <Link to={`/projects/${issue.project_id}`} style={{ color: '#3498db' }}>← К замечаниям</Link>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, marginTop: 10 }}>
        <h2 style={{ margin: 0 }}>#{issue.local_number}</h2>
        <span style={{
          background: STATUS_COLORS[issue.status],
          color: '#fff',
          padding: '4px 12px',
          borderRadius: 4,
          fontWeight: 'bold'
        }}>
          {STATUS_LABELS[issue.status]}
        </span>
        {issue.bot_name && <span style={{ color: '#666' }}>Бот: {issue.bot_name}</span>}
      </div>

      {transitions.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {transitions.map(status => (
            <button
              key={status}
              onClick={() => handleSend(status)}
              disabled={sending}
              style={{
                padding: '6px 14px',
                background: STATUS_COLORS[status],
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer'
              }}
            >
              {STATUS_LABELS[status]}
            </button>
          ))}
        </div>
      )}

      <div style={{ border: '1px solid #eee', borderRadius: 8, padding: 16, marginBottom: 16, maxHeight: 500, overflowY: 'auto' }}>
        {messages.map(msg => (
          <div key={msg.id} style={{ marginBottom: 16 }}>
            {msg.is_system ? (
              <div style={{ textAlign: 'center', color: '#999', fontSize: 13, padding: '8px 0' }}>
                {msg.text}
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
                  background: msg.author_role === 'tester' ? '#3498db' : '#27ae60',
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
                  maxWidth: '70%',
                  background: msg.author_id === user.id ? '#e8f4fd' : '#f5f5f5',
                  padding: 10,
                  borderRadius: 8
                }}>
                  <div style={{ fontWeight: 'bold', fontSize: 13, marginBottom: 4 }}>{msg.author_name}</div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</div>
                  {msg.attachments.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                      {msg.attachments.map(att => (
                        <img
                          key={att.id}
                          src={`/${att.file_path}`}
                          alt={att.file_name}
                          style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 4, cursor: 'pointer' }}
                          onClick={() => setLightbox(`/${att.file_path}`)}
                        />
                      ))}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>
                    {new Date(msg.created_at).toLocaleString('ru-RU')}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div style={{ borderTop: '1px solid #eee', paddingTop: 12 }}>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Написать сообщение..."
          rows={3}
          style={{ width: '100%', padding: 8, marginBottom: 8 }}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="file"
            multiple
            accept="image/*"
            onChange={e => setFiles(Array.from(e.target.files))}
          />
          <button
            onClick={() => handleSend(null)}
            disabled={sending || (!text && files.length === 0)}
            style={{ padding: '8px 20px', marginLeft: 'auto' }}
          >
            {sending ? 'Отправка...' : 'Отправить'}
          </button>
        </div>
        {files.length > 0 && (
          <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>
            Прикреплено файлов: {files.length}
          </div>
        )}
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
