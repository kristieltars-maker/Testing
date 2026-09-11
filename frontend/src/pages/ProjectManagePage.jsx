import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client.js';

export default function ProjectManagePage() {
  const { projectId } = useParams();
  const [project, setProject] = useState(null);
  const [bots, setBots] = useState([]);
  const [members, setMembers] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newBot, setNewBot] = useState({ name: '', description: '' });
  const [newMember, setNewMember] = useState({ user_id: '', role_in_project: 'tester' });

  const load = () => {
    Promise.all([api.getProject(projectId), api.getUsers()])
      .then(([proj, users]) => {
        setProject(proj.project);
        setBots(proj.bots);
        setMembers(proj.members);
        setAllUsers(users.users.filter(u => u.is_active));
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [projectId]);

  const addBot = async (e) => {
    e.preventDefault();
    await api.addBot(projectId, newBot);
    setNewBot({ name: '', description: '' });
    load();
  };

  const deleteBot = async (botId) => {
    if (confirm('Удалить бота?')) {
      await api.deleteBot(projectId, botId);
      load();
    }
  };

  const addMember = async (e) => {
    e.preventDefault();
    await api.addMember(projectId, newMember);
    setNewMember({ user_id: '', role_in_project: 'tester' });
    load();
  };

  const removeMember = async (userId) => {
    await api.removeMember(projectId, userId);
    load();
  };

  if (loading) return <div>Загрузка...</div>;
  if (!project) return <div>Проект не найден</div>;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 20 }}>
      <Link to="/" style={{ color: '#3498db' }}>← Проекты</Link>
      <h1>Управление: {project.name}</h1>

      <section style={{ marginBottom: 30 }}>
        <h2>Боты</h2>
        {bots.map(b => (
          <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #eee' }}>
            <div>
              <strong>{b.name}</strong>
              {b.description && <span style={{ color: '#666', marginLeft: 8 }}>{b.description}</span>}
            </div>
            <button onClick={() => deleteBot(b.id)} style={{ color: 'red', background: 'none', border: 'none', cursor: 'pointer' }}>Удалить</button>
          </div>
        ))}
        <form onSubmit={addBot} style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <input placeholder="Название бота" value={newBot.name} onChange={e => setNewBot({ ...newBot, name: e.target.value })} required style={{ padding: 6 }} />
          <input placeholder="Описание" value={newBot.description} onChange={e => setNewBot({ ...newBot, description: e.target.value })} style={{ padding: 6 }} />
          <button type="submit" style={{ padding: '6px 12px' }}>Добавить</button>
        </form>
      </section>

      <section>
        <h2>Участники</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #ddd', textAlign: 'left' }}>
              <th style={{ padding: 8 }}>Имя</th>
              <th style={{ padding: 8 }}>Email</th>
              <th style={{ padding: 8 }}>Роль в проекте</th>
              <th style={{ padding: 8 }}>Действия</th>
            </tr>
          </thead>
          <tbody>
            {members.map(m => (
              <tr key={m.id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: 8 }}>{m.name}</td>
                <td style={{ padding: 8 }}>{m.email}</td>
                <td style={{ padding: 8 }}>{m.role_in_project === 'tester' ? 'Тестировщик' : 'Скриптолог'}</td>
                <td style={{ padding: 8 }}>
                  <button onClick={() => removeMember(m.id)} style={{ color: 'red', background: 'none', border: 'none', cursor: 'pointer' }}>Удалить</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <form onSubmit={addMember} style={{ display: 'flex', gap: 8 }}>
          <select value={newMember.user_id} onChange={e => setNewMember({ ...newMember, user_id: e.target.value })} required style={{ padding: 6 }}>
            <option value="">Выберите пользователя</option>
            {allUsers.map(u => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
          </select>
          <select value={newMember.role_in_project} onChange={e => setNewMember({ ...newMember, role_in_project: e.target.value })} style={{ padding: 6 }}>
            <option value="tester">Тестировщик</option>
            <option value="developer">Скриптолог</option>
          </select>
          <button type="submit" style={{ padding: '6px 12px' }}>Добавить</button>
        </form>
      </section>
    </div>
  );
}
