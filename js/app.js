// App shell: hash router, tab bar, and live refresh when data changes.
import * as db from './db.js';
import { listView, detailView, editView } from './views/recipes.js';
import { planView } from './views/plan.js';
import { shopView } from './views/shop.js';
import { addView, reviewView } from './views/add.js';
import { moreView, notesHelpView, keepHelpView, shortcutsHelpView } from './views/more.js';
import { startSync } from './cloud.js';
import { pantryView } from './views/pantry.js';

const D = '(\\d{4}-\\d{2}-\\d{2})';
const ROUTES = [
  [/^\/recipes$/, listView, 'recipes'],
  [/^\/recipe\/new$/, (el) => editView(el, null), 'recipes'],
  [/^\/recipe\/([\w-]+)\/edit$/, editView, 'recipes'],
  [/^\/recipe\/([\w-]+)$/, detailView, 'recipes'],
  [new RegExp(`^/plan(?:/${D})?$`), planView, 'plan'],
  [new RegExp(`^/shop(?:/${D})?$`), shopView, 'shop'],
  [/^\/add$/, addView, 'recipes'],
  [/^\/inbox\/([\w-]+)$/, reviewView, 'recipes'],
  [/^\/pantry$/, pantryView, 'pantry'],
  [/^\/more$/, moreView, 'more'],
  [/^\/help\/notes$/, notesHelpView, 'more'],
  [/^\/help\/keep$/, keepHelpView, 'more'],
  [/^\/help\/shortcuts$/, shortcutsHelpView, 'more'],
];

const main = document.getElementById('main');
let current = null;

function route() {
  const hash = location.hash.slice(1) || '/plan';
  const [path, query] = hash.split('?');
  const params = Object.fromEntries(new URLSearchParams(query || ''));
  const match = ROUTES.find(([re]) => re.test(path));
  if (!match) {
    location.replace('#/plan');
    return;
  }
  const [re, view, tab] = match;
  const args = path.match(re).slice(1);

  // A fresh container per screen, so event listeners never pile up.
  const el = document.createElement('div');
  el.className = 'view';
  main.replaceChildren(el);
  window.scrollTo(0, 0);
  current = view(el, ...args, params) || null;

  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
}

db.onChange((store) => current?.refresh?.(store));

const NEW_HOME = 'https://meal-planner-pwg.web.app/';

(async function start() {
  await db.init();
  window.addEventListener('hashchange', route);
  route();
  if (location.hostname.endsWith('github.io')) {
    // The app moved to Firebase Hosting so Google sign-in works on iPhone.
    const b = document.createElement('div');
    b.className = 'moved';
    b.innerHTML = `<b>Meals has moved.</b> Open <a href="${NEW_HOME}">${NEW_HOME.replace('https://', '').replace(/\/$/, '')}</a> in Safari and add it to your Home Screen.
      Already added recipes here? Tap More → Export backup first, then More → Restore in the new app.`;
    document.body.prepend(b);
  } else {
    startSync();
  }
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    // When an update takes over, reload once so the whole app is the new version.
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !document.querySelector('.sheet-wrap')) location.reload();
    });
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();
