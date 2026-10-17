// Small shared helpers: ids, escaping, dates, text normalization.

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// Dates are local calendar days stored as "YYYY-MM-DD".
export function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso, n) {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export const today = () => toISO(new Date());

// Weeks run Sunday through Saturday.
export function weekStart(iso) {
  const d = fromISO(iso);
  d.setDate(d.getDate() - d.getDay());
  return toISO(d);
}

export const weekDates = (start) => Array.from({ length: 7 }, (_, i) => addDays(start, i));

export function fmtDay(iso, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  return fromISO(iso).toLocaleDateString(undefined, opts);
}

export function fmtWeek(start) {
  const end = addDays(start, 6);
  const a = fromISO(start), b = fromISO(end);
  const sameMonth = a.getMonth() === b.getMonth();
  const left = a.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const right = b.toLocaleDateString(undefined, sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' });
  return `${left} – ${right}`;
}

// Lowercase, strip accents and punctuation, collapse whitespace.
export function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function fmtMinutes(min) {
  if (!min) return '';
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h} hr${m ? ` ${m} min` : ''}` : `${m} min`;
}
