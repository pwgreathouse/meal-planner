# Meal Planner

A personal recipe box, weekly meal planner and shopping list, built to live on an iPhone home screen.
Plain HTML/CSS/JavaScript with no build step.

**App:** https://meal-planner-pwg.web.app (Firebase Hosting). The old GitHub Pages address shows a "moved" notice.

## Features so far

- **Recipes:** add, edit, search (title, ingredients, tags, notes), categories, tags, ratings, a servings scaler
- **Add:** paste text or a link, bulk import (Apple Notes / Keep), manual entry; an Inbox to review imports with duplicate warnings.
  Re-running the Apple Notes import only brings in new notes, and notes edited in Notes show a change list before updating.
- **Links:** fetched through a private Cloudflare Worker (`worker/`), parsed from the site's structured recipe data
- **Plan:** Sunday–Saturday weeks; breakfast/lunch/dinner on any day; per-meal default servings (1 / 1 / 3);
  batches whose leftovers cover later days (or another meal, like dinner → next-day lunch); "Not needed" (eating out, etc.); a "Made it" checkbox
- **Shop:** built from the plan with ingredients scaled, combined across recipes and unit-converted (1 qt + 2 cups → 6 cups), grouped by aisle;
  check-offs survive plan changes; manual items, staples, and share/copy
- **Sync:** Google sign-in; every record syncs to Firestore under `users/{uid}/…`, newest change wins, deletions sync too.
  The app reads from the device (IndexedDB) first, so it works offline. Database rules allow only the owner's account.
- **More:** account & sync, default servings, staples, categories, never-buy list, link helper, backup and restore

## Files

| Path | What it is |
|---|---|
| `index.html`, `css/app.css` | App shell and styles |
| `js/app.js` | Router and tab bar |
| `js/db.js` | Local storage layer (IndexedDB) with sync hooks and deletion tombstones |
| `js/cloud.js`, `js/sync.js` | Loads Firebase on demand; sign-in and two-way sync |
| `js/units.js`, `js/ingredients.js`, `js/aisles.js` | Quantity/unit parsing, conversion, aisle guessing |
| `js/parser.js`, `js/importlog.js` | Recipe parsing from text and web pages; Apple Notes re-import fingerprints |
| `js/model.js` | Recipes, weekly plans, shopping list logic |
| `js/views/*` | Screens |
| `sw.js`, `manifest.webmanifest`, `icons/` | Home-screen app and offline support |
| `firebase.json`, `.firebaserc`, `firestore.rules` | Firebase Hosting and database rules |
| `worker/` | Cloudflare Worker for link imports (and later the AI features) |
| `tools/serve.ps1` | Local preview server on Windows |

## Deploying

```
.\node_modules\.bin\firebase.cmd deploy --only hosting,firestore:rules
```
Link helper (from `worker/`): `npx.cmd wrangler deploy`. Its access code is a Worker secret (`APP_TOKEN`) and is not in this repo.

## Preview on this PC

```
powershell -ExecutionPolicy Bypass -File tools\serve.ps1 -Root . -Port 8765
```
Then open http://localhost:8765.

## Next phases

- Pantry (shopping → pantry → deduct when cooked, toss), iOS share-sheet Shortcut, screenshot Shortcut (on-device text recognition)
- AI: screenshots, messy-text cleanup, pantry-based and web suggestions, nutrition and macros
- Email import, barcode scanning, cost tracking
