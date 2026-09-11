import { useState, useEffect } from 'react';
import { api } from '../api/client.js';

const ROLE_LABELS = { admin: 'Админ', tester: 'Тестировщик', developer: 'Скриптолог' };

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'tester' });
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', email: '', role: 'tester', password: '' });
  const [editError, setEditError] = useState('');

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
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const startEdit = (user) => {
    setEditingId(user.id);
    setEditError('');
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
          <input placeholder="Пароль" type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required style={{ padding: 6, width: '100%', marginBottom: 8 }} />
          <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} style={{ padding: 6, width: '100%', marginBottom: 8 }}>
            <option value="tester">Тестировщик</option>
            <option value="developer">Скриптолог</option>
            <option value="admin">Админ</option>
          </select>
          <button type="submit" style={{ padding: '6px 16px' }}>Создать</button>
        </form>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #ddd', textAlign: 'left' }}>
            <th style={{ padding: 8 }}>Имя</th>
            <th style={{ padding: 8 }}>Email</th>
            <th style={{ padding: 8 }}>Роль</th>
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
                      <input placeholder="Новый пароль (опционально)" type="password" value={editForm.password} onChange={e => setEditForm({ ...editForm, password: e.target.value })} style={{ padding: 6, flex: 1, minWidth: 180 }} />
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
                <td style={{ padding: 8, display: 'flex', gap: 6 }}>
                  <button onClick={() => startEdit(u)} style={{ padding: '4px 10px', fontSize: 13 }}>Редактировать</button>
                  <button onClick={() => toggleActive(u)} style={{ padding: '4px 10px', fontSize: 13, background: u.is_active ? '#e67e22' : '#27ae60' }}>
                    {u.is_active ? 'Деактивировать' : 'Активировать'}
                  </button>
                </td>
              </tr>
            )
          ))}
        </tbody>
      </table>
    </div>
  );
}
