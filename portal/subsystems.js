export const subsystems = [
  {
    id: 'testing',
    title: 'Тестирование ботов',
    description:
      'Проекты и замечания: тестировщик фиксирует баги, скриптолог их разбирает. ' +
      'Лента сообщений, вложения и статусы.',
    url: 'https://testing.bot-atelier.ru/',
    badge: null,
    icon: `
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M9 4h6a1 1 0 0 1 1 1v1h2a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h2V5a1 1 0 0 1 1-1z"></path>
        <path d="M9 13l2 2 4-4"></path>
      </svg>`,
  },
  {
    id: 'correction-audio',
    title: 'Корректор аудио-файлов',
    description:
      'Разовое акустическое выравнивание записей по эталону. Загрузите эталон ' +
      'и цели — скачайте исправленные файлы. Данные не сохраняются: живут ' +
      'только во время визита.',
    url: 'https://correction-audio.bot-atelier.ru/',
    badge: null,
    icon: `
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M9 18V5l10-2v13"></path>
        <circle cx="6" cy="18" r="3"></circle>
        <circle cx="16" cy="16" r="3"></circle>
      </svg>`,
  },
];

function createCard(item) {
  const card = document.createElement('li');
  card.className = 'card subsystem-card';
  card.dataset.subsystemId = item.id;

  const icon = document.createElement('span');
  icon.className = 'subsystem-icon';
  icon.innerHTML = item.icon || '';
  card.appendChild(icon);

  const title = document.createElement('h3');
  title.className = 'subsystem-title';
  title.textContent = item.title;
  card.appendChild(title);

  if (item.badge) {
    const badge = document.createElement('span');
    badge.className = 'badge subsystem-badge';
    badge.textContent = item.badge;
    card.appendChild(badge);
  }

  const desc = document.createElement('p');
  desc.className = 'subsystem-desc';
  desc.textContent = item.description;
  card.appendChild(desc);

  const open = document.createElement('a');
  open.className = 'btn btn-primary btn-sm subsystem-open';
  open.href = item.url;
  open.textContent = 'Открыть →';
  card.appendChild(open);

  return card;
}

function render() {
  const list = document.getElementById('subsystems');
  const empty = document.getElementById('subsystems-empty');
  if (!list) return;

  list.textContent = '';
  subsystems.forEach((item) => list.appendChild(createCard(item)));

  if (empty) {
    empty.hidden = subsystems.length > 0;
  }
  list.hidden = subsystems.length === 0;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', render);
} else {
  render();
}
