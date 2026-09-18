import { useEffect } from 'react';

const BASE_TITLE = 'Тестирование ботов';

export function usePageTitle(...parts) {
  const key = parts.map(part => (part == null ? '' : String(part))).join('·');
  useEffect(() => {
    document.title = key ? `${key.split('·').filter(Boolean).join(' · ')} · ${BASE_TITLE}` : BASE_TITLE;
  }, [key]);
}