export const STATUS_LABELS = {
  new: 'Новое',
  waiting: 'В ожидании',
  done: 'Выполнено',
  cancelled: 'Отменено',
  rejected: 'Не принято',
  reopened: 'Вернули в работу'
};

export const STATUS_COLORS = {
  new: '#3498db',
  waiting: '#f39c12',
  done: '#27ae60',
  cancelled: '#95a5a6',
  rejected: '#e74c3c',
  reopened: '#9b59b6'
};

export const STATUS_DESCRIPTIONS = {
  new: 'Замечание только создано',
  waiting: 'Ожидается ответ от Заказчика/Twin',
  done: 'Замечание устранено',
  cancelled: 'Замечание не актуально',
  rejected: 'Замечание некорректно',
  reopened: 'Замечание нужно проработать снова'
};

export const STATUS_ORDER = ['new', 'waiting', 'done', 'cancelled', 'rejected', 'reopened'];
