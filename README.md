# Meal Planner

A personal recipe box, weekly meal planner and shopping list, built to live on an iPhone home screen.
Plain HTML/CSS/JavaScript: no build step, so the folder can be uploaded to GitHub Pages as is.

## What's in phase 1

- **Recipes:** add, edit, search (title, ingredients, tags, notes), categories, tags, ratings, a servings scaler
- **Add:** paste text or a link, bulk import (Apple Notes / Keep), manual entry; an Inbox to review imports with duplicate warnings
- **Plan:** Sunday–Saturday weeks; breakfast/lunch/dinner on any day; per-meal default servings (1 / 1 / 3);
  batches whose leftovers cover later days (or another meal, like dinner → next-day lunch); "Not needed" (eating out, etc.); a "Made it" checkbox
- **Shop:** built from the plan with ingredients scaled, combined across recipes and unit-converted (1 qt + 2 cups → 6 cups), grouped by aisle;
  check-offs survive plan changes; manual items, staples, and share/copy
- **More:** default servings, staples, categories, never-buy list, link helper, backup and restore

Data is stored on the device (IndexedDB) until Firebase sync is added.

## Files

| Path | What it is |
|---|---|
| `index.html`, `css/app.css` | App shell and styles |
| `js/app.js` | Router and tab bar |
| `js/db.js` | Local storage layer |
| `js/units.js`, `js/ingredients.js`, `js/aisles.js` | Quantity/unit parsing, conversion, aisle guessing |
| `js/parser.js` | Recipe parsing from text and from recipe web pages |
| `js/model.js` | Recipes, weekly plans, shopping list logic |
| `js/views/*` | Screens |
| `sw.js`, `manifest.webmanifest`, `icons/` | Home-screen app and offline support |
| `worker/recipe-helper.js` | Cloudflare Worker for link imports (and later the AI features) |
| `tools/serve.ps1` | Local preview server on Windows |

## Preview on this PC

```
powershell -ExecutionPolicy Bypass -File tools\serve.ps1 -Root . -Port 8765
```
Then open http://localhost:8765.

## Put it on the iPhone (GitHub Pages)

App address: **https://pwgreathouse.github.io/meal-planner/**

1. Sign in at github.com, click **＋ → New repository**. Name it `meal-planner`, choose **Public**
   (free GitHub Pages needs a public repo; only the app's code is public, never your recipes), and click **Create repository**.
2. On the new repo's page click **uploading an existing file**. Open this project folder in File Explorer, select everything
   inside it **except** the `.claude` folder, and drag it onto the page. Click **Commit changes**.
3. Go to **Settings → Pages**. Under *Build and deployment*, set Source to **Deploy from a branch**, Branch to **main** and **/ (root)**, then **Save**.
4. Wait a minute or two until the Pages screen shows the live address.
5. On the iPhone, open that address in **Safari**, tap **Share → Add to Home Screen**, then open it from the new home-screen icon.

To update later: upload the changed files the same way (same names overwrite), and the app picks them up next time it opens.

## Next phases

2. Firebase sync and sign-in, Pantry (shopping → pantry → deduct when cooked, toss), iOS share-sheet Shortcut
3. AI: screenshots, messy-text cleanup, pantry-based and web suggestions, nutrition and macros
4. Email import, barcode scanning, cost tracking
