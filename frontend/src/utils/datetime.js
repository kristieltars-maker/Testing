// SQLite хранит время через datetime('now') в UTC в формате "YYYY-MM-DD HH:MM:SS".
// Приводим его к ISO с суффиксом Z, чтобы браузер корректно перевёл в локальное время.
export function parseUtc(value) {
  if (!value) return null;
  let s = String(value).trim();
  if (s.includes('T')) {
    // уже ISO
  } else {
    s = s.replace(' ', 'T');
  }
  const hasZone = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(s);
  if (!hasZone) s += 'Z';
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export function formatDateTime(value) {
  const d = parseUtc(value);
  return d ? d.toLocaleString('ru-RU') : '';
}

export function formatDate(value) {
  const d = parseUtc(value);
  return d ? d.toLocaleDateString('ru-RU') : '';
}

export function formatTime(value) {
  const d = parseUtc(value);
  return d ? d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
}
