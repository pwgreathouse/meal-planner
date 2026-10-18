// Settings, account, and backup.
import * as db from '../db.js';
import { esc } from '../util.js';
import { getPrefs, savePrefs, MEALS } from '../prefs.js';
import { toast, stepperHtml, wireSteppers } from '../ui.js';
import { onCloudStatus, startSync, signIn, signOut } from '../cloud.js';

const DEFAULT_HELPER = 'https://recipe-helper.pwgreathouse.workers.dev';
const lines = (v) => String(v || '').split('\n').map((s) => s.trim()).filter(Boolean);

export function moreView(el) {
  const p = getPrefs();
  const counts = { recipes: db.all('recipes').length, inbox: db.all('inbox').length };
  el.innerHTML = `
    <header class="topbar"><h1>More</h1></header>
    <div class="settings">
      <section class="panel" id="account"></section>

      <section class="panel">
        <h2>Default servings</h2>
        <p class="muted small">Used when you add a recipe to the plan. You can change it each time.</p>
        ${MEALS.map((m) => `<div class="field-row">${stepperHtml(m.key, p.servings[m.key], { label: m.label, max: 20 })}</div>`).join('')}
      </section>

      <section class="panel">
        <h2>Staples</h2>
        <p class="muted small">Quick-add buttons on the shopping list. One per line.</p>
        <textarea id="staples" rows="5">${esc(p.staples.join('\n'))}</textarea>
      </section>

      <section class="panel">
        <h2>Recipe categories</h2>
        <p class="muted small">One per line, in the order you want them shown.</p>
        <textarea id="categories" rows="6">${esc(p.categories.join('\n'))}</textarea>
      </section>

      <section class="panel">
        <h2>Never put on the list</h2>
        <p class="muted small">Skipped when meals are added to the list, e.g. water.</p>
        <textarea id="never" rows="3">${esc(p.neverBuy.join('\n'))}</textarea>
      </section>

      <details class="panel">
        <summary><h2>Link import</h2></summary>
        <p class="muted small">Recipe website links are read through your own free helper. This is already set up when you're signed in.</p>
        <label>Helper URL<input id="proxy" type="url" value="${esc(p.fetchProxyUrl || DEFAULT_HELPER)}" placeholder="${DEFAULT_HELPER}"></label>
        <label>Access code<input id="token" value="${esc(p.fetchProxyToken)}" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX"></label>
        <div class="action-row"><button class="btn" id="test-helper">Test connection</button></div>
      </details>

      <button class="btn primary block" id="save">Save settings</button>

      <section class="panel">
        <h2>Backup</h2>
        <p class="muted small">${counts.recipes} recipes${counts.inbox ? `, ${counts.inbox} to review` : ''}. When you're signed in, everything is backed up automatically. A backup file is an extra copy you can keep anywhere.</p>
        <div class="action-row"><button class="btn" id="export">Export backup</button><label class="btn file-btn">Restore…<input type="file" id="import" accept="application/json,.json" hidden></label></div>
      </section>
    </div>`;

  const account = el.querySelector('#account');
  const stopStatus = onCloudStatus((s) => {
    if (!account.isConnected) return stopStatus?.(); // left this screen
    const when = s.at ? new Date(s.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    const line = {
      loading: 'Connecting…', starting: 'Connecting…', syncing: 'Syncing…', saving: 'Saving…',
      synced: `Synced ✓${when ? ` · ${when}` : ''}`, error: `Sync problem: ${s.error || ''}`,
      unavailable: 'Cloud sync unavailable right now (offline?). Your data is safe on this device.',
    }[s.state] || '';
    account.innerHTML = s.user
      ? `<h2>Account & sync</h2>
         <p class="small">Signed in as <b>${esc(s.user.email)}</b></p>
         <p class="muted small">${esc(line)}</p>
         <div class="action-row"><button class="btn" id="sign-out">Sign out</button></div>`
      : `<h2>Account & sync</h2>
         <p class="muted small">Sign in to back up everything and use the app on more than one device.</p>
         ${s.state === 'unavailable' || s.state === 'error' ? `<p class="warn small">${esc(line)}</p>` : ''}
         <div class="action-row"><button class="btn primary" id="sign-in" ${['loading', 'starting'].includes(s.state) ? 'disabled' : ''}>Sign in with Google</button></div>`;
  });
  account.addEventListener('click', async (e) => {
    try {
      if (e.target.id === 'sign-in') await signIn();
      if (e.target.id === 'sign-out' && confirm('Sign out? Your data stays on this device.')) await signOut();
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user') toast(err.message || 'Sign-in failed', 4000);
    }
  });
  startSync();

  const servings = { ...p.servings };
  wireSteppers(el, (k, v) => (servings[k] = v));

  const readForm = () => ({
    servings: { ...servings },
    staples: lines(el.querySelector('#staples').value),
    categories: lines(el.querySelector('#categories').value),
    neverBuy: lines(el.querySelector('#never').value),
    fetchProxyUrl: el.querySelector('#proxy').value.trim(),
    fetchProxyToken: el.querySelector('#token').value.trim().toUpperCase(),
  });
  // Save only what was changed on this screen, so a screen opened before sync finished can't overwrite newer settings.
  const initial = readForm();
  el.querySelector('#save').onclick = async () => {
    const now = readForm();
    const patch = Object.fromEntries(Object.entries(now).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(initial[k])));
    if (!Object.keys(patch).length) return toast('Nothing changed');
    await savePrefs(patch);
    Object.assign(initial, patch);
    toast('Settings saved');
  };

  el.querySelector('#test-helper').onclick = async () => {
    const url = el.querySelector('#proxy').value.trim().replace(/\/$/, '');
    const code = el.querySelector('#token').value.trim().toUpperCase();
    try {
      const res = await fetch(`${url}/fetch?url=${encodeURIComponent('https://example.com/')}`, { headers: { 'X-App-Token': code } });
      toast(res.ok ? 'Connected ✓' : res.status === 401 ? 'Access code doesn’t match' : `Helper error ${res.status}`, 3000);
    } catch {
      toast('Couldn’t reach the helper. Check the URL', 3000);
    }
  };

  el.querySelector('#export').onclick = async () => {
    const json = JSON.stringify(db.exportAll(), null, 1);
    const name = `meal-planner-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const file = new File([json], name, { type: 'application/json' });
    try {
      if (navigator.canShare?.({ files: [file] })) return await navigator.share({ files: [file], title: name });
    } catch {
      return;
    }
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  el.querySelector('#import').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const n = await db.importAll(JSON.parse(await f.text()));
      toast(`Restored ${n} records`);
    } catch (err) {
      toast(err.message || 'Could not read that file');
    }
  };
}
