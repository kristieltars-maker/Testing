// Мини-форматтер сообщений (без внешних зависимостей).
// Поддерживает: **жирный**, *курсив*, _подчёркнутый_, ~~зачёркнутый~~, [текст](https://url).
// Сначала экранируем HTML, затем подставляем только разрешённые теги — это исключает XSS.

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderFormatted(text) {
  let s = escapeHtml(text);

  // Ссылки [текст](http(s)://...)
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_m, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`
  );

  // Жирный **...**
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Зачёркнутый ~~...~~
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  // Подчёркнутый _..._
  s = s.replace(/_([^_]+)_/g, '<u>$1</u>');
  // Курсив *...*
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  return s;
}
