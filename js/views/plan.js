// Weekly plan: Sunday–Saturday, breakfast/lunch/dinner slots, batches with leftovers, and skips.
import * as db from '../db.js';
import { esc, today, weekStart, weekDates, addDays, fmtDay, fmtWeek } from '../util.js';
import { getPrefs, MEALS } from '../prefs.js';
import { getWeek, addRecipeEntry, addSkip, updateEntry, removeEntry, setCovers, leftoversOf, searchRecipes, getList, addWeekToList, listResultText } from '../model.js';
import { openSheet, toast, stepperHtml, wireSteppers, stepperValue, setStepper } from '../ui.js';
import { openDeductSheet } from './pantry.js';

const SKIP_LABELS = ['Eating out', 'Leftovers', 'Not needed', 'Takeout'];
const mealLabel = (k) => MEALS.find((m) => m.key === k)?.label || k;
const shortDay = (iso) => fmtDay(iso, { weekday: 'short' });

const defaultMealFor = (r) => (r?.category === 'Breakfast' ? 'breakfast' : r?.category === 'Lunch' ? 'lunch' : 'dinner');

export function planView(el, startParam) {
  const start = startParam || weekStart(today());

  function draw() {
    const week = getWeek(start);
    const dates = weekDates(start);
    const cooks = week.entries.filter((e) => e.type === 'recipe').length;
    const skips = week.entries.filter((e) => e.type === 'skip').length;
    const thisWeek = weekStart(today());

    el.innerHTML = `
      <header class="topbar"><h1>Plan</h1>${cooks ? '<button class="btn-text strong" id="week-to-list">＋ Add to list</button>' : ''}</header>
      <div class="week-nav">
        <a class="btn-icon" href="#/plan/${addDays(start, -7)}" aria-label="Previous week">‹</a>
        <div class="week-label"><strong>${esc(fmtWeek(start))}</strong>
          <small>${start === thisWeek ? 'This week' : start === addDays(thisWeek, 7) ? 'Next week' : start < thisWeek ? 'Past week' : ''}</small></div>
        <a class="btn-icon" href="#/plan/${addDays(start, 7)}" aria-label="Next week">›</a>
      </div>
      <p class="muted small center">${cooks} to cook${skips ? ` · ${skips} not needed` : ''}${start !== thisWeek ? ` · <a href="#/plan">Jump to this week</a>` : ''}</p>
      <div class="days">${dates.map((d) => dayHtml(week, d)).join('')}</div>`;
  }

  function dayHtml(week, date) {
    const isToday = date === today();
    return `<section class="day ${isToday ? 'today' : ''}">
      <h3>${esc(fmtDay(date, { weekday: 'long', month: 'short', day: 'numeric' }))}${isToday ? ' <span class="pill">Today</span>' : ''}</h3>
      ${MEALS.map((m) => {
        const entries = week.entries.filter((e) => e.date === date && e.meal === m.key);
        return `<div class="slot">
          <span class="slot-label">${m.label}</span>
          <div class="slot-entries">${entries.map((e) => entryHtml(week, e)).join('')}
            <button class="slot-add" data-date="${date}" data-meal="${m.key}" aria-label="Add ${m.label.toLowerCase()}">＋</button></div>
        </div>`;
      }).join('')}
    </section>`;
  }

  function entryHtml(week, e) {
    if (e.type === 'skip') return `<button class="entry skip" data-entry="${e.id}">— ${esc(e.label || 'Not needed')}</button>`;
    if (e.type === 'leftover') {
      const src = week.entries.find((x) => x.id === e.sourceId);
      const r = src && db.get('recipes', src.recipeId);
      return `<button class="entry leftover" data-entry="${e.id}">↺ ${esc(r?.title || 'Leftovers')}</button>`;
    }
    const r = db.get('recipes', e.recipeId);
    const lo = leftoversOf(week, e.id);
    const covers = lo.length
      ? ` · covers ${lo.map((l) => shortDay(l.date) + (l.meal !== e.meal ? ` ${l.meal}` : '')).join(', ')}`
      : '';
    return `<button class="entry ${e.made ? 'made' : ''}" data-entry="${e.id}">
      <span class="entry-title">${e.made ? '✓ ' : ''}${esc(r?.title || '(deleted recipe)')}</span>
      <span class="entry-sub">${e.servings} serving${e.servings === 1 ? '' : 's'}${covers}</span></button>`;
  }

  el.addEventListener('click', async (ev) => {
    if (ev.target.id === 'week-to-list') {
      if (getList().addedWeeks?.[start] && !confirm('You already added this week to the list. Add its meals again?')) return;
      const res = await addWeekToList(start);
      return toast(listResultText(res), 4000);
    }
    const add = ev.target.closest('.slot-add');
    if (add) return openAddToPlan({ start, date: add.dataset.date, meal: add.dataset.meal });
    const ent = ev.target.closest('[data-entry]');
    if (ent) openEntrySheet(start, ent.dataset.entry);
  });

  draw();
  return { refresh: (store) => (store === 'weeks' || store === 'recipes') && draw() };
}

// ---------- Add to plan ----------
// Opened from an empty slot (date + meal known) or from a recipe (recipeId known).

export function openAddToPlan({ start, date, meal, recipeId, servings: presetServings }) {
  const prefs = getPrefs();
  const fromSlot = !!date;
  let chosen = recipeId ? db.get('recipes', recipeId) : null;
  let wk = start || weekStart(date || today());
  // From a recipe on a weekend, default to next week since shopping happens Sunday.
  if (!fromSlot && new Date().getDay() === 6) wk = addDays(weekStart(today()), 7);
  let day = date || null;
  let slot = meal || defaultMealFor(chosen);

  const sheet = openSheet('<div id="add-body"></div>');
  const body = sheet.el.querySelector('#add-body');

  function pickRecipe(q = '') {
    const all = db.all('recipes');
    const rows = searchRecipes(all, q);
    const want = mealLabel(slot);
    if (!q) rows.sort((a, b) => (b.r.category === want) - (a.r.category === want) || a.r.title.localeCompare(b.r.title));
    return rows.slice(0, 60).map(({ r }) => `<button class="pick" data-pick="${r.id}"><strong>${esc(r.title)}</strong><small>${esc(r.category)}</small></button>`).join('')
      || `<p class="muted pad">${all.length ? 'No matches.' : 'No recipes yet — add some first.'}</p>`;
  }

  function drawChooser() {
    body.innerHTML = `
      <h2>${esc(mealLabel(slot))} · ${esc(fmtDay(day))}</h2>
      <div class="seg" id="mode"><button class="on" data-mode="recipe">Recipe</button><button data-mode="skip">Not needed</button></div>
      <div id="mode-recipe">
        <input type="search" id="pick-q" placeholder="Search recipes…" autocomplete="off">
        <div class="pick-list" id="pick-list">${pickRecipe()}</div>
      </div>
      <div id="mode-skip" hidden>
        <div class="chips wrap">${SKIP_LABELS.map((l) => `<button class="chip" data-skip="${esc(l)}">${esc(l)}</button>`).join('')}</div>
        <div class="inline-form"><input id="skip-custom" placeholder="Or type a note (e.g. Grandma's)"><button class="btn" id="skip-save">Save</button></div>
      </div>`;
    const q = body.querySelector('#pick-q');
    q.addEventListener('input', () => (body.querySelector('#pick-list').innerHTML = pickRecipe(q.value)));
    body.querySelector('#mode').addEventListener('click', (e) => {
      const b = e.target.closest('[data-mode]');
      if (!b) return;
      body.querySelectorAll('#mode button').forEach((x) => x.classList.toggle('on', x === b));
      body.querySelector('#mode-recipe').hidden = b.dataset.mode !== 'recipe';
      body.querySelector('#mode-skip').hidden = b.dataset.mode !== 'skip';
    });
    body.querySelector('#pick-list').addEventListener('click', (e) => {
      const b = e.target.closest('[data-pick]');
      if (!b) return;
      chosen = db.get('recipes', b.dataset.pick);
      drawDetails();
    });
    const saveSkip = async (label) => {
      await addSkip(wk, { date: day, meal: slot, label });
      sheet.close();
      toast(`${mealLabel(slot)} marked “${label}”`);
    };
    body.querySelector('#mode-skip').addEventListener('click', (e) => {
      const b = e.target.closest('[data-skip]');
      if (b) saveSkip(b.dataset.skip);
    });
    body.querySelector('#skip-save').addEventListener('click', () => {
      const v = body.querySelector('#skip-custom').value.trim();
      if (v) saveSkip(v);
    });
  }

  function drawDetails() {
    const per = prefs.servings;
    const dates = weekDates(wk);
    let covers = [];
    let coverMeal = slot;
    let touched = !!presetServings;
    const autoServings = () => per[slot] + covers.length * per[coverMeal];
    let servings = presetServings || autoServings();

    body.innerHTML = `
      <h2>${esc(chosen.title)}</h2>
      ${fromSlot ? '' : `
        <div class="field-label">Week</div>
        <div class="seg" id="wk">${[0, 7].map((o) => { const w = addDays(weekStart(today()), o); return `<button data-wk="${w}" class="${w === wk ? 'on' : ''}">${o ? 'Next week' : 'This week'}<small>${esc(fmtWeek(w))}</small></button>`; }).join('')}</div>
        <div class="field-label">Day</div><div class="chips wrap" id="days"></div>
        <div class="field-label">Meal</div>
        <div class="seg" id="meal">${MEALS.map((m) => `<button data-meal="${m.key}" class="${m.key === slot ? 'on' : ''}">${m.label}</button>`).join('')}</div>`}
      <div class="field-label">Leftovers also cover <small class="muted">optional — for batches</small></div>
      <div class="chips wrap" id="covers"></div>
      <div class="cover-meal" id="cover-meal-wrap" hidden>as
        <select id="cover-meal">${MEALS.map((m) => `<option value="${m.key}">${m.label.toLowerCase()}</option>`).join('')}</select></div>
      <div class="field-row">${stepperHtml('servings', servings, { label: 'Servings to make', max: 200 })}</div>
      <p class="muted small" id="scale-note"></p>
      <button class="btn primary block" id="add-save">Add to plan</button>`;

    const drawDays = () => {
      const d = body.querySelector('#days');
      if (d) d.innerHTML = weekDates(wk).map((x) => `<button class="chip ${x === day ? 'on' : ''}" data-day="${x}">${esc(shortDay(x))} <small>${esc(fmtDay(x, { day: 'numeric' }))}</small></button>`).join('');
    };
    const drawCovers = () => {
      const opts = weekDates(wk).filter((x) => !day || x > day || (x === day && coverMeal !== slot));
      body.querySelector('#covers').innerHTML = day
        ? opts.map((x) => `<button class="chip ${covers.includes(x) ? 'on' : ''}" data-cover="${x}">${esc(shortDay(x))}</button>`).join('') || '<span class="muted small">No later days this week.</span>'
        : '<span class="muted small">Pick a day first.</span>';
      body.querySelector('#cover-meal-wrap').hidden = !covers.length;
    };
    const updateServings = () => {
      if (!touched) {
        servings = autoServings();
        setStepper(body, 'servings', servings);
      }
      const base = chosen.servings || servings;
      body.querySelector('#scale-note').textContent =
        servings === base ? `Recipe makes ${base}.` : `Recipe makes ${base} — ingredients will scale ×${+(servings / base).toFixed(2)}.`;
    };

    body.querySelector('#cover-meal').value = coverMeal;
    drawDays();
    drawCovers();
    updateServings();
    wireSteppers(body, (_, v) => {
      servings = v;
      touched = true;
      updateServings();
    });

    body.addEventListener('click', (e) => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.wk) {
        wk = t.dataset.wk;
        day = null;
        covers = [];
        body.querySelectorAll('#wk button').forEach((b) => b.classList.toggle('on', b === t));
        drawDays();
        drawCovers();
      } else if (t.dataset.day) {
        day = t.dataset.day;
        covers = covers.filter((c) => c > day);
        drawDays();
        drawCovers();
        updateServings();
      } else if (t.dataset.meal) {
        slot = t.dataset.meal;
        body.querySelectorAll('#meal button').forEach((b) => b.classList.toggle('on', b === t));
        if (!covers.length) coverMeal = slot;
        body.querySelector('#cover-meal').value = coverMeal;
        drawCovers();
        updateServings();
      } else if (t.dataset.cover) {
        const c = t.dataset.cover;
        covers = covers.includes(c) ? covers.filter((x) => x !== c) : [...covers, c].sort();
        drawCovers();
        updateServings();
      }
    });
    body.querySelector('#cover-meal').addEventListener('change', (e) => {
      coverMeal = e.target.value;
      drawCovers();
      updateServings();
    });
    body.querySelector('#add-save').addEventListener('click', async () => {
      if (!day) return toast('Pick a day');
      await addRecipeEntry(wk, { date: day, meal: slot, recipeId: chosen.id, servings: stepperValue(body, 'servings'), covers, coverMeal });
      sheet.close();
      toast(`Added to ${shortDay(day)} ${mealLabel(slot).toLowerCase()}`);
    });
  }

  if (chosen) drawDetails();
  else drawChooser();
}

// ---------- Existing entry ----------

function openEntrySheet(start, entryId) {
  const week = getWeek(start);
  const e = week.entries.find((x) => x.id === entryId);
  if (!e) return;
  const sheet = openSheet('<div id="entry-body"></div>');
  const body = sheet.el.querySelector('#entry-body');
  const where = `${mealLabel(e.meal)} · ${fmtDay(e.date)}`;

  if (e.type === 'skip') {
    body.innerHTML = `<h2>${esc(e.label)}</h2><p class="muted">${esc(where)}</p>
      <div class="inline-form"><input id="lbl" value="${esc(e.label)}"><button class="btn" id="ren">Rename</button></div>
      <button class="btn danger block" id="rm">Remove</button>`;
    body.querySelector('#ren').onclick = async () => { await updateEntry(start, e.id, { label: body.querySelector('#lbl').value.trim() || e.label }); sheet.close(); };
    body.querySelector('#rm').onclick = async () => { await removeEntry(start, e.id); sheet.close(); };
    return;
  }

  if (e.type === 'leftover') {
    const src = week.entries.find((x) => x.id === e.sourceId);
    const r = src && db.get('recipes', src.recipeId);
    body.innerHTML = `<h2>Leftovers: ${esc(r?.title || '')}</h2><p class="muted">${esc(where)}${src ? ` · from ${esc(mealLabel(src.meal).toLowerCase())} on ${esc(fmtDay(src.date))}` : ''}</p>
      <button class="btn danger block" id="rm">Remove from this day</button>`;
    body.querySelector('#rm').onclick = async () => {
      await removeEntry(start, e.id);
      sheet.close();
      toast('Removed — adjust the batch servings if you need less');
    };
    return;
  }

  const r = db.get('recipes', e.recipeId);
  const lo = leftoversOf(week, e.id);
  let covers = lo.map((l) => l.date);
  let coverMeal = lo[0]?.meal || e.meal;
  const dates = weekDates(start).filter((x) => x >= e.date);

  body.innerHTML = `
    <h2>${esc(r?.title || '(deleted recipe)')}</h2>
    <p class="muted">${esc(where)}</p>
    ${r ? `<a class="btn block" href="#/recipe/${r.id}">Open recipe</a>` : ''}
    <div class="field-row">${stepperHtml('servings', e.servings, { label: 'Servings to make', max: 200 })}</div>
    <div class="field-label">Leftovers cover</div>
    <div class="chips wrap" id="covers"></div>
    <div class="cover-meal">as <select id="cover-meal">${MEALS.map((m) => `<option value="${m.key}" ${m.key === coverMeal ? 'selected' : ''}>${m.label.toLowerCase()}</option>`).join('')}</select></div>
    <div class="field-label">Move to</div>
    <div class="grid-2">
      <select id="mv-day">${weekDates(start).map((d) => `<option value="${d}" ${d === e.date ? 'selected' : ''}>${esc(fmtDay(d))}</option>`).join('')}</select>
      <select id="mv-meal">${MEALS.map((m) => `<option value="${m.key}" ${m.key === e.meal ? 'selected' : ''}>${m.label}</option>`).join('')}</select>
    </div>
    <label class="check"><input type="checkbox" id="made" ${e.made ? 'checked' : ''}> Made it</label>
    <div class="action-row">
      <button class="btn primary" id="save">Save</button>
      <button class="btn danger" id="rm">Remove</button>
    </div>`;

  const drawCovers = () => {
    body.querySelector('#covers').innerHTML = dates
      .filter((x) => x > e.date || coverMeal !== e.meal)
      .map((x) => `<button class="chip ${covers.includes(x) ? 'on' : ''}" data-cover="${x}">${esc(shortDay(x))}</button>`)
      .join('') || '<span class="muted small">No later days this week.</span>';
  };
  drawCovers();
  wireSteppers(body);
  body.querySelector('#covers').addEventListener('click', (ev) => {
    const c = ev.target.closest('[data-cover]')?.dataset.cover;
    if (!c) return;
    covers = covers.includes(c) ? covers.filter((x) => x !== c) : [...covers, c].sort();
    drawCovers();
  });
  body.querySelector('#cover-meal').addEventListener('change', (ev) => {
    coverMeal = ev.target.value;
    drawCovers();
  });

  body.querySelector('#save').onclick = async () => {
    const made = body.querySelector('#made').checked;
    const date = body.querySelector('#mv-day').value;
    const meal = body.querySelector('#mv-meal').value;
    await updateEntry(start, e.id, { servings: stepperValue(body, 'servings'), made, date, meal });
    const before = lo.map((l) => `${l.date}|${l.meal}`).sort().join();
    const after = covers.map((c) => `${c}|${coverMeal}`).sort().join();
    if (before !== after) await setCovers(start, e.id, covers, coverMeal);
    sheet.close();
    if (made && !e.made && r) {
      r.lastMade = e.date;
      await db.put('recipes', r);
      // Take what was used out of the pantry, after a quick check.
      const servings = stepperValue(body, 'servings');
      setTimeout(() => openDeductSheet(r, servings) || toast('Saved'), 250);
      return;
    }
    toast('Saved');
  };
  body.querySelector('#rm').onclick = async () => {
    if (lo.length && !confirm('Remove this and its leftover days?')) return;
    await removeEntry(start, e.id);
    sheet.close();
  };
}
