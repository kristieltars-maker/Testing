export const STATUS_LABELS = {
  new: 'Новое',
  in_progress: 'В работе',
  clarification: 'На уточнении',
  waiting: 'В ожидании',
  done: 'Выполнено',
  cancelled: 'Отменено',
  rejected: 'Не принято',
  reopened: 'Вернули в работу'
};

export const STATUS_COLORS = {
  new: '#3498db',
  in_progress: '#16a085',
  clarification: '#e84393',
  waiting: '#f39c12',
  done: '#27ae60',
  cancelled: '#95a5a6',
  rejected: '#e74c3c',
  reopened: '#9b59b6'
};

// Семантические токены темы (status-success / warning / danger / info),
// которые использую все новые экраны (список замечаний, карточки, кнопки смены статуса).
export const STATUS_TOKEN = {
  new: 'info',
  in_progress: 'info',
  clarification: 'warning',
  waiting: 'warning',
  done: 'success',
  cancelled: 'neutral',
  rejected: 'danger',
  reopened: 'warning'
};

const TOKEN_BADGE_CLASSES = {
  success: 'border-status-success/20 bg-status-success/10 text-status-success',
  warning: 'border-status-warning/20 bg-status-warning/10 text-status-warning',
  danger: 'border-status-danger/20 bg-status-danger/10 text-status-danger',
  info: 'border-status-info/20 bg-status-info/10 text-status-info',
  neutral: 'bg-muted text-muted-foreground'
};

const TOKEN_PILL_CLASSES = {
  success: 'border-status-success/30 bg-status-success/10 text-status-success hover:bg-status-success/20 hover:border-status-success/40',
  warning: 'border-status-warning/30 bg-status-warning/10 text-status-warning hover:bg-status-warning/20 hover:border-status-warning/40',
  danger: 'border-status-danger/30 bg-status-danger/10 text-status-danger hover:bg-status-danger/20 hover:border-status-danger/40',
  info: 'border-status-info/30 bg-status-info/10 text-status-info hover:bg-status-info/20 hover:border-status-info/40',
  neutral: 'bg-muted text-muted-foreground hover:bg-muted/70 hover:border-border'
};

export const STATUS_BADGE_CLASS = statusId =>
  TOKEN_BADGE_CLASSES[STATUS_TOKEN[statusId]] || TOKEN_BADGE_CLASSES.neutral;

export const STATUS_PILL_BUTTON_CLASS = statusId =>
  TOKEN_PILL_CLASSES[STATUS_TOKEN[statusId]] || TOKEN_PILL_CLASSES.neutral;

export const STATUS_DESCRIPTIONS = {
  new: 'Выставляется автоматически. Означает, что замечание создано и скриптолог ещё не взял его в работу.',
  in_progress: 'Замечание взято в работу скриптологом. Выставляется автоматически: при первом входе ответственного скриптолога в задачу и после ответа тестировщика в тикете со статусом «На уточнении». Также выставляется вручную, когда скриптолог получил ответ от Заказчика и продолжает работу.',
  clarification: 'Выставляется вручную скриптологом, когда он задал вопрос тестировщику и ждёт ответа в тикете. После ответа тестировщика замечание автоматически вернётся в статус «В работе».',
  waiting: 'Выставляется вручную скриптологом, когда он задал вопрос Заказчику и ждёт ответа, после которого сможет продолжить работу над замечанием.',
  done: 'Выставляется вручную скриптологом или тестировщиком, когда замечание устранено.',
  cancelled: 'Выставляется вручную тестировщиком, когда он отменил своё замечание.',
  rejected: 'Выставляется скриптологом, когда он не согласен устранять замечание, считает работу корректной, а замечание тестировщика — ошибочным.',
  reopened: 'Выставляется тестировщиком, когда он считает, что замечание не отработано. Доступно только тестировщику.'
};

export const STATUS_ORDER = ['new', 'in_progress', 'clarification', 'waiting', 'done', 'cancelled', 'rejected', 'reopened'];
