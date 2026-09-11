import { useState, useEffect } from 'react';
import { api } from '../api/client.js';

const ROLE_LABELS = { admin: 'Админ', tester: 'Тестировщик', developer: 'Скриптолог' };

function PasswordInput({ value, onChange, placeholder, required, visible, onToggle, style }) {
  return (
    <div style={{ position: 'relative', ...style }}>
      <input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        style={{ width: '100%', padding: '6px 80px 6px 6px' }}
      />
      <button
        type="button"
        onClick={onToggle}
        title={visible ? 'Скрыть пароль' : 'Показать пароль'}
        style={{
          position: 'absolute',
          right: 4,
          top: '50%',
          transform: 'translateY(-50%)',
          background: 'transparent',
          color: '#6b7280',
          fontSize: 12,
          padding: '4px 8px'
        }}
      >
        {visible ? 'Скрыть' : 'Показать'}
      </button>
    </div>
  );
}

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'tester' });
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', email: '', role: 'tester', password: '' });
  const [editError, setEditError] = useState('');
  const [manageUser, setManageUser] = useState(null);
  const [allProjects, setAllProjects] = useState([]);
  const [manageRoles, setManageRoles] = useState({});
  const [manageSaving, setManageSaving] = useState(false);
  const [showCreatePass, setShowCreatePass] = useState(false);
  const [showEditPass, setShowEditPass] = useState(false);

  const load = () => {
    api.getUsers()
      .then(data => setUsers(data.users))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.createUser(form);
      setForm({ name: '', email: '', password: '', role: 'tester' });
      setShowCreatePass(false);
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const startEdit = (user) => {
    setEditingId(user.id);
    setEditError('');
    setShowEditPass(false);
    setEditForm({ name: user.name, email: user.email, role: user.role, password: '' });
  };

  const handleEdit = async (e) => {
    e.preventDefault();
    setEditError('');
    try {
      await api.updateUser(editingId, {
        name: editForm.name,
        email: editForm.email,
        role: editForm.role
      });
      if (editForm.password) {
        await api.changePassword(editingId, editForm.password);
      }
      setEditingId(null);
      load();
    } catch (err) {
      setEditError(err.message);
    }
  };

  const toggleActive = async (user) => {
    await api.updateUser(user.id, { is_active: !user.is_active });
    load();
  };

  const openManage = async (user) => {
    setManageUser(user);
    const [proj, mem] = await Promise.all([
      api.getProjects(),
      api.getUserMemberships(user.id)
    ]);
    setAllProjects(proj.projects);
    const roles = {};
    for (const m of mem.memberships) {
      roles[m.project_id] = m.role_in_project;
    }
    setManageRoles(roles);
  };

  const saveManage = async () => {
    setManageSaving(true);
    try {
      const memberships = Object.entries(manageRoles)
        .filter(([, role]) => role)
        .map(([project_id, role_in_project]) => ({ project_id: Number(project_id), role_in_project }));
      await api.setUserMemberships(manageUser.id, memberships);
      setManageUser(null);
      load();
    } catch (err) {
      alert(err.message);
    } finally {
      setManageSaving(false);
    }
  };

  if (loading) return <div>Загрузка...</div>;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Пользователи</h1>
        <button onClick={() => setShowForm(!showForm)} style={{ padding: '8px 16px' }}>
          + Добавить пользователя
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} style={{ marginBottom: 20, padding: 15, border: '1px solid #ccc' }}>
          {error && <div style={{ color: 'red', marginBottom: 8 }}>{error}</div>}
          <input placeholder="Имя" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required style={{ padding: 6, width: '100%', marginBottom: 8 }} />
          <input placeholder="Email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required style={{ padding: 6, width: '100%', marginBottom: 8 }} />
          <PasswordInput
            placeholder="Пароль"
            value={form.password}
            onChange={e => setForm({ ...form, password: e.target.value })}
            required
            visible={showCreatePass}
            onToggle={() => setShowCreatePass(!showCreatePass)}
            style={{ marginBottom: 8 }}
          />
          <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} style={{ padding: 6, width: '100%', marginBottom: 4 }}>
            <option value="tester">Тестировщик</option>
            <option value="developer">Скриптолог</option>
            <option value="admin">Админ</option>
          </select>
          <div className="muted" style={{ marginBottom: 8, fontSize: 12 }}>
            Роль по умолчанию. В каждом проекте роль задаётся отдельно (кнопка «Проекты»): один и тот же пользователь может быть тестировщиком в одном проекте и скриптологом в другом.
          </div>
          <button type="submit" style={{ padding: '6px 16px' }}>Создать</button>
        </form>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #ddd', textAlign: 'left' }}>
            <th style={{ padding: 8 }}>Имя</th>
            <th style={{ padding: 8 }}>Email</th>
            <th style={{ padding: 8 }}>Роль (по умолч.)</th>
            <th style={{ padding: 8 }}>Статус</th>
            <th style={{ padding: 8 }}>Проекты</th>
            <th style={{ padding: 8 }}>Действия</th>
          </tr>
        </thead>
        <tbody>
          {users.map(u => (
            editingId === u.id ? (
              <tr key={u.id} style={{ borderBottom: '1px solid #eee', background: '#f9f9f9' }}>
                <td colSpan={6} style={{ padding: 12 }}>
                  <form onSubmit={handleEdit}>
                    {editError && <div style={{ color: 'red', marginBottom: 8 }}>{editError}</div>}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <input placeholder="Имя" value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} required style={{ padding: 6, flex: 1, minWidth: 150 }} />
                      <input placeholder="Email" type="email" value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value })} required style={{ padding: 6, flex: 1, minWidth: 150 }} />
                      <select value={editForm.role} onChange={e => setEditForm({ ...editForm, role: e.target.value })} style={{ padding: 6 }}>
                        <option value="tester">Тестировщик</option>
                        <option value="developer">Скриптолог</option>
                        <option value="admin">Админ</option>
                      </select>
                      <PasswordInput
                        placeholder="Новый пароль (опционально)"
                        value={editForm.password}
                        onChange={e => setEditForm({ ...editForm, password: e.target.value })}
                        visible={showEditPass}
                        onToggle={() => setShowEditPass(!showEditPass)}
                        style={{ flex: 1, minWidth: 200 }}
                      />
                      <button type="submit" style={{ padding: '6px 16px' }}>Сохранить</button>
                      <button type="button" onClick={() => setEditingId(null)} style={{ padding: '6px 16px', background: '#95a5a6' }}>Отмена</button>
                    </div>
                  </form>
                </td>
              </tr>
            ) : (
              <tr key={u.id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: 8 }}>{u.name}</td>
                <td style={{ padding: 8 }}>{u.email}</td>
                <td style={{ padding: 8 }}>{ROLE_LABELS[u.role]}</td>
                <td style={{ padding: 8 }}>
                  <span style={{ color: u.is_active ? '#27ae60' : '#e74c3c' }}>
                    {u.is_active ? 'Активен' : 'Деактивирован'}
                  </span>
                </td>
                <td style={{ padding: 8, fontSize: 13 }}>{u.projects || '—'}</td>
                <td style={{ padding: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button onClick={() => startEdit(u)} style={{ padding: '4px 10px', fontSize: 13 }}>Редактировать</button>
                  <button onClick={() => openManage(u)} style={{ padding: '4px 10px', fontSize: 13, background: '#2980b9' }}>Проекты</button>
                  <button onClick={() => toggleActive(u)} style={{ padding: '4px 10px', fontSize: 13, background: u.is_active ? '#e67e22' : '#27ae60' }}>
                    {u.is_active ? 'Деактивировать' : 'Активировать'}
                  </button>
                </td>
              </tr>
            )
          ))}
        </tbody>
      </table>

      {manageUser && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', padding: 20, borderRadius: 8, width: 520, maxWidth: '90%', maxHeight: '80%', overflowY: 'auto' }}>
            <h2>Проекты: {manageUser.name}</h2>
            <p style={{ color: '#666', fontSize: 14 }}>
              Отметьте проекты, в которых участвует пользователь, и укажите его роль в каждом.
            </p>
            {allProjects.map(p => (
              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #eee' }}>
                <span>{p.name} <span style={{ color: '#999', fontSize: 12 }}>({p.client_name})</span></span>
                <select
                  value={manageRoles[p.id] || ''}
                  onChange={e => setManageRoles({ ...manageRoles, [p.id]: e.target.value })}
                  style={{ padding: 6 }}
                >
                  <option value="">Не участвует</option>
                  <option value="tester">Тестировщик</option>
                  <option value="developer">Скриптолог</option>
                </select>
              </div>
            ))}
            {allProjects.length === 0 && <div style={{ color: '#999', padding: 10 }}>Проектов пока нет</div>}
            <div style={{ marginTop: 20, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setManageUser(null)} style={{ padding: '6px 16px', background: '#95a5a6' }}>Отмена</button>
              <button onClick={saveManage} disabled={manageSaving} style={{ padding: '6px 16px' }}>
                {manageSaving ? 'Сохранение...' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
