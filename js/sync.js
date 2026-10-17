// Cloud sync with Firebase: Google sign-in, then two-way sync of every store under users/{uid}/{store}/{id}.
// The device stays the source the app reads from; the newest updatedAt wins when the two disagree.
// Loaded with a dynamic import, so the app still opens offline even if the Firebase SDK can't load.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect, getRedirectResult, signOut as fbSignOut,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  initializeFirestore, doc, setDoc, collection, getDocs, onSnapshot, writeBatch,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import * as db from './db.js';

const CONFIG = {
  apiKey: 'AIzaSyBn8OSubu5ZOi9UtqfISkwe5Kr6rUzPsJc',
  authDomain: 'meal-planner-pwg.firebaseapp.com',
  projectId: 'meal-planner-pwg',
  storageBucket: 'meal-planner-pwg.firebasestorage.app',
  messagingSenderId: '863788156682',
  appId: '1:863788156682:web:71561bc60a42fb144d5cf3',
};

// On Firebase Hosting, sign-in runs on the app's own address, which is what makes it work in an iPhone home-screen app.
if (/\.(web\.app|firebaseapp\.com)$/.test(location.hostname)) CONFIG.authDomain = location.hostname;

const app = initializeApp(CONFIG);
const auth = getAuth(app);
const fs = initializeFirestore(app, { ignoreUndefinedProperties: true });

let uid = null;
let unsubs = [];
let status = { state: 'starting' };
const statusListeners = new Set();

function setStatus(s) {
  status = { ...status, ...s };
  for (const fn of statusListeners) fn(status);
}
export const getStatus = () => status;
export function onStatus(fn) {
  statusListeners.add(fn);
  fn(status);
  return () => statusListeners.delete(fn);
}

const col = (store) => collection(fs, 'users', uid, store);
const ref = (store, id) => doc(fs, 'users', uid, store, id);
// Firestore rejects undefined values and arrays nested directly in arrays (rare, e.g. some sites' nutrition data).
const clean = (o) => JSON.parse(JSON.stringify(o, (k, v) => (Array.isArray(v) && v.some(Array.isArray) ? JSON.stringify(v) : v)));
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;

export async function signIn() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  if (isStandalone()) return signInWithRedirect(auth, provider);
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    if (err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-supported-in-this-environment') {
      return signInWithRedirect(auth, provider);
    }
    throw err;
  }
}

export async function signOut() {
  stop();
  await fbSignOut(auth);
}

function stop() {
  unsubs.forEach((u) => u());
  unsubs = [];
  uid = null;
}

// Remote record beats local only if it is newer.
async function applyIfNewer(store, remote) {
  const local = db.get(store, remote.id);
  if (local && (local.updatedAt || 0) >= (remote.updatedAt || 0)) return;
  if (remote.deleted && !local) return;
  await db.applyRemote(store, remote);
}

async function reconcile() {
  for (const store of db.STORES) {
    const snap = await getDocs(col(store));
    const remote = new Map(snap.docs.map((d) => [d.id, d.data()]));
    for (const r of remote.values()) await applyIfNewer(store, r);

    const writes = [];
    for (const l of db.all(store)) {
      const r = remote.get(l.id);
      if (!r || (l.updatedAt || 0) > (r.updatedAt || 0)) writes.push([l.id, clean(l)]);
    }
    const tombs = db.allTombstones().filter((t) => t.store === store);
    for (const t of tombs) {
      const r = remote.get(t.recId);
      if (r && !r.deleted && (r.updatedAt || 0) <= t.updatedAt) writes.push([t.recId, { id: t.recId, deleted: true, updatedAt: t.updatedAt }]);
    }
    for (let i = 0; i < writes.length; i += 400) {
      const batch = writeBatch(fs);
      for (const [id, data] of writes.slice(i, i + 400)) batch.set(ref(store, id), data);
      await batch.commit();
    }
    for (const t of tombs) await db.clearTombstone(t.id);
  }
}

function listen() {
  for (const store of db.STORES) {
    unsubs.push(
      onSnapshot(col(store), (snap) => {
        for (const ch of snap.docChanges()) {
          if (ch.type === 'removed' || ch.doc.metadata.hasPendingWrites) continue;
          applyIfNewer(store, ch.doc.data());
        }
        setStatus({ state: 'synced', at: Date.now() });
      }, (err) => setStatus({ state: 'error', error: err.message }))
    );
  }
}

// Every local change is pushed as it happens (Firestore queues it while offline).
db.onWrite(async (store, obj, id, tomb) => {
  if (!uid) return;
  try {
    setStatus({ state: 'saving' });
    if (obj) await setDoc(ref(store, id), clean(obj));
    else {
      await setDoc(ref(store, id), { id, deleted: true, updatedAt: tomb.updatedAt });
      await db.clearTombstone(tomb.id);
    }
    setStatus({ state: 'synced', at: Date.now() });
  } catch (err) {
    setStatus({ state: 'error', error: err.message });
  }
});

getRedirectResult(auth).catch((err) => setStatus({ state: 'error', error: err.message }));

onAuthStateChanged(auth, async (user) => {
  stop();
  if (!user) return setStatus({ state: 'signed-out', user: null });
  uid = user.uid;
  setStatus({ state: 'syncing', user: { email: user.email, name: user.displayName, uid: user.uid } });
  try {
    await reconcile();
    listen();
    setStatus({ state: 'synced', at: Date.now() });
  } catch (err) {
    setStatus({ state: 'error', error: err.message });
  }
});
