export function cleanName(raw) {
  return String(raw ?? '')
    .replace(/^\(sub\)\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeKey(name) {
  return cleanName(name)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function slugify(name) {
  return cleanName(name)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function splitFielders(raw) {
  return String(raw ?? '')
    .split('/')
    .map((name) => cleanName(name))
    .filter(Boolean);
}
