// Local-first storage on IndexedDB with an in-memory cache.
// Every record has an `id` and an `updatedAt`, so cloud sync can be layered on later.

const DB_NAME = 'meal-planner';
const VERSION = 1;
export const STORES = ['recipes', 'weeks', 'inbox', 'shopping', 'settings'];

let dbPromise;
const cache = Object.fromEntries(STORES.map((s) => [s, new Map()]));
const listeners = new Set();

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) {
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(store, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, 'readwrite');
        fn(t.objectStore(store));
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      })
  );
}

export async function init() {
  const db = await open();
  await Promise.all(
    STORES.map(
      (s) =>
        new Promise((resolve, reject) => {
          const req = db.transaction(s).objectStore(s).getAll();
          req.onsuccess = () => {
            for (const o of req.result) cache[s].set(o.id, o);
            resolve();
          };
          req.onerror = () => reject(req.error);
        })
    )
  );
  // Ask the browser not to evict our data under storage pressure.
  navigator.storage?.persist?.().catch(() => {});
}

export const all = (store) => [...cache[store].values()];
export const get = (store, id) => cache[store].get(id);

export async function put(store, obj) {
  obj.updatedAt = Date.now();
  cache[store].set(obj.id, obj);
  await tx(store, (os) => os.put(obj));
  emit(store);
  return obj;
}

export async function putMany(store, objs) {
  const now = Date.now();
  for (const o of objs) {
    o.updatedAt = now;
    cache[store].set(o.id, o);
  }
  await tx(store, (os) => objs.forEach((o) => os.put(o)));
  emit(store);
}

export async function remove(store, id) {
  cache[store].delete(id);
  await tx(store, (os) => os.delete(id));
  emit(store);
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(store) {
  for (const fn of listeners) fn(store);
}

export function exportAll() {
  return {
    app: 'meal-planner',
    version: 1,
    exportedAt: new Date().toISOString(),
    data: Object.fromEntries(STORES.map((s) => [s, all(s)])),
  };
}

// Merges a backup in; records in the backup replace local records with the same id.
export async function importAll(backup) {
  if (backup?.app !== 'meal-planner' || !backup.data) throw new Error('Not a Meal Planner backup file');
  let count = 0;
  for (const s of STORES) {
    const rows = backup.data[s];
    if (!Array.isArray(rows) || !rows.length) continue;
    for (const r of rows) cache[s].set(r.id, r);
    await tx(s, (os) => rows.forEach((r) => os.put(r)));
    count += rows.length;
    emit(s);
  }
  return count;
}
