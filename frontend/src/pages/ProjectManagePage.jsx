import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';

const PROJECT_ROLE_LABELS = {
  tester: 'Тестировщик',
  developer: 'Скриптолог',
  manager: 'Руководитель проекта'
};

export default function ProjectManagePage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [projectForm, setProjectForm] = useState({ name: '', client_name: '', platform: '', manager_id: '' });
  const [bots, setBots] = useState([]);
  const [members, setMembers] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newBot, setNewBot] = useState({ name: '', description: '' });
  const [editingBotId, setEditingBotId] = useState(null);
  const [botEdit, setBotEdit] = useState({ name: '', description: '' });
  const [newMember, setNewMember] = useState({ user_id: '', role_in_project: 'tester' });
  const [error, setError] = useState('');

  const load = () => {
    Promise.all([api.getProject(projectId), api.getUsers()])
      .then(([proj, users]) => {
        setProject(proj.project);
        setProjectForm({
          name: proj.project.name,
          client_name: proj.project.client_name,
          platform: proj.project.platform,
          manager_id: proj.project.manager_id || ''
        });
        setBots(proj.bots);
        setMembers(proj.members);
        setAllUsers(users.users.filter(u => u.is_active));
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [projectId]);

  const saveProject = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const res = await api.updateProject(projectId, projectForm);
      alert('Проект сохранён');
      if (res.project.slug && res.project.slug !== projectId) {
        navigate(`/projects/${res.project.slug}/manage`, { replace: true });
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const deleteProject = async () => {
    if (!confirm(`Удалить проект «${project.name}» со всеми замечаниями? Действие необратимо.`)) return;
    try {
      await api.deleteProject(projectId);
      navigate('/');
    } catch (err) {
      alert(err.message);
    }
  };

  const addBot = async (e) => {
    e.preventDefault();
    await api.addBot(projectId, newBot);
    setNewBot({ name: '', description: '' });
    load();
  };

  const startBotEdit = (bot) => {
    setEditingBotId(bot.id);
    setBotEdit({ name: bot.name, description: bot.description || '' });
  };

  const saveBot = async (e) => {
    e.preventDefault();
    await api.updateBot(projectId, editingBotId, botEdit);
    setEditingBotId(null);
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Управление: {project.name}</h1>
        <button onClick={deleteProject} style={{ padding: '8px 16px', background: '#c0392b' }}>Удалить проект</button>
      </div>

      <section style={{ marginBottom: 30, padding: 15, border: '1px solid #eee', borderRadius: 8 }}>
        <h2>Данные проекта</h2>
        {error && <div style={{ color: 'red', marginBottom: 8 }}>{error}</div>}
        <form onSubmit={saveProject} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input placeholder="Название" value={projectForm.name} onChange={e => setProjectForm({ ...projectForm, name: e.target.value })} required style={{ padding: 6, flex: 1, minWidth: 160 }} />
          <input placeholder="Заказчик" value={projectForm.client_name} onChange={e => setProjectForm({ ...projectForm, client_name: e.target.value })} required style={{ padding: 6, flex: 1, minWidth: 160 }} />
          <input placeholder="Платформа" value={projectForm.platform} onChange={e => setProjectForm({ ...projectForm, platform: e.target.value })} style={{ padding: 6, minWidth: 120 }} />
          <button type="submit" style={{ padding: '6px 16px' }}>Сохранить</button>
        </form>
      </section>

      <section style={{ marginBottom: 30 }}>
        <h2>Боты</h2>
        {bots.map(b => (
          editingBotId === b.id ? (
            <form key={b.id} onSubmit={saveBot} style={{ display: 'flex', gap: 8, padding: '8px 0', borderBottom: '1px solid #eee' }}>
              <input value={botEdit.name} onChange={e => setBotEdit({ ...botEdit, name: e.target.value })} required style={{ padding: 6, flex: 1 }} />
              <input value={botEdit.description} onChange={e => setBotEdit({ ...botEdit, description: e.target.value })} placeholder="Описание" style={{ padding: 6, flex: 1 }} />
              <button type="submit" style={{ padding: '4px 12px' }}>Сохранить</button>
              <button type="button" onClick={() => setEditingBotId(null)} style={{ padding: '4px 12px', background: '#95a5a6' }}>Отмена</button>
            </form>
          ) : (
            <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #eee' }}>
              <div>
                <strong>{b.name}</strong>
                {b.description && <span style={{ color: '#666', marginLeft: 8 }}>{b.description}</span>}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => startBotEdit(b)} style={{ padding: '4px 10px', fontSize: 13 }}>Изменить</button>
                <button onClick={() => deleteBot(b.id)} style={{ padding: '4px 10px', fontSize: 13, background: '#c0392b' }}>Удалить</button>
              </div>
            </div>
          )
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
                <td style={{ padding: 8 }}>{PROJECT_ROLE_LABELS[m.role_in_project] || m.role_in_project}</td>
                <td style={{ padding: 8 }}>
                  <button onClick={() => removeMember(m.id)} style={{ padding: '4px 10px', fontSize: 13, background: '#c0392b' }}>Убрать</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <form onSubmit={addMember} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select value={newMember.user_id} onChange={e => setNewMember({ ...newMember, user_id: e.target.value })} required style={{ padding: 6 }}>
            <option value="">Выберите пользователя</option>
            {allUsers.map(u => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
          </select>
          <select value={newMember.role_in_project} onChange={e => setNewMember({ ...newMember, role_in_project: e.target.value })} style={{ padding: 6 }}>
            <option value="tester">Тестировщик</option>
            <option value="developer">Скриптолог</option>
            <option value="manager">Руководитель проекта</option>
          </select>
          <button type="submit" style={{ padding: '6px 12px' }}>Добавить</button>
        </form>
      </section>
    </div>
  );
}
