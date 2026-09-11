const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  і: 'i', ї: 'yi', є: 'ye', ґ: 'g', ў: 'u'
};

export function slugify(text) {
  const base = String(text || '')
    .trim()
    .toLowerCase()
    .split('')
    .map(ch => (ch in TRANSLIT ? TRANSLIT[ch] : ch))
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  return base || 'project';
}

export function makeUniqueSlug(db, base, excludeId = null) {
  let slug = base;
  let counter = 2;

  while (true) {
    const result = excludeId
      ? db.exec('SELECT id FROM projects WHERE slug = ? AND id != ?', [slug, excludeId])
      : db.exec('SELECT id FROM projects WHERE slug = ?', [slug]);

    if (result.length === 0 || result[0].values.length === 0) {
      return slug;
    }

    slug = `${base}-${counter}`;
    counter += 1;
  }
}
