import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { usePageTitle } from '../utils/pageTitle.js';
import { PROJECT_ROLE_LABELS, PROJECT_ROLE_OPTIONS } from '../constants/projectRoles.js';
import PencilIcon from '../components/PencilIcon.jsx';
import TrashIcon from '../components/TrashIcon.jsx';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';

function MemberRoleSelect({ value, onChange }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-52">
        <SelectValue placeholder="Выберите роль" />
      </SelectTrigger>
      <SelectContent>
        {PROJECT_ROLE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export default function ProjectManagePage() {
  const { projectId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user.role === 'admin';
  const [project, setProject] = useState(null);
  usePageTitle(project?.name ? `${project.name} · Управление` : 'Управление проектом');
  const [projectForm, setProjectForm] = useState({ name: '', client_name: '', platform: '', manager_id: '' });
  const [members, setMembers] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addingMember, setAddingMember] = useState(false);
  const [newMember, setNewMember] = useState({ user_id: '', role_in_project: 'tester' });
  const [error, setError] = useState('');

  const load = () => {
    Promise.all([
      api.getProject(projectId),
      api.getProjectUsers(projectId)
    ])
      .then(([proj, users]) => {
        setProject(proj.project);
        setProjectForm({
          name: proj.project.name,
          client_name: proj.project.client_name,
          platform: proj.project.platform,
          manager_id: proj.project.manager_id || ''
        });
        setMembers(proj.members);
        setAllUsers(users.users || []);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [projectId]);

  const memberIds = new Set(members.map(m => m.id));
  const availableUsers = allUsers.filter(u => !memberIds.has(u.id));

  const updateProject = async () => {
    setError('');
    try {
      const payload = { ...projectForm };
      if (!isAdmin) delete payload.manager_id;
      const res = await api.updateProject(projectId, payload);
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

  const addMember = async (e) => {
    e.preventDefault();
    if (!newMember.user_id) return;
    try {
      await api.addMember(projectId, newMember);
      setNewMember({ user_id: '', role_in_project: 'tester' });
      setAddingMember(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const removeMember = async (member) => {
    if (!confirm(`Убрать «${member.name}» из проекта?`)) return;
    try {
      await api.removeMember(projectId, member.id);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) return <div className="px-4 py-12 text-center text-muted-foreground">Загрузка...</div>;
  if (!project) return <div className="px-4 py-12 text-center text-muted-foreground">Проект не найден</div>;

  const myMembershipRole = members.find(m => m.id === user.id)?.role_in_project;
  const canManageProject =
    isAdmin ||
    myMembershipRole === 'manager' ||
    project.manager_id === user.id;

  return (
    <div className="page users-page">
      <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">← Проекты</Link>

      <div className="page-header mt-4">
        <div className="min-w-0">
          <h1 className="text-h1 break-words">Управление: {project.name}</h1>
          <div className="muted">Данные проекта и участники</div>
        </div>
        {isAdmin && (
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={deleteProject}
          >
            Удалить проект
          </Button>
        )}
      </div>

      <Card className="mt-5">
        <CardHeader className="flex-row items-center justify-between space-y-0 border-b p-4 pb-3">
          <CardTitle className="text-h3">Данные проекта</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          {error && <div className="mb-3 text-sm text-destructive">{error}</div>}
          <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:flex-nowrap">
            <Input
              placeholder="Название"
              value={projectForm.name}
              onChange={e => setProjectForm({ ...projectForm, name: e.target.value })}
              required
              className="xl:w-72"
            />
            <Input
              placeholder="Заказчик"
              value={projectForm.client_name}
              onChange={e => setProjectForm({ ...projectForm, client_name: e.target.value })}
              required
              className="xl:w-72"
            />
            <Input
              placeholder="Платформа"
              value={projectForm.platform}
              onChange={e => setProjectForm({ ...projectForm, platform: e.target.value })}
              className="xl:w-56"
            />
            <div className="flex gap-2 xl:ml-auto xl:flex-none">
              <Button type="button" size="sm" onClick={updateProject}>Сохранить</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {canManageProject && (
        <Card className="mt-5 overflow-hidden shadow-sm">
          <CardHeader className="flex-row items-center justify-between space-y-0 border-b p-4">
            <CardTitle className="flex items-center gap-2 text-h3">
              Участники
              <Badge variant="secondary" className="whitespace-nowrap px-2">{members.length}</Badge>
            </CardTitle>
            {!addingMember && (
              <button
                type="button"
                className="rounded-md bg-transparent p-1.5 text-foreground transition-colors hover:bg-accent hover:text-primary"
                title="Добавить участника"
                aria-label="Добавить участника"
                onClick={() => { setAddingMember(true); setNewMember({ user_id: '', role_in_project: 'tester' }); }}
              >
                <PencilIcon />
              </button>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-64 px-4">Имя</TableHead>
                  <TableHead className="w-72 px-4">Email</TableHead>
                  <TableHead className="w-56 px-4">Роль в проекте</TableHead>
                  <TableHead className="w-24 px-4 text-right">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {addingMember && (
                  <TableRow className="bg-accent/40">
                    <TableCell colSpan={4} className="px-4 py-3">
                      <form onSubmit={addMember} className="flex flex-col gap-2 xl:flex-row xl:items-center xl:flex-nowrap">
                        <Select
                          value={newMember.user_id}
                          onValueChange={v => setNewMember({ ...newMember, user_id: v })}
                        >
                          <SelectTrigger className="xl:w-72">
                            <SelectValue placeholder="Выберите пользователя" />
                          </SelectTrigger>
                          <SelectContent>
                            {availableUsers.map(u => (
                              <SelectItem key={u.id} value={String(u.id)}>
                                {u.name} ({u.email})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <MemberRoleSelect
                          value={newMember.role_in_project}
                          onChange={role => setNewMember({ ...newMember, role_in_project: role })}
                        />
                        <div className="flex gap-2 xl:ml-auto xl:flex-none">
                          <Button type="submit" size="sm" disabled={!newMember.user_id}>Добавить</Button>
                          <Button type="button" variant="ghost" size="sm" onClick={() => setAddingMember(false)}>Отмена</Button>
                        </div>
                      </form>
                    </TableCell>
                  </TableRow>
                )}
                {members.map(m => (
                  <TableRow key={m.id}>
                    <TableCell className="whitespace-nowrap px-4 font-medium text-foreground">{m.name}</TableCell>
                    <TableCell className="px-4 text-muted-foreground">{m.email}</TableCell>
                    <TableCell className="whitespace-nowrap px-4">
                      <Badge variant="outline" className="whitespace-nowrap px-2">
                        {PROJECT_ROLE_LABELS[m.role_in_project] || m.role_in_project}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-4 text-right">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8 bg-transparent text-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30"
                        title="Убрать из проекта"
                        aria-label={`Убрать из проекта ${m.name}`}
                        onClick={() => removeMember(m)}
                      >
                        <TrashIcon />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {members.length === 0 && !addingMember && (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                Участников пока нет
              </div>
            )}
            {addingMember && availableUsers.length === 0 && !newMember.user_id && (
              <div className="px-4 pb-4 text-xs text-muted-foreground">Все активные пользователи уже добавлены в проект</div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}