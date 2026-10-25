# Meal Planner

A personal recipe box, weekly meal planner and shopping list, built to live on an iPhone home screen.
Plain HTML/CSS/JavaScript with no build step. Free to run: Firebase (Spark plan) and a Cloudflare Worker (free plan); no paid APIs.

**App:** https://meal-planner-pwg.web.app

## Features

- **Recipes:** search (title, ingredients, tags, notes), categories, ratings, servings scaler, "Add to plan", "Add to list".
  Entry is row by row: amount, unit picker, ingredient (with suggestions); numbered steps with reorder; "Paste a list" for either.
  Only the title is required.
- **Add:** type a recipe in, or paste a recipe website link (read through the Worker and the page's structured recipe data).
  Imports wait under "To review" until checked and saved.
- **Plan:** Sunday–Saturday weeks; breakfast/lunch/dinner on any day; default servings per meal; batches whose leftovers
  cover later days; "Not needed" (eating out, etc.); "Made it". "＋ Add to list" adds the week's meals to the shopping list.
- **List:** one running list. Type any item ("milk", "2 lb chicken"), tap staples, or add a week's meals: ingredients are
  scaled, combined with what's already on the list (1 qt + 2 cups → 6 cups), and grouped by aisle. Items in the Pantry are skipped.
- **Pantry:** a plain list of what's on hand, edited by hand.
- **Sync:** Google sign-in; everything syncs through Firestore under `users/{uid}/…`; works offline. Rules allow only the owner.

## Files

| Path | What it is |
|---|---|
| `index.html`, `css/app.css` | App shell and styles |
| `js/app.js` | Router and tab bar |
| `js/db.js` | Local storage (IndexedDB) with sync hooks |
| `js/cloud.js`, `js/sync.js` | Firebase sign-in and two-way sync |
| `js/units.js`, `js/ingredients.js`, `js/aisles.js` | Quantity/unit parsing, conversion, aisle guessing |
| `js/parser.js` | Reading recipes from web pages |
| `js/model.js` | Recipes, weekly plans, shopping list |
| `js/pantry.js` | Pantry |
| `js/views/*` | Screens |
| `sw.js`, `manifest.webmanifest`, `icons/` | Home-screen app and offline support |
| `firebase.json`, `.firebaserc`, `firestore.rules` | Hosting and database rules |
| `worker/` | Cloudflare Worker that fetches recipe pages for link import |
| `tools/serve.ps1` | Local preview server on Windows |

## Deploying

```
powershell -ExecutionPolicy Bypass -File toolsdeploy.ps1
```
This stamps a new version into `version.json`, `js/version.js` and the service worker cache name, then deploys hosting.
Open copies of the app check `version.json` whenever they come back on screen and refresh themselves (or offer to, mid-edit).
Database rules: `.
ode_modules.binirebase.cmd deploy --only firestore:rules`.
Worker (from `worker/`): `npx.cmd wrangler deploy`. Its access code is a Worker secret (`APP_TOKEN`), not in this repo.
