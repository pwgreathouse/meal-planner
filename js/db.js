// Local-first storage on IndexedDB with an in-memory cache.
// Every record has an `id` and an `updatedAt`, so cloud sync can be layered on later.

const DB_NAME = 'meal-planner';
const VERSION = 2;
export const STORES = ['recipes', 'weeks', 'inbox', 'shopping', 'settings'];

let dbPromise;
const cache = Object.fromEntries(STORES.map((s) => [s, new Map()]));
const tombstones = new Map();
const listeners = new Set();

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of [...STORES, 'tombstones']) {
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
    [...STORES, 'tombstones'].map(
      (s) =>
        new Promise((resolve, reject) => {
          const req = db.transaction(s).objectStore(s).getAll();
          req.onsuccess = () => {
            const target = s === 'tombstones' ? tombstones : cache[s];
            for (const o of req.result) target.set(o.id, o);
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
  hook(store, obj);
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
  objs.forEach((o) => hook(store, o));
}

// Deletes leave a tombstone so the deletion can reach the cloud even if made offline.
export async function remove(store, id) {
  cache[store].delete(id);
  const tomb = { id: `${store}/${id}`, store, recId: id, updatedAt: Date.now() };
  tombstones.set(tomb.id, tomb);
  await tx(store, (os) => os.delete(id));
  await tx('tombstones', (os) => os.put(tomb));
  emit(store);
  hook(store, null, id, tomb);
}

// ---------- Sync support ----------

export const allTombstones = () => [...tombstones.values()];

export async function clearTombstone(key) {
  tombstones.delete(key);
  await tx('tombstones', (os) => os.delete(key));
}

// Applies a record that came from the cloud: keeps its timestamp and doesn't echo back.
export async function applyRemote(store, obj) {
  if (obj.deleted) {
    if (!cache[store].has(obj.id)) return;
    cache[store].delete(obj.id);
    await tx(store, (os) => os.delete(obj.id));
  } else {
    cache[store].set(obj.id, obj);
    await tx(store, (os) => os.put(obj));
  }
  emit(store);
}

const writeHooks = new Set();
export function onWrite(fn) {
  writeHooks.add(fn);
  return () => writeHooks.delete(fn);
}
function hook(store, obj, id, tomb) {
  for (const fn of writeHooks) fn(store, obj, id ?? obj?.id, tomb);
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
    rows.forEach((r) => hook(s, r));
  }
  return count;
}
