// Thin wrapper that loads the Firebase sync module on demand, so the app never depends on it to open.
let loading = null;
let status = { state: 'loading' };
const listeners = new Set();

function publish(s) {
  status = s;
  for (const fn of listeners) fn(s);
}

export function startSync() {
  if (!loading) {
    loading = import('./sync.js')
      .then((m) => {
        m.onStatus(publish);
        return m;
      })
      .catch((err) => {
        publish({ state: 'unavailable', error: navigator.onLine ? err.message : 'Offline' });
        loading = null; // try again next time
        return null;
      });
  }
  return loading;
}

export function onCloudStatus(fn) {
  listeners.add(fn);
  fn(status);
  return () => listeners.delete(fn);
}

export async function signIn() {
  const m = await startSync();
  if (!m) throw new Error('Cloud sync is unavailable right now (are you offline?)');
  return m.signIn();
}

export async function signOut() {
  const m = await startSync();
  return m?.signOut();
}
