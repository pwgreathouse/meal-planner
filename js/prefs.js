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
  // Assumed on hand when ranking "cook from what you have".
  basics: ['salt', 'kosher salt', 'black pepper', 'pepper', 'salt and pepper', 'olive oil', 'vegetable oil', 'oil', 'sugar', 'flour', 'all-purpose flour'],
  purchaseSizes: {}, // ingredient key -> last amount put away, e.g. "1 qt"
  aisleOverrides: {},
  aiModel: 'claude-opus-5-5',
  goals: { calories: 0, protein: 0 }, // daily targets; 0 = not set
  fetchProxyUrl: '',
  fetchProxyToken: '',
};

export function getPrefs() {
  const saved = db.get('settings', 'prefs') || {};
  return {
    ...structuredClone(DEFAULTS),
    ...saved,
    servings: { ...DEFAULTS.servings, ...(saved.servings || {}) },
    goals: { ...DEFAULTS.goals, ...(saved.goals || {}) },
  };
}

export async function savePrefs(patch) {
  const next = { ...getPrefs(), ...patch, id: 'prefs' };
  await db.put('settings', next);
  return next;
}
