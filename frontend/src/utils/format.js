// Мини-форматтер сообщений (без внешних зависимостей).
// Поддерживает: **жирный**, *курсив*, _подчёркнутый_, ~~зачёркнутый~~, [текст](https://url),
// а также автоматически делает ссылками «голые» URL.
// Сначала экранируем HTML, затем подставляем только разрешённые теги — это исключает XSS.

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function link(url, label) {
  return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
}

export function renderFormatted(text) {
  let s = escapeHtml(text);

  // Ссылки [текст](http(s)://...) — допускаем пробелы перед закрывающей скобкой
  s = s.replace(
    /\[([^\]]+)\]\(\s*(https?:\/\/[^\s)]+?)\s*\)/g,
    (_m, label, url) => link(url, label)
  );

  // Жирный **...**
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  // Зачёркнутый ~~...~~
  s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  // Подчёркнутый _..._
  s = s.replace(/_([^_\n]+)_/g, '<u>$1</u>');
  // Курсив *...*
  s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');

  // «Голые» URL (не трогаем те, что уже внутри href="...")
  s = s.replace(
    /(^|[\s(])(https?:\/\/[^\s<)]+)/g,
    (_m, pre, url) => `${pre}${link(url, url)}`
  );

  return s;
}
