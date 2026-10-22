export { formatLakh } from '../../../shared/constants.js';

const ROLE_LABELS = {
  Batter: 'Batter',
  'WK-Batter': 'Wicketkeeper',
  'All-rounder': 'All-rounder',
  Bowler: 'Bowler',
};

export function roleLabel(role) {
  return ROLE_LABELS[role] ?? role;
}

export function nationalityLabel(overseas) {
  return overseas ? 'Overseas' : 'Indian';
}

export function initials(name) {
  return String(name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

export function formatNumber(value, digits = 1) {
  if (value == null || Number.isNaN(value)) return '0';
  return Number(value).toFixed(digits).replace(/\.0+$/, '');
}

export function formatSeed(seed) {
  return seed == null ? '' : String(seed);
}

export function pluralize(count, singular, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}
