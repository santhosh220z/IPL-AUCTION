export const PURSE_LAKH = 12000;
export const MAX_SQUAD = 25;
export const MAX_OVERSEAS = 8;
export const MAX_TEAMS = 10;
export const MIN_PLAYERS_TO_START = 2;
export const DEFAULT_TIMER_SEC = 15;
export const TIMER_OPTIONS = [10, 15, 20];
export const HOST_TRANSFER_MS = 60_000;
export const ROOM_IDLE_MS = 2 * 60 * 60 * 1000;

export const CODE_LENGTH = 6;
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const ROLES = ['Batter', 'WK-Batter', 'All-rounder', 'Bowler'];

export const PALETTE = [
  { id: 'azure', name: 'Azure', hex: '#4f8cff' },
  { id: 'amber', name: 'Amber', hex: '#f5a524' },
  { id: 'emerald', name: 'Emerald', hex: '#2fbf71' },
  { id: 'crimson', name: 'Crimson', hex: '#ff5c6c' },
  { id: 'violet', name: 'Violet', hex: '#a78bfa' },
  { id: 'rose', name: 'Rose', hex: '#f472b6' },
  { id: 'gold', name: 'Gold', hex: '#eab308' },
  { id: 'teal', name: 'Teal', hex: '#2dd4bf' },
  { id: 'lime', name: 'Lime', hex: '#a3e635' },
  { id: 'cyan', name: 'Cyan', hex: '#22d3ee' },
];

export const COLOR_IDS = PALETTE.map((c) => c.id);

export const BID_RAISE_LAKH = [1, 25, 50, 100];

function trimNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
}

export function formatLakh(lakh) {
  if (lakh == null || Number.isNaN(lakh)) return '';
  if (lakh >= 100) return `\u20b9${trimNumber(lakh / 100)} Cr`;
  return `\u20b9${lakh} L`;
}

export function normalizeTeamName(name) {
  return String(name ?? '').trim().replace(/\s+/g, ' ');
}
