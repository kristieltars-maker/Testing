import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { STATUS_LABELS, STATUS_DESCRIPTIONS, STATUS_ORDER } from '../constants/statuses.js';
import { formatDateTime } from '../utils/datetime.js';
import TrashIcon from '../components/TrashIcon.jsx';
import { usePageTitle } from '../utils/pageTitle.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';

const STATUS_TOKEN = {
  new: 'info',
  in_progress: 'info',
  clarification: 'warning',
  waiting: 'warning',
  done: 'success',
  cancelled: 'danger',
  rejected: 'danger',
  reopened: 'warning'
};

const STATUS_BADGE_CLASS = {
  success: 'whitespace-nowrap border-status-success/20 bg-status-success/10 px-2 text-status-success',
  warning: 'whitespace-nowrap border-status-warning/20 bg-status-warning/10 px-2 text-status-warning',
  danger: 'whitespace-nowrap border-status-danger/20 bg-status-danger/10 px-2 text-status-danger',
  info: 'whitespace-nowrap border-status-info/20 bg-status-info/10 px-2 text-status-info'
};

function MultiFilter({ label, options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const selectedCount = value.length;

  const toggle = (optionValue) => {
    onChange(value.includes(optionValue) ? value.filter(v => v !== optionValue) : [...value, optionValue]);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="w-full justify-between font-normal text-foreground sm:w-auto"
          aria-expanded={open}
        >
          <span>{label}</span>
          {selectedCount > 0 && (
            <Badge variant="secondary" className="min-w-5 justify-center px-2 text-primary">
              {selectedCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <div className="px-2 pb-2 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="max-h-64 overflow-y-auto">
          {options.map(option => {
            const checked = value.includes(option.value);
            return (
              <label
                key={option.value}
                className="flex min-h-9 cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-accent"
              >
                <Checkbox checked={checked} onCheckedChange={() => toggle(option.value)} />
                {option.statusToken ? (
                  <Badge
                    variant="outline"
                    className={`whitespace-nowrap ${STATUS_BADGE_CLASS[option.statusToken]}`}
                  >
                    {option.label}
                  </Badge>
                ) : (
                  <span className="truncate">{option.label}</span>
                )}
              </label>
            );
          })}
          {options.length === 0 && (
            <div className="px-2 py-3 text-sm text-muted-foreground">Нет доступных вариантов</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const EMPTY_FILTERS = { status: [], bot_id: [], created_by: [], assigned_to: [] };
const DEFAULT_SORT = { by: 'updated_at', order: 'desc' };
const FILTERS_STORAGE_PREFIX = 'issuesFilters:';

const COLUMNS = [
  { id: 'local_number', label: '#' },
  { id: 'description', label: 'Описание' },
  { id: 'status', label: 'Статус' },
  { id: 'creator', label: 'Автор' },
  { id: 'assignee', label: 'Ответственный' },
  { id: 'updated_at', label: 'Обновлено' },
  { id: 'actions', label: null }
];

const DEFAULT_COLUMN_WIDTHS = {
  local_number: 0.06,
  description: 0.32,
  status: 0.14,
  creator: 0.16,
  assignee: 0.17,
  updated_at: 0.11,
  actions: 0.04
};
const COLUMN_MIN_WIDTH = 0.04;

function readColumnWidths(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const widths = {};
  let sum = 0;
  for (const column of COLUMNS) {
    const value = Number(raw[column.id]);
    if (!Number.isFinite(value) || value < COLUMN_MIN_WIDTH || value > 0.7) return null;
    widths[column.id] = value;
    sum += value;
  }
  if (sum < 0.95 || sum > 1.05) return null;
  for (const column of COLUMNS) {
    widths[column.id] = widths[column.id] / sum;
  }
  return widths;
}

function readSavedIssuesState(projectId) {
  try {
    const raw = sessionStorage.getItem(FILTERS_STORAGE_PREFIX + projectId);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== 'object') return null;
    if (!saved.filters || typeof saved.filters !== 'object') return null;
    for (const key of Object.keys(EMPTY_FILTERS)) {
      if (!Array.isArray(saved.filters[key])) return null;
    }
    if (!saved.sort || !saved.sort.by || !saved.sort.order) return null;
    const state = {
      filters: saved.filters,
      sort: saved.sort,
      searchInput: typeof saved.searchInput === 'string' ? saved.searchInput : ''
    };
    const widths = readColumnWidths(saved.colWidths);
    if (widths) state.colWidths = widths;
    return state;
  } catch {
    return null;
  }
}

function writeSavedIssuesState(projectId, state) {
  try {
    sessionStorage.setItem(FILTERS_STORAGE_PREFIX + projectId, JSON.stringify(state));
  } catch {
    // sessionStorage недоступен — состояние просто не сохранится
  }
}

export default function IssuesPage() {
  const { projectId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  usePageTitle(project?.name);
  const [issues, setIssues] = useState([]);
  const [bots, setBots] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const saved = useMemo(() => readSavedIssuesState(projectId), [projectId]);
  const [filters, setFilters] = useState(saved?.filters || EMPTY_FILTERS);
  const [sort, setSort] = useState(saved?.sort || DEFAULT_SORT);
  const [searchInput, setSearchInput] = useState(saved?.searchInput ?? '');
  const [search, setSearch] = useState(saved?.searchInput ?? '');
  const [colWidths, setColWidths] = useState(saved?.colWidths || DEFAULT_COLUMN_WIDTHS);
  const tableRef = useRef(null);

  useEffect(() => {
    writeSavedIssuesState(projectId, { filters, sort, searchInput, colWidths });
  }, [projectId, filters, sort, searchInput, colWidths]);

  const startColumnResize = (event, id) => {
    const index = COLUMNS.findIndex(column => column.id === id);
    const nextColumn = COLUMNS[index + 1];
    if (!nextColumn) return;
    event.preventDefault();
    event.stopPropagation();
    const table = tableRef.current;
    if (!table) return;
    const headerRow = table.tHead?.rows[0];
    if (!headerRow) return;

    const leftCell = headerRow.cells[index];
    const rightCell = headerRow.cells[index + 1];
    const tableWidth = table.offsetWidth || 1;
    const startX = event.clientX;
    const startLeft = leftCell.offsetWidth * 100 / tableWidth;
    const startRight = rightCell.offsetWidth * 100 / tableWidth;
    const pairTotal = startLeft + startRight;
    const minPercent = COLUMN_MIN_WIDTH * 100;

    const apply = (leftPercent) => {
      const rightPercent = pairTotal - leftPercent;
      leftCell.style.width = `${leftPercent}%`;
      rightCell.style.width = `${rightPercent}%`;
    };

    const onMove = (moveEvent) => {
      const delta = (moveEvent.clientX - startX) * 100 / tableWidth;
      apply(Math.min(
        Math.max(startLeft + delta, minPercent),
        pairTotal - minPercent
      ));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      const leftPercent = leftCell.offsetWidth * 100 / (table.offsetWidth || 1);
      const rightPercent = pairTotal - leftPercent;
      setColWidths(prev => ({
        ...prev,
        [id]: leftPercent / 100,
        [nextColumn.id]: rightPercent / 100
      }));
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const load = () => {
    const query = Object.fromEntries(
      Object.entries(filters)
        .map(([key, values]) => [key, values.join(',')])
        .filter(([, value]) => value)
    );
    Promise.all([
      api.getProject(projectId),
      api.getIssues({
        project_id: projectId,
        sort_by: sort.by,
        sort_order: sort.order,
        ...(search ? { search } : {}),
        ...query
      })
    ]).then(([proj, iss]) => {
      setProject(proj.project);
      setBots(proj.bots);
      setMembers(proj.members);
      setIssues(iss.issues);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [projectId, filters, sort, search]);

  const handleSort = (by) => {
    setSort(prev => {
      if (prev.by === by) {
        return { by, order: prev.order === 'asc' ? 'desc' : 'asc' };
      }
      const defaultOrder = (by === 'updated_at' || by === 'created_at') ? 'desc' : 'asc';
      return { by, order: defaultOrder };
    });
  };

  const SortableHeader = ({ by, children }) => (
    <TableHead
      className="relative cursor-pointer select-none overflow-hidden text-ellipsis whitespace-nowrap px-4 text-xs uppercase tracking-wide transition-colors hover:text-foreground"
      style={{ width: `${colWidths[by] * 100}%` }}
      onClick={() => handleSort(by)}
      title="Сортировать"
      aria-sort={sort.by === by ? (sort.order === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      {children}
      <span className={`ml-2 ${sort.by === by ? 'text-primary' : 'text-muted-foreground/40'}`}>
        {sort.by === by ? (sort.order === 'asc' ? '▲' : '▼') : '↕'}
      </span>
      <ResizeHandle id={by} />
    </TableHead>
  );

  const ResizeHandle = ({ id }) => (
    <span
      aria-hidden="true"
      className="absolute inset-y-0 right-0 z-10 w-2.5 cursor-col-resize select-none touch-none"
      onMouseDown={event => startColumnResize(event, id)}
      onClick={event => event.stopPropagation()}
      title="Изменить ширину столбца"
    />
  );

  const developers = members.filter(m => m.role_in_project === 'developer');
  const testers = members.filter(m => m.role_in_project === 'tester');
  const hasFilters = Object.values(filters).some(values => values.length > 0);

  const setFilter = (key) => (next) => setFilters(prev => ({ ...prev, [key]: next }));

  const openCreate = () => navigate(`/projects/${project.slug}/issues/new`);
  const resetFilters = () => {
    setFilters(EMPTY_FILTERS);
    setSearchInput('');
    setSearch('');
  };

  const handleDelete = async (e, issue) => {
    e.stopPropagation();
    if (!confirm(`Удалить замечание #${issue.local_number}? Действие необратимо.`)) return;
    try { await api.deleteIssue(issue.id); load(); } catch (err) { alert(err.message); }
  };

  if (loading) return <div className="px-4 py-12 text-center text-muted-foreground">Загрузка...</div>;
  if (!project) return <div className="px-4 py-12 text-center text-muted-foreground">Проект не найден</div>;

  const canCreate = user.role === 'admin' || members.some(m => m.id === user.id && ['tester', 'manager'].includes(m.role_in_project));
  const canManage = user.role === 'admin' || project.manager_id === user.id || members.some(m => m.id === user.id && m.role_in_project === 'manager');

  const statusOptions = STATUS_ORDER.map(k => ({
    value: k,
    label: STATUS_LABELS[k],
    statusToken: STATUS_TOKEN[k]
  }));
  const botOptions = bots.map(b => ({ value: String(b.id), label: b.name }));
  const testerOptions = testers.map(m => ({ value: String(m.id), label: m.name }));
  const developerOptions = developers.map(m => ({ value: String(m.id), label: m.name }));

  return (
    <div className="page issues-page">
      <Link
        to="/"
        className="inline-flex text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        ← Проекты
      </Link>

      <div className="mt-4 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div className="min-w-0">
          <h1 className="text-h1 break-words">{project.name}</h1>
          <div className="mt-2 flex flex-col gap-1 text-sm text-muted-foreground">
            <div>Заказчик: <span className="text-foreground">{project.client_name}</span></div>
            {project.manager_name && (
              <div>Руководитель проекта: <span className="text-foreground">{project.manager_name}</span></div>
            )}
          </div>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          {canManage && (
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link to={`/projects/${project.slug}/manage`}>⚙ Управление проектом</Link>
            </Button>
          )}
          {canCreate && (
            <Button className="w-full sm:w-auto" onClick={openCreate}>+ Новое замечание</Button>
          )}
        </div>
      </div>

      <Card className="mt-6 shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <Input
              id="issues-search"
              type="text"
              placeholder="Поиск по описанию..."
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              className="w-full sm:w-64"
            />
            <MultiFilter label="Статус" options={statusOptions} value={filters.status} onChange={setFilter('status')} />
            {botOptions.length > 0 && (
              <MultiFilter label="Бот" options={botOptions} value={filters.bot_id} onChange={setFilter('bot_id')} />
            )}
            <MultiFilter label="Тестировщик" options={testerOptions} value={filters.created_by} onChange={setFilter('created_by')} />
            <MultiFilter label="Скриптолог" options={developerOptions} value={filters.assigned_to} onChange={setFilter('assigned_to')} />
            {(hasFilters || search) && (
              <Button variant="ghost" onClick={resetFilters}>Сбросить</Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="mt-4 overflow-hidden shadow-sm">
        <CardHeader className="flex-row items-center justify-between space-y-0 border-b p-4">
          <CardTitle className="text-h3">Замечания</CardTitle>
          <Badge variant="secondary" className="whitespace-nowrap px-2">{issues.length}</Badge>
        </CardHeader>
        <CardContent className="p-0">
          <Table ref={tableRef} className="table-fixed">
            <TableHeader>
              <TableRow>
                <SortableHeader by="local_number">#</SortableHeader>
                <SortableHeader by="description">Описание</SortableHeader>
                <SortableHeader by="status">Статус</SortableHeader>
                <SortableHeader by="creator">Автор</SortableHeader>
                <SortableHeader by="assignee">Ответственный</SortableHeader>
                <SortableHeader by="updated_at">Обновлено</SortableHeader>
                <TableHead
                  className="relative whitespace-nowrap px-2 text-center"
                  style={{ width: `${colWidths.actions * 100}%` }}
                  aria-label="Действия"
                />
              </TableRow>
            </TableHeader>
            <TableBody>
              {issues.map(issue => {
                const token = STATUS_TOKEN[issue.status];
                return (
                  <TableRow
                    key={issue.id}
                    className="group h-14 cursor-pointer"
                    onClick={() => navigate(`/projects/${project.slug}/issues/${issue.id}`)}
                  >
                    <TableCell className="overflow-hidden text-ellipsis whitespace-nowrap px-4 font-semibold text-foreground">#{issue.local_number}</TableCell>
                    <TableCell className="px-4">
                      <div className="truncate text-muted-foreground">{issue.first_message?.slice(0, 80) || '—'}</div>
                    </TableCell>
                    <TableCell className="overflow-hidden px-4">
                      <Badge
                        variant="outline"
                        className={token ? STATUS_BADGE_CLASS[token] : ''}
                        title={STATUS_DESCRIPTIONS[issue.status]}
                      >
                        {STATUS_LABELS[issue.status]}
                        {issue.reopened_count > 1 && (
                          <span className="ml-1">×{issue.reopened_count}</span>
                        )}
                      </Badge>
                    </TableCell>
                    <TableCell className="overflow-hidden text-ellipsis whitespace-nowrap px-4">{issue.creator_name}</TableCell>
                    <TableCell className="overflow-hidden text-ellipsis whitespace-nowrap px-4">{issue.assignee_name || '—'}</TableCell>
                    <TableCell className="overflow-hidden text-ellipsis whitespace-nowrap px-4 text-muted-foreground">{formatDateTime(issue.updated_at)}</TableCell>
                    <TableCell onClick={e => e.stopPropagation()} className="px-2 text-center">
                      {(user.role === 'admin' || issue.created_by === user.id) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:text-destructive md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
                          title="Удалить замечание"
                          aria-label={`Удалить замечание #${issue.local_number}`}
                          onClick={e => handleDelete(e, issue)}
                        >
                          <TrashIcon />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {issues.length === 0 && (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              {(hasFilters || search) ? 'Замечаний по выбранным фильтрам нет' : 'Замечаний пока нет'}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
