// Settings, backup/restore, and help pages.
import * as db from '../db.js';
import { esc } from '../util.js';
import { getPrefs, savePrefs, MEALS } from '../prefs.js';
import { toast, stepperHtml, wireSteppers } from '../ui.js';

const lines = (v) => String(v || '').split('\n').map((s) => s.trim()).filter(Boolean);

export function moreView(el) {
  const p = getPrefs();
  const counts = { recipes: db.all('recipes').length, inbox: db.all('inbox').length };
  el.innerHTML = `
    <header class="topbar"><h1>More</h1></header>
    <div class="settings">
      <section class="panel">
        <h2>Pantry</h2>
        <p class="muted small">Coming in the next phase: track what's on hand, auto-add from shopping trips, subtract when you cook, and toss items.</p>
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
        <p class="muted small">Recipe sites block apps from reading them directly, so link imports go through a small free helper you'll set up during deployment.</p>
        <label>Helper URL<input id="proxy" type="url" value="${esc(p.fetchProxyUrl)}" placeholder="https://recipe-helper.yourname.workers.dev"></label>
        <label>Access code<input id="token" value="${esc(p.fetchProxyToken)}" autocomplete="off"></label>
      </section>

      <button class="btn primary block" id="save">Save settings</button>

      <section class="panel">
        <h2>Backup</h2>
        <p class="muted small">${counts.recipes} recipes${counts.inbox ? `, ${counts.inbox} in Inbox` : ''}. Your data lives on this device until cloud sync is set up, so export a backup now and then.</p>
        <div class="action-row"><button class="btn" id="export">Export backup</button><label class="btn file-btn">Restore…<input type="file" id="import" accept="application/json,.json" hidden></label></div>
      </section>

      <section class="panel">
        <h2>Help</h2>
        <a class="link-row" href="#/help/notes">Import from Apple Notes ›</a>
        <a class="link-row" href="#/help/keep">Import from Google Keep ›</a>
      </section>
    </div>`;

  const servings = { ...p.servings };
  wireSteppers(el, (k, v) => (servings[k] = v));

  el.querySelector('#save').onclick = async () => {
    await savePrefs({
      servings,
      staples: lines(el.querySelector('#staples').value),
      categories: lines(el.querySelector('#categories').value),
      neverBuy: lines(el.querySelector('#never').value),
      fetchProxyUrl: el.querySelector('#proxy').value.trim(),
      fetchProxyToken: el.querySelector('#token').value.trim(),
    });
    toast('Settings saved');
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
        <li>Run it again later and possible duplicates are flagged in the Inbox.</li>
      </ul>
    </article>`;
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
