// User preferences, stored as a single record in the settings store.
import * as db from './db.js';

export const MEALS = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch', label: 'Lunch' },
  { key: 'dinner', label: 'Dinner' },
];

export const AISLES = [
  'Produce',
  'Meat & Seafood',
  'Dairy & Eggs',
  'Bakery & Bread',
  'Pantry',
  'Baking & Spices',
  'Condiments & Sauces',
  'Frozen',
  'Snacks',
  'Beverages',
  'Household',
  'Other',
];

const DEFAULTS = {
  id: 'prefs',
  servings: { breakfast: 1, lunch: 1, dinner: 3 },
  categories: [
    'Breakfast',
    'Lunch',
    'Dinner',
    'Soups & Stews',
    'Salads',
    'Sides',
    'Snacks',
    'Desserts',
    'Breads & Baking',
    'Drinks',
    'Sauces & Dressings',
    'Other',
  ],
  staples: ['Milk', 'Eggs', 'Coffee', 'Bread', 'Bananas'],
  neverBuy: ['water', 'ice', 'hot water', 'cold water', 'warm water', 'boiling water'],
  aisleOverrides: {},
  fetchProxyUrl: '',
  fetchProxyToken: '',
};

export function getPrefs() {
  const saved = db.get('settings', 'prefs') || {};
  return {
    ...structuredClone(DEFAULTS),
    ...saved,
    servings: { ...DEFAULTS.servings, ...(saved.servings || {}) },
  };
}

export async function savePrefs(patch) {
  const next = { ...getPrefs(), ...patch, id: 'prefs' };
  await db.put('settings', next);
  return next;
}
