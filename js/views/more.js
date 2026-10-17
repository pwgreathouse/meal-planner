// Settings, backup/restore, and help pages.
import * as db from '../db.js';
import { esc } from '../util.js';
import { getPrefs, savePrefs, MEALS } from '../prefs.js';
import { toast, stepperHtml, wireSteppers } from '../ui.js';
import { onCloudStatus, startSync, signIn, signOut } from '../cloud.js';
import { AI_MODELS, aiReady, aiNutrition, ingredientsSignature } from '../ai.js';

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
        <h2>AI ✨</h2>
        <p class="muted small">Reads photos and messy recipes, suggests meals, estimates nutrition. Paid from your Claude credit.</p>
        <label>Model<select id="ai-model">${AI_MODELS.map((m) => `<option value="${m.id}" ${m.id === p.aiModel ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select></label>
        <p class="muted small" id="ai-note">${esc(AI_MODELS.find((m) => m.id === p.aiModel)?.note || '')}</p>
        <div class="grid-2">
          <label>Daily calories goal<input id="goal-cal" type="number" inputmode="numeric" min="0" value="${p.goals.calories || ''}" placeholder="optional"></label>
          <label>Daily protein goal (g)<input id="goal-pro" type="number" inputmode="numeric" min="0" value="${p.goals.protein || ''}" placeholder="optional"></label>
        </div>
        ${aiReady() ? `<div class="action-row"><button class="btn" id="nutr-all">Estimate nutrition for all recipes</button></div>` : ''}
      </section>

      <section class="panel">
        <h2>Always on hand</h2>
        <p class="muted small">Basics that don't count against a recipe in “Cook from what you have”. One per line.</p>
        <textarea id="basics" rows="4">${esc(p.basics.join('\n'))}</textarea>
      </section>

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
        <h2>Categories</h2>
        <p class="muted small">One per line, in the order you want them shown.</p>
        <textarea id="categories" rows="6">${esc(p.categories.join('\n'))}</textarea>
      </section>

      <section class="panel">
        <h2>Never put on the list</h2>
        <textarea id="never" rows="3">${esc(p.neverBuy.join('\n'))}</textarea>
      </section>

      <section class="panel">
        <h2>Link import helper</h2>
        <p class="muted small">Recipe sites block apps from reading them directly, so link imports go through your own small helper. Type the access code once, then Save settings.</p>
        <label>Helper URL<input id="proxy" type="url" value="${esc(p.fetchProxyUrl || DEFAULT_HELPER)}" placeholder="${DEFAULT_HELPER}"></label>
        <label>Access code<input id="token" value="${esc(p.fetchProxyToken)}" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX"></label>
        <div class="action-row"><button class="btn" id="test-helper">Test connection</button></div>
      </section>

      <button class="btn primary block" id="save">Save settings</button>

      <section class="panel">
        <h2>Backup</h2>
        <p class="muted small">${counts.recipes} recipes${counts.inbox ? `, ${counts.inbox} in Inbox` : ''}. When you're signed in, everything is backed up automatically. A backup file is an extra copy you can keep anywhere.</p>
        <div class="action-row"><button class="btn" id="export">Export backup</button><label class="btn file-btn">Restore…<input type="file" id="import" accept="application/json,.json" hidden></label></div>
      </section>

      <section class="panel">
        <h2>Help</h2>
        <a class="link-row" href="#/help/shortcuts">Share to Meals from any app or screenshot ›</a>
        <a class="link-row" href="#/help/notes">Import from Apple Notes ›</a>
        <a class="link-row" href="#/help/keep">Import from Google Keep ›</a>
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
         <p class="muted small">Sign in to back up everything to your private cloud space and use the app on more than one device.</p>
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

  el.querySelector('#save').onclick = async () => {
    await savePrefs({
      servings,
      staples: lines(el.querySelector('#staples').value),
      categories: lines(el.querySelector('#categories').value),
      neverBuy: lines(el.querySelector('#never').value),
      basics: lines(el.querySelector('#basics').value),
      aiModel: el.querySelector('#ai-model').value,
      goals: { calories: +el.querySelector('#goal-cal').value || 0, protein: +el.querySelector('#goal-pro').value || 0 },
      fetchProxyUrl: el.querySelector('#proxy').value.trim(),
      fetchProxyToken: el.querySelector('#token').value.trim().toUpperCase(),
    });
    toast('Settings saved');
  };

  el.querySelector('#ai-model').onchange = (e) => {
    el.querySelector('#ai-note').textContent = AI_MODELS.find((m) => m.id === e.target.value)?.note || '';
  };

  el.querySelector('#nutr-all')?.addEventListener('click', async (e) => {
    const todo = db.all('recipes').filter((r) => r.ingredients?.length && (!r.nutrition || r.nutrition.sig !== ingredientsSignature(r)));
    if (!todo.length) return toast('Every recipe already has an up-to-date estimate');
    if (!confirm(`Estimate nutrition for ${todo.length} recipe${todo.length === 1 ? '' : 's'}? Roughly 1¢ each.`)) return;
    const btn = e.target;
    btn.disabled = true;
    let ok = 0;
    for (const r of todo) {
      btn.textContent = `Estimating ${ok + 1} of ${todo.length}…`;
      try {
        r.nutrition = await aiNutrition(r);
        await db.put('recipes', r);
        ok++;
      } catch (err) {
        toast(err.message, 4000);
        break;
      }
    }
    btn.disabled = false;
    btn.textContent = 'Estimate nutrition for all recipes';
    toast(`Estimated ${ok} recipe${ok === 1 ? '' : 's'}`);
  });

  el.querySelector('#test-helper').onclick = async () => {
    const url = el.querySelector('#proxy').value.trim().replace(/\/$/, '');
    const code = el.querySelector('#token').value.trim().toUpperCase();
    try {
      const res = await fetch(`${url}/fetch?url=${encodeURIComponent('https://example.com/')}`, { headers: { 'X-App-Token': code } });
      toast(res.ok ? 'Connected ✓ — tap Save settings' : res.status === 401 ? 'Access code doesn’t match' : `Helper error ${res.status}`, 3000);
    } catch {
      toast('Couldn’t reach the helper — check the URL', 3000);
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

export function notesHelpView(el) {
  el.innerHTML = `
    <header class="topbar"><a class="back" href="#/more">‹ More</a><h1 class="topbar-title">Apple Notes</h1></header>
    <article class="help">
      <p>This copies every note in your <b>Recipes</b> folder at once. Nothing in Notes is changed. Build the Shortcut once (about 3 minutes), then run it whenever you like.</p>
      <h2>1. Build the Shortcut</h2>
      <ol>
        <li>Open the <b>Shortcuts</b> app, tap <b>＋</b>, and name it <i>Export Recipe Notes</i>.</li>
        <li>Add <b>Find Notes</b>. Tap <i>Add Filter</i> → <b>Folder</b> <i>is</i> <b>Recipes</b>. Turn off the result limit.</li>
        <li>Add <b>Repeat with Each</b> (it uses the found notes).</li>
        <li>Inside the repeat, add <b>Text</b> containing:<br>
          <code>===== NEXT RECIPE =====</code> (new line) <b>Repeat Item</b> → Name (new line) <b>Repeat Item</b> → Body<br>
          <small class="muted">Tap the Repeat Item variable to choose Name, then add it again and choose Body.</small></li>
        <li>After <b>End Repeat</b>, add <b>Combine Text</b> (Repeat Results, with New Lines).</li>
        <li>Add <b>Copy to Clipboard</b>, then <b>Show Notification</b> “Recipes copied”.</li>
      </ol>
      <h2>2. Run it and paste</h2>
      <ol>
        <li>Run the Shortcut. Allow access to Notes when asked.</li>
        <li>Come back here → <a href="#/add">Add</a> → <b>Bulk import</b> → <b>Paste from clipboard</b> → <b>Import all</b>.</li>
        <li>Each note lands in the Inbox. Tap through to check them; notes that are just links get fetched once the link helper is set up.</li>
      </ol>
      <h2>Good to know</h2>
      <ul>
        <li><b>Photos and screenshots</b> inside notes don't come across. Those notes import with whatever text they have. Use Live Text (press and hold the text in the image, Copy) or wait for the AI step.</li>
        <li><b>Run it again any time.</b> Only new notes come in. Notes you've edited in Apple Notes show up as “Changed in Notes” with a list of what changed, and you choose to update the recipe or keep yours. Nothing is overwritten without your OK, and notes you discarded stay away unless they change.</li>
      </ul>
    </article>`;
}

export function shortcutsHelpView(el) {
  const base = `${location.origin}${location.pathname}#/add?auto=1&in=`;
  el.innerHTML = `
    <header class="topbar"><a class="back" href="#/more">‹ More</a><h1 class="topbar-title">Share to Meals</h1></header>
    <article class="help">
      <p>Two Shortcuts put Meals in your iPhone's <b>Share</b> menu. Each takes about 2 minutes to build, once.</p>

      <h2>First, one time: sign in from Safari</h2>
      <p>Shortcuts open Meals in <b>Safari</b> (iPhone doesn't let them open home-screen apps), and Safari keeps its own copy separate from your home-screen app.
      So open <b>${esc(location.origin)}</b> in Safari once, tap <b>More → Sign in with Google</b>, and from then on everything you share lands in the Inbox of your home-screen app too.</p>

      <h2>1. “Save to Meals” (links and text)</h2>
      <ol>
        <li>Open <b>Shortcuts</b>, tap <b>＋</b>, and name it <i>Save to Meals</i>.</li>
        <li>Tap the <b>ⓘ</b> (or the name at the top → Details) and turn on <b>Show in Share Sheet</b>.</li>
        <li>Tap the <b>Shortcut Input</b> box that appears and set it to receive <b>URLs</b>, <b>Safari web pages</b>, <b>Articles</b> and <b>Text</b>. If there's no input: <b>Get Clipboard</b>.</li>
        <li>Add the action <b>URL Encode</b>. It should say <i>Encode Shortcut Input</i>.</li>
        <li>Add the action <b>Text</b> and type exactly:<br><code id="base1">${esc(base)}</code><br>then, right after it with no space, insert the <b>URL Encoded Text</b> variable.</li>
        <li>Add the action <b>Open URLs</b> (it uses the Text).</li>
      </ol>
      <p class="muted small">Try it: in Safari on any recipe page tap Share → Save to Meals. You'll see “Saved to your Inbox ✓”. It also works from Instagram, Mail, Notes and anywhere else that shares links or text.</p>

      <h2>2. “Recipe from Screenshot”</h2>
      <ol>
        <li>New shortcut named <i>Recipe from Screenshot</i>, with <b>Show in Share Sheet</b> on, receiving <b>Images</b> only.</li>
        <li>Add <b>Extract Text from Image</b> (Image: Shortcut Input). Your iPhone reads the text itself, which is free and private.</li>
        <li>Add <b>URL Encode</b> (Text: Text from Image).</li>
        <li>Add <b>Text</b> with the same address as above, then the <b>URL Encoded Text</b> variable.</li>
        <li>Add <b>Open URLs</b>.</li>
      </ol>
      <p class="muted small">Use it from Photos: open a recipe screenshot → Share → Recipe from Screenshot. Text-based screenshots work well; photos of cookbook pages and handwriting usually need some tidying in the review screen. The AI step will do better with those later.</p>

      <button class="btn block" id="copy-base">Copy the address</button>
    </article>`;
  el.querySelector('#copy-base').onclick = async () => {
    try {
      await navigator.clipboard.writeText(base);
      toast('Copied, paste it into the Text action');
    } catch {
      toast('Press and hold the address to copy it');
    }
  };
}

export function keepHelpView(el) {
  el.innerHTML = `
    <header class="topbar"><a class="back" href="#/more">‹ More</a><h1 class="topbar-title">Google Keep</h1></header>
    <article class="help">
      <p>For a few notes, open each in Keep, select all the text, Copy, and use <a href="#/add">Paste a recipe</a>.</p>
      <p>For many, paste them one after another into <b>Bulk import</b>, typing <code>===== NEXT RECIPE =====</code> on its own line between each.</p>
      <p>Your Keep shopping checklist can go into <a href="#/more">Staples</a> (one item per line) so they're one tap away on each week's list.</p>
    </article>`;
}
