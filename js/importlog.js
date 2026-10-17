// Remembers which notes have been bulk-imported (by title) and a fingerprint of their text,
// so re-running the Apple Notes export only brings in new or changed notes.
import * as db from './db.js';
import { normalizeText } from './util.js';

const ID = 'importLog';

// { [noteKey]: { hash, recipeId, status: 'saved' | 'discarded', at } }
export const getLog = () => db.get('settings', ID)?.notes || {};

// A note is identified by its first line (its name in Apple Notes).
export function noteKey(text) {
  const first = String(text || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
  return normalizeText(first).slice(0, 120);
}

// FNV-1a over the whitespace-collapsed text: changes to wording or amounts change the hash.
export function noteHash(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export async function recordImports(entries) {
  const valid = entries.filter((e) => e.key);
  if (!valid.length) return;
  const doc = db.get('settings', ID) || { id: ID, notes: {} };
  for (const e of valid) doc.notes[e.key] = { hash: e.hash, recipeId: e.recipeId || null, status: e.status, at: Date.now() };
  await db.put('settings', doc);
}

// What an inbox item's outcome means for the log.
export function logEntryFor(item, outcome, recipeId) {
  if (!item.noteKey) return null;
  if (outcome === 'saved') return { key: item.noteKey, hash: item.noteHash, recipeId, status: 'saved' };
  // Dismissing a changed note keeps the app's version and stops asking about this edit.
  if (item.kind === 'changed') return { key: item.noteKey, hash: item.noteHash, recipeId: item.targetId, status: 'saved' };
  return { key: item.noteKey, hash: item.noteHash, recipeId: null, status: 'discarded' };
}
