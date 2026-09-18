import { useState, useEffect, useRef } from 'react';
import { api } from '../api/client.js';
import { ROLE_LABELS, ROLE_OPTIONS } from '../constants/roles.js';
import TrashIcon from '../components/TrashIcon.jsx';
import PencilIcon from '../components/PencilIcon.jsx';
import { usePageTitle } from '../utils/pageTitle.js';
import { generateStrongPassword } from '../utils/password.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { PROJECT_ROLE_OPTIONS } from '../constants/projectRoles.js';

function PasswordInput({ value, onChange, placeholder, required, visible, onToggle, onGenerate }) {
  return (
    <span className="flex min-w-0 items-start gap-2">
      <span className="relative flex min-w-0 flex-1">
        <Input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          required={required}
          className="pr-10"
          autoComplete="new-password"
        />
        <button
          type="button"
          onClick={onToggle}
          title={visible ? 'Скрыть пароль' : 'Показать пароль'}
          aria-label={visible ? 'Скрыть пароль' : 'Показать пароль'}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md bg-transparent p-1.5 text-foreground transition-colors hover:bg-accent"
        >
          {visible ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </span>
      {typeof onGenerate === 'function' && (
        <Button type="button" variant="outline" size="sm" className="mt-0 shrink-0" onClick={onGenerate} title="Сгенерировать сложный пароль">
          ⚡ Сгенерировать
        </Button>
      )}
    </span>
  );
}

const EMPTY_ROLE = '__none__';

function GlobalRoleSelect({ value, onChange }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-48">
        <SelectValue placeholder="Выберите роль" />
      </SelectTrigger>
      <SelectContent>
        {ROLE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function MembershipRoleSelect({ value, onChange }) {
  return (
    <Select
      value={value || EMPTY_ROLE}
      onValueChange={next => onChange(next === EMPTY_ROLE ? '' : next)}
    >
      <SelectTrigger className="w-44">
        <SelectValue placeholder="Не участвует" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={EMPTY_ROLE}>Не участвует</SelectItem>
        {PROJECT_ROLE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}


export default function UsersPage() {
  usePageTitle('Пользователи');
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'tester' });
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', email: '', role: 'tester', password: '' });
  const [editError, setEditError] = useState('');
  const [showCreatePass, setShowCreatePass] = useState(false);
  const [showEditPass, setShowEditPass] = useState(false);

  const [projectsForUserId, setProjectsForUserId] = useState(null);
  const [pickerProjects, setPickerProjects] = useState([]);
  const [pickerRoles, setPickerRoles] = useState({});
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState(null);
  const [pickerSaving, setPickerSaving] = useState(false);
  const pickerRolesRef = useRef({});

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

  const handleDeleteUser = async (user) => {
    if (!confirm(`Удалить пользователя «${user.name}»? Действие необратимо.`)) return;
    try {
      await api.deleteUser(user.id);
      load();
    } catch (err) {
      alert(err.message);
    }
  };

  const openProjectsPicker = async (user) => {
    setProjectsForUserId(user.id);
    setPickerLoading(true);
    setPickerError(null);
    try {
      const [proj, mem] = await Promise.all([
        api.getProjects(),
        api.getUserMemberships(user.id)
      ]);
      setPickerProjects(proj.projects);
      const roles = {};
      for (const m of mem.memberships) {
        roles[m.project_id] = m.role_in_project;
      }
      pickerRolesRef.current = roles;
      setPickerRoles(roles);
    } catch (err) {
      setPickerError(err.message);
    } finally {
      setPickerLoading(false);
    }
  };

  const changeProjectRole = async (user, projectId, role) => {
    const next = { ...pickerRolesRef.current };
    if (role) next[projectId] = role;
    else delete next[projectId];
    pickerRolesRef.current = next;
    setPickerRoles(next);
    const memberships = Object.entries(next)
      .filter(([, roleIn]) => roleIn)
      .map(([pid, roleIn]) => ({ project_id: Number(pid), role_in_project: roleIn }));
    setPickerSaving(true);
    try {
      await api.setUserMemberships(user.id, memberships);
      load();
    } catch (err) {
      setPickerError(err.message);
    } finally {
      setPickerSaving(false);
    }
  };

  if (loading) return <div className="px-4 py-12 text-center text-muted-foreground">Загрузка...</div>;

  const currentPickerProjects = projectsForUserId ? pickerProjects : null;

  return (
    <div className="page users-page">
      <div className="page-header">
        <div>
          <h1 className="text-h1">Пользователи</h1>
          <div className="muted">Учётные записи экосистемы: единый вход во все подсистемы</div>
        </div>
        <Button size="sm" onClick={() => setShowForm(!showForm)}>+ Добавить пользователя</Button>
      </div>

      {showForm && (
        <Card className="mt-5">
          <CardContent className="p-4">
            <form onSubmit={handleCreate}>
              {error && <div className="mb-3 text-sm text-destructive">{error}</div>}
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  placeholder="Имя"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  required
                />
                <Input
                  placeholder="Email"
                  type="email"
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                  required
                />
              </div>
              <div className="mt-3">
                <PasswordInput
                  placeholder="Пароль"
                  value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                  required
                  visible={showCreatePass}
                  onToggle={() => setShowCreatePass(!showCreatePass)}
                  onGenerate={() => {
                    setForm({ ...form, password: generateStrongPassword() });
                    setShowCreatePass(true);
                  }}
                />
              </div>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
                <GlobalRoleSelect value={form.role} onChange={role => setForm({ ...form, role })} />
                <div className="text-xs text-muted-foreground">
                  Роль по умолчанию. В каждом проекте роль задаётся отдельно (кнопка «Проекты»).
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <Button type="submit" size="sm">Создать</Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowForm(false)}>Отмена</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card className="mt-5 overflow-hidden shadow-sm">
        <CardHeader className="flex-row items-center justify-between space-y-0 border-b p-4">
          <CardTitle className="text-h3">Учётные записи</CardTitle>
          <Badge variant="secondary" className="whitespace-nowrap px-2">{users.length}</Badge>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-64 px-4">Имя</TableHead>
                <TableHead className="w-72 px-4">Email</TableHead>
                <TableHead className="w-56 px-4">Роль (по умолч.)</TableHead>
                <TableHead className="w-40 px-4">Статус</TableHead>
                <TableHead className="px-4">Проекты</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map(u => (
                editingId === u.id ? (
                  <TableRow key={u.id} className="bg-accent/40">
                    <TableCell colSpan={5} className="px-4 py-4">
                      <form onSubmit={handleEdit}>
                        {editError && <div className="mb-3 text-sm text-destructive">{editError}</div>}
                        <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:flex-nowrap">
                          <Input
                            placeholder="Имя"
                            value={editForm.name}
                            onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                            required
                            className="xl:w-56"
                          />
                          <Input
                            placeholder="Email"
                            type="email"
                            value={editForm.email}
                            onChange={e => setEditForm({ ...editForm, email: e.target.value })}
                            required
                            className="xl:w-64"
                          />
                          <GlobalRoleSelect value={editForm.role} onChange={role => setEditForm({ ...editForm, role })} />
                          <PasswordInput
                            placeholder="Новый пароль (опционально)"
                            value={editForm.password}
                            onChange={e => setEditForm({ ...editForm, password: e.target.value })}
                            visible={showEditPass}
                            onToggle={() => setShowEditPass(!showEditPass)}
                            onGenerate={() => {
                              setEditForm({ ...editForm, password: generateStrongPassword() });
                              setShowEditPass(true);
                            }}
                          />
                          <div className="flex gap-2 xl:ml-auto xl:flex-none">
                            <Button type="submit" size="sm">Сохранить</Button>
                            <Button type="button" variant="ghost" size="sm" onClick={() => setEditingId(null)}>Отмена</Button>
                          </div>
                        </div>
                      </form>
                    </TableCell>
                  </TableRow>
                ) : (
                  <TableRow key={u.id} className={projectsForUserId === u.id ? 'bg-accent/30' : undefined}>
                    <TableCell className="whitespace-nowrap px-4 font-medium text-foreground">{u.name}</TableCell>
                    <TableCell className="px-4 text-muted-foreground">{u.email}</TableCell>
                    <TableCell className="whitespace-nowrap px-4">{ROLE_LABELS[u.role]}</TableCell>
                    <TableCell className="whitespace-nowrap px-4">
                      <Badge
                        variant="outline"
                        className={u.is_active
                          ? 'whitespace-nowrap border-status-success/20 bg-status-success/10 px-2 text-status-success'
                          : 'whitespace-nowrap border-transparent bg-muted px-2 text-muted-foreground'}
                      >
                        {u.is_active ? 'Активен' : 'Деактивирован'}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-4">
                      <div className="flex items-start justify-between gap-4">
                        <Popover
                          open={projectsForUserId === u.id}
                          onOpenChange={open => (open ? openProjectsPicker(u) : setProjectsForUserId(null))}
                        >
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              className="flex max-w-xs cursor-pointer flex-col items-start bg-transparent text-left hover:bg-transparent"
                              title="Нажмите, чтобы изменить роли в проектах"
                            >
                              <span className="text-sm text-foreground">
                                {u.projects || '—'}
                              </span>
                              <span className="text-xs text-muted-foreground">изменить…</span>
                            </button>
                          </PopoverTrigger>
                          <PopoverContent align="end" className="max-h-96 w-80 overflow-y-auto">
                            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              Роли в проектах
                            </div>
                            {pickerError && (
                              <div className="mb-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{pickerError}</div>
                            )}
                            {pickerLoading ? (
                              <div className="py-6 text-center text-sm text-muted-foreground">Загрузка проектов…</div>
                            ) : (
                              <div className="flex flex-col gap-1">
                                {(projectsForUserId ? pickerProjects : []).map(p => (
                                  <div key={p.id} className="flex items-center justify-between gap-3 border-b py-2 last:border-b-0 hover:bg-accent/50">
                                    <span className="flex min-w-0 flex-col">
                                      <span className="truncate text-sm text-foreground">{p.name}</span>
                                      <span className="truncate text-xs text-muted-foreground">{p.client_name}</span>
                                    </span>
                                    <MembershipRoleSelect
                                      value={pickerRoles[p.id] || ''}
                                      onChange={role => changeProjectRole(u, p.id, role)}
                                    />
                                  </div>
                                ))}
                                {pickerProjects.length === 0 && (
                                  <div className="py-6 text-center text-sm text-muted-foreground">Проектов пока нет</div>
                                )}
                              </div>
                            )}
                            <div className="mt-3 flex items-center justify-between gap-2">
                              <span className="text-xs text-muted-foreground">
                                {pickerSaving ? 'Сохранение…' : 'Изменения сохраняются сразу'}
                              </span>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setProjectsForUserId(null)}
                              >
                                Готово
                              </Button>
                            </div>
                          </PopoverContent>
                        </Popover>
                        <div className="flex flex-none items-center gap-1">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8 bg-transparent text-foreground hover:bg-transparent hover:text-primary hover:border-primary/40"
                            title="Редактировать пользователя"
                            aria-label={`Редактировать пользователя ${u.name}`}
                            onClick={() => startEdit(u)}
                          >
                            <PencilIcon />
                          </Button>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8 bg-transparent text-foreground hover:bg-transparent hover:text-status-warning hover:border-status-warning/40"
                            title={u.is_active ? 'Деактивировать пользователя' : 'Активировать пользователя'}
                            aria-label={u.is_active ? `Деактивировать пользователя ${u.name}` : `Активировать пользователя ${u.name}`}
                            onClick={() => toggleActive(u)}
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'block' }}>
                              <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
                              <line x1="12" y1="2" x2="12" y2="12" />
                            </svg>
                          </Button>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8 bg-transparent text-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30"
                            title="Удалить пользователя"
                            aria-label={`Удалить пользователя ${u.name}`}
                            onClick={() => handleDeleteUser(u)}
                          >
                            <TrashIcon />
                          </Button>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              ))}
            </TableBody>
          </Table>
          {users.length === 0 && (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">Пользователей пока нет</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}