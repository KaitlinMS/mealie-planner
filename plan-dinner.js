#!/usr/bin/env node

// ============================================================
// MEALIE DINNER PLANNER
// ============================================================
// Automatically generates weekly meal plans based on role tags
// (protein, starch, vegetable) assigned to recipes in Mealie.
//
// Usage:
//   node plan-dinner.js
//   node plan-dinner.js --start 2025-08-27 --days 7 --norepeat 5 --dry

import 'dotenv/config';

// ============================================================
// CONFIGURATION
// ============================================================

const BASE = process.env.MEALIE_BASE?.replace(/\/+$/, '');
const TOKEN = process.env.MEALIE_TOKEN;

if (!BASE || !TOKEN) {
    console.error('Please set MEALIE_BASE and MEALIE_TOKEN in .env.');
    process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
const START_DATE = args.start || process.env.START_DATE || today();
const DAYS = parseInt(args.days || process.env.DAYS || '7', 10);
const NO_REPEAT_DAYS = parseInt(args.norepeat || process.env.NO_REPEAT_DAYS || '5', 10);
const DRY_RUN = !!args.dry;

/** Maps role names to their tag slugs in Mealie */
const ROLE_TAGS = {
    protein: 'role:protein',
    starch:  'role:starch',
    veg:     'role:vegetable',
};

/** Will be populated with tag UUIDs after fetching from Mealie */
const ROLE_IDS = { protein: null, starch: null, veg: null };

/** Will be populated with category UUIDs after fetching from Mealie */
const CATEGORY_IDS = { dinner: null, side: null };

// ============================================================
// MAIN ENTRY POINT
// ============================================================

/**
 * Main function that orchestrates the meal planning process.
 * Fetches recipes, builds pools by role, and generates meal plan entries.
 */
async function main() {
    console.log(`[info] Base: ${BASE}`);
    console.log(`[info] Start: ${START_DATE}`);
    console.log(`[info] Days: ${DAYS}`);
    console.log(`[info] No repeat: ${NO_REPEAT_DAYS}`);
    console.log(`[info] Dry run: ${DRY_RUN}`);

    // 1) Get all recipes that have at least one of the role tags
    let roleRecipes = await getRoleLabeledRecipes();

    // 2) If list results don't include tags, hydrate per recipe
    const withRolesCount = roleRecipes.filter(recipe => recipe.roles.size > 0).length;
    if (withRolesCount === 0) {
        console.log('[info] No role tags on list results; hydrating recipes individually...');
        roleRecipes = await hydrateMissingRoles(roleRecipes);
    }
    console.log('[info] roleRecipes with roles:', roleRecipes.filter(recipe => recipe.roles.size > 0).length);

    // 3) Build pools by role
    const completePool = roleRecipes.filter(recipe =>
        recipe.roles.has(ROLE_TAGS.protein) &&
        recipe.roles.has(ROLE_TAGS.starch)  &&
        recipe.roles.has(ROLE_TAGS.veg)
    );
    const proteinPool = roleRecipes.filter(recipe => recipe.roles.has(ROLE_TAGS.protein));
    const starchPool  = roleRecipes.filter(recipe => recipe.roles.has(ROLE_TAGS.starch));
    const vegPool     = roleRecipes.filter(recipe => recipe.roles.has(ROLE_TAGS.veg));
    const dinnerOnly  = roleRecipes.filter(recipe => recipe.isDinner);

    console.log(`[info] Pools -> complete:${completePool.length} protein:${proteinPool.length} starch:${starchPool.length} veg:${vegPool.length} dinner only:${dinnerOnly.length}`);

    // 4) Build date list and recent window
    const dates = rangeDays(START_DATE, DAYS);
    const recentWindowStart = offsetDate(START_DATE, -NO_REPEAT_DAYS);
    const recentEntries = await listMealPlanRange(recentWindowStart, offsetDate(START_DATE, DAYS - 1));
    const recentDinnerRecipeIds = new Set(
        recentEntries
            .filter(entry => entry.entryType === 'dinner' && entry.recipe)
            .map(entry => entry.recipe.id)
    );

    // 5) Generate + (optionally) write meal plans
    for (const date of dates) {
        const chosen = await chooseDinnerForDate({
            date,
            completePool, proteinPool, starchPool, vegPool,
            recentDinnerRecipeIds,
        });

        if (!chosen || chosen.length === 0) {
            console.warn(`[warn] ${date}: No valid combination found. Skipping.`);
            continue;
        }

        console.log(`[debug] ${date} -> picks:`, chosen.map(item => item.name || item.title));

        const roles = new Set();
        for (const item of chosen) {
            const recipe = roleRecipes.find(rr => rr.id === item.recipeId);
            if (recipe) recipe.roles.forEach(role => roles.add(role));
        }
        console.log(`[debug] ${date} covers:`, Array.from(roles).join(', ') || '(none)');

        for (const item of chosen) {
            if (DRY_RUN) {
                console.log(`[dry] ${date} dinner ->`, item.recipeId ? item.name : `title=${item.title}`);
            } else {
                await createMealPlanEntry({
                    date,
                    entryType: 'dinner',
                    recipeId: item.recipeId || undefined,
                    title: item.title || undefined,
                });
                await sleep(120);
            }
        }
    }

    console.log('[done]');
}

// ============================================================
// CORE PLANNING LOGIC
// ============================================================

/**
 * Selects dinner recipes for a given date, trying to cover all three roles
 * (protein, starch, vegetable) while avoiding recently used recipes.
 *
 * @param {Object} ctx - Planning context
 * @param {string} ctx.date - The date to plan for (YYYY-MM-DD)
 * @param {Array} ctx.completePool - Recipes that cover all three roles
 * @param {Array} ctx.proteinPool - Recipes with protein role
 * @param {Array} ctx.starchPool - Recipes with starch role
 * @param {Array} ctx.vegPool - Recipes with vegetable role
 * @param {Set} ctx.recentDinnerRecipeIds - Recipe IDs used recently (to avoid)
 * @returns {Array<{recipeId: string}>} Array of chosen recipe references
 *
 * @example
 * const chosen = await chooseDinnerForDate({
 *   date: '2025-01-20',
 *   completePool: [...],
 *   proteinPool: [...],
 *   starchPool: [...],
 *   vegPool: [...],
 *   recentDinnerRecipeIds: new Set(['abc-123']),
 * });
 */
async function chooseDinnerForDate(ctx) {
    const { recentDinnerRecipeIds, completePool, proteinPool, starchPool, vegPool } = ctx;

    // Strategy 1: Try to find a complete meal (one recipe covering all roles)
    const completeMeal = trySelectCompleteMeal(completePool, recentDinnerRecipeIds);
    if (completeMeal) {
        return completeMeal;
    }

    // Strategy 2: Build a meal from multiple recipes to cover all roles
    const componentMeal = buildMealFromComponents(proteinPool, starchPool, vegPool, recentDinnerRecipeIds);
    return componentMeal;
}

/**
 * Attempts to select a single recipe that covers all three roles.
 *
 * @param {Array} completePool - Recipes with protein, starch, and veg roles
 * @param {Set} recentDinnerRecipeIds - Recently used recipe IDs to avoid
 * @returns {Array<{recipeId: string}>|null} Single-item array or null if none found
 */
function trySelectCompleteMeal(completePool, recentDinnerRecipeIds) {
    const candidates = shuffled(completePool).filter(recipe => !recentDinnerRecipeIds.has(recipe.id));
    if (candidates.length > 0) {
        const chosen = candidates[0];
        recentDinnerRecipeIds.add(chosen.id);
        return [{ recipeId: chosen.id, name: chosen.name }];
    }
    return null;
}

/**
 * Builds a complete meal from multiple recipes, each contributing different roles.
 * Uses a greedy algorithm that prefers recipes covering more needed roles,
 * and prefers "pure" single-role recipes when only one role remains.
 *
 * @param {Array} proteinPool - Recipes with protein role
 * @param {Array} starchPool - Recipes with starch role
 * @param {Array} vegPool - Recipes with vegetable role
 * @param {Set} recentDinnerRecipeIds - Recently used recipe IDs to avoid
 * @returns {Array<{recipeId: string}>} Array of chosen recipes (may be empty)
 */
function buildMealFromComponents(proteinPool, starchPool, vegPool, recentDinnerRecipeIds) {
    const neededRoles = new Set(['role:protein', 'role:starch', 'role:vegetable']);

    // Build universe of available recipes (not recently used)
    const universe = Array.from(new Map(
        [...proteinPool, ...starchPool, ...vegPool]
            .filter(recipe => !recentDinnerRecipeIds.has(recipe.id))
            .map(recipe => [recipe.id, recipe])
    ).values());

    const picks = [];
    const usedIds = new Set();

    while (neededRoles.size > 0) {
        const best = selectBestCandidate(universe, usedIds, neededRoles);
        if (!best) break;

        picks.push(best);
        usedIds.add(best.id);

        // Remove newly covered roles from needed set
        for (const role of best.roles) {
            if (neededRoles.has(role)) {
                neededRoles.delete(role);
            }
        }
    }

    // Require at least 2 roles covered to be considered a valid meal
    if (coveredRoles(picks).size >= 2) {
        for (const recipe of picks) {
            recentDinnerRecipeIds.add(recipe.id);
        }
        return picks.map(recipe => ({ recipeId: recipe.id, name: recipe.name }));
    }

    return [];
}

/**
 * Selects the best candidate recipe to add to the meal.
 * When multiple roles are needed, prefers recipes covering more roles.
 * When only one role remains, prefers "pure" single-role recipes.
 *
 * @param {Array} universe - All available recipes
 * @param {Set} usedIds - Already-used recipe IDs in this meal
 * @param {Set} neededRoles - Roles still needed
 * @returns {Object|null} Best recipe to add, or null if none available
 */
function selectBestCandidate(universe, usedIds, neededRoles) {
    // Find recipes that contribute at least one needed role
    const candidates = universe.filter(recipe =>
        !usedIds.has(recipe.id) && rolesGain(recipe, neededRoles) > 0
    );

    if (candidates.length === 0) return null;

    if (neededRoles.size === 1) {
        // When exactly one role remains, prefer "pure" single-role recipes
        const pureCandidates = candidates.filter(recipe => isPureForNeeded(recipe, neededRoles));

        if (pureCandidates.length > 0) {
            return pureCandidates[Math.floor(Math.random() * pureCandidates.length)];
        }

        // Fall back to recipes with fewest total roles
        const [neededRole] = [...neededRoles];
        const hasNeeded = candidates.filter(recipe => rolesHas(recipe, neededRole));
        hasNeeded.sort((a, b) => a.roles.size - b.roles.size || (Math.random() - 0.5));
        return hasNeeded[0];
    }

    // Multiple roles needed: prefer more coverage, then fewer extras
    candidates.sort((a, b) => byBestScore(a, b, neededRoles));
    return candidates[0];
}

// ============================================================
// ROLE HELPER FUNCTIONS
// ============================================================

/**
 * Checks if a recipe has a specific role.
 *
 * @param {Object} recipe - Recipe object with roles Set
 * @param {string} role - Role string to check for
 * @returns {boolean} True if recipe has the role
 */
function rolesHas(recipe, role) {
    return recipe.roles && recipe.roles.has(role);
}

/**
 * Counts how many of the needed roles this recipe provides.
 *
 * @param {Object} recipe - Recipe object with roles Set
 * @param {Set} neededRoles - Set of roles still needed
 * @returns {number} Count of needed roles this recipe provides
 *
 * @example
 * const gain = rolesGain(recipe, new Set(['role:protein', 'role:starch']));
 * // Returns 2 if recipe has both roles, 1 if only one, 0 if neither
 */
function rolesGain(recipe, neededRoles) {
    let count = 0;
    for (const role of recipe.roles) {
        if (neededRoles.has(role)) count++;
    }
    return count;
}

/**
 * Checks if a recipe is "pure" for the needed role - meaning it has
 * exactly one role and that role is one we need.
 *
 * @param {Object} recipe - Recipe object with roles Set
 * @param {Set} neededRoles - Set of roles still needed
 * @returns {boolean} True if recipe has exactly one role that is needed
 */
function isPureForNeeded(recipe, neededRoles) {
    return recipe.roles.size === 1 && rolesGain(recipe, neededRoles) === 1;
}

/**
 * Comparison function for sorting recipes by "best" score.
 * Prefers recipes covering more needed roles, then fewer total roles.
 *
 * @param {Object} a - First recipe to compare
 * @param {Object} b - Second recipe to compare
 * @param {Set} neededRoles - Roles still needed
 * @returns {number} Negative if a is better, positive if b is better
 */
function byBestScore(a, b, neededRoles) {
    const gainA = rolesGain(a, neededRoles);
    const gainB = rolesGain(b, neededRoles);
    if (gainA !== gainB) return gainB - gainA;
    if (a.roles.size !== b.roles.size) return a.roles.size - b.roles.size;
    return Math.random() - 0.5;
}

/**
 * Collects all roles covered by a set of picked recipes.
 *
 * @param {Array} picks - Array of recipe objects
 * @returns {Set} Set of all roles covered
 */
function coveredRoles(picks) {
    const covered = new Set();
    for (const recipe of picks) {
        for (const role of recipe.roles) {
            covered.add(role);
        }
    }
    return covered;
}

/**
 * Counts how many elements are in both sets.
 *
 * @param {Set} setA - First set
 * @param {Set} setB - Second set
 * @returns {number} Count of elements in both sets
 */
function countIntersect(setA, setB) {
    let count = 0;
    for (const value of setA) {
        if (setB.has(value)) count++;
    }
    return count;
}

// ============================================================
// API FUNCTIONS
// ============================================================

/**
 * Fetches all tag objects from Mealie and returns them indexed by ID, slug, and name.
 *
 * @returns {Promise<{list: Array, byKey: Map}>} Tag list and lookup map
 */
async function getTagObjects() {
    const url = `${BASE}/api/organizers/tags?perPage=500&page=1`;
    const data = await apiGET(url);
    const items = data?.items || data || [];
    const byKey = new Map();
    for (const tag of items) {
        if (tag.id)   byKey.set(tag.id, tag);
        if (tag.slug) byKey.set(tag.slug, tag);
        if (tag.name) byKey.set(tag.name, tag);
    }
    return { list: items, byKey };
}

/**
 * Fetches all category objects from Mealie.
 *
 * @returns {Promise<{list: Array}>} Category list
 */
async function getCategoryObjects() {
    const url = `${BASE}/api/organizers/categories?perPage=500&page=1`;
    const data = await apiGET(url);
    const items = data?.items || data || [];
    return { list: items };
}

/**
 * Fetches all recipes that have at least one role tag (protein, starch, or vegetable).
 * Also resolves the role tag IDs and category IDs for later use.
 *
 * @returns {Promise<Array>} Array of slim recipe objects with roles
 */
async function getRoleLabeledRecipes() {
    // Resolve role tag IDs once
    const { list } = await getTagObjects();
    const findTagId = name =>
        (list.find(tag => tag.slug === name) || list.find(tag => tag.name === name))?.id;

    const { list: categoryList } = await getCategoryObjects();
    const dinnerCat = categoryList.find(category =>
        (category.slug?.toLowerCase() === 'dinner') || (category.name?.toLowerCase() === 'dinner')
    );
    const sideCat = categoryList.find(category =>
        (category.slug?.toLowerCase() === 'side') || (category.name?.toLowerCase() === 'side') ||
        (category.slug?.toLowerCase() === 'sides') || (category.name?.toLowerCase() === 'sides')
    );
    CATEGORY_IDS.dinner = dinnerCat?.id || CATEGORY_IDS.dinner;
    CATEGORY_IDS.side = sideCat?.id || CATEGORY_IDS.side;

    const proteinId = findTagId(ROLE_TAGS.protein);
    const starchId  = findTagId(ROLE_TAGS.starch);
    const vegId     = findTagId(ROLE_TAGS.veg);

    ROLE_IDS.protein = proteinId || ROLE_IDS.protein;
    ROLE_IDS.starch  = starchId  || ROLE_IDS.starch;
    ROLE_IDS.veg     = vegId     || ROLE_IDS.veg;

    const allRecipes = [];
    for (const tagId of [proteinId, starchId, vegId].filter(Boolean)) {
        const batch = await getRecipesByTagIds([tagId]);
        allRecipes.push(...batch);
    }

    // De-duplicate by recipe id
    const deduped = Array.from(new Map(allRecipes.map(recipe => [recipe.id, recipe])).values());
    return deduped;
}

/**
 * Fetches recipes from Mealie filtered by tag IDs.
 *
 * @param {Array<string>} tagIds - Tag UUIDs to filter by
 * @returns {Promise<Array>} Array of slim recipe objects
 */
async function getRecipesByTagIds(tagIds) {
    const url = new URL(`${BASE}/api/recipes`);
    for (const id of tagIds) url.searchParams.append('tags', id);
    // Include both dinner and side categories so we can build complete meals
    if (CATEGORY_IDS.dinner) url.searchParams.append('categories', CATEGORY_IDS.dinner);
    if (CATEGORY_IDS.side) url.searchParams.append('categories', CATEGORY_IDS.side);
    url.searchParams.set('perPage', '200');
    // Try to include/expand tags if supported (ignored if not)
    url.searchParams.set('include', 'tags');
    url.searchParams.set('expand', 'tags');

    const results = [];
    let page = 1;
    while (true) {
        url.searchParams.set('page', String(page));
        const data = await apiGET(url.toString());
        const items = data?.items || data || [];
        const slims = await Promise.all(items.map(item => slimRecipeAsync(item, false)));
        results.push(...slims);
        if (!data?.total || results.length >= data.total || items.length === 0) break;
        page += 1;
    }
    return results;
}

/**
 * Hydrates recipes that came back without tags/roles by fetching each full recipe.
 *
 * @param {Array} recipes - Array of recipe objects to hydrate
 * @param {number} concurrency - Number of concurrent requests
 * @returns {Promise<Array>} Hydrated recipe objects
 */
async function hydrateMissingRoles(recipes, concurrency = 5) {
    const results = [];
    const workQueue = [...recipes];
    const workers = Array.from({ length: concurrency }, async () => {
        while (workQueue.length) {
            const recipe = workQueue.shift();
            if (recipe.roles && recipe.roles.size > 0) {
                results.push(recipe);
                continue;
            }
            try {
                const full = await apiGET(`${BASE}/api/recipes/${encodeURIComponent(recipe.id)}`);
                results.push(await slimRecipeAsync(full, true));
            } catch {
                results.push(recipe);
            }
        }
    });
    await Promise.all(workers);
    return results;
}

/**
 * Fetches meal plan entries for a date range.
 *
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {Promise<Array>} Array of meal plan entries
 */
async function listMealPlanRange(startDate, endDate) {
    const url = new URL(`${BASE}/api/households/mealplans`);
    url.searchParams.set('start_date', startDate);
    url.searchParams.set('end_date', endDate);
    url.searchParams.set('perPage', '200');
    const data = await apiGET(url.toString());
    const items = data?.items || data || [];
    return items;
}

/**
 * Creates a new meal plan entry in Mealie.
 *
 * @param {Object} params - Entry parameters
 * @param {string} params.date - Date for the entry (YYYY-MM-DD)
 * @param {string} params.entryType - Type of meal (e.g., 'dinner')
 * @param {string} [params.recipeId] - Recipe UUID to link
 * @param {string} [params.title] - Text title if no recipe
 * @returns {Promise<Object>} Created entry
 */
async function createMealPlanEntry({ date, entryType, recipeId, title }) {
    const body = { date, entryType };
    if (recipeId) body.recipeId = recipeId;
    if (title)    body.title = title;
    return apiPOST(`${BASE}/api/households/mealplans`, body);
}

// ============================================================
// HTTP HELPERS
// ============================================================

/**
 * Makes an authenticated GET request to the Mealie API.
 *
 * @param {string} url - Full URL to fetch
 * @returns {Promise<Object>} Parsed JSON response
 * @throws {Error} If response is not OK
 */
async function apiGET(url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    return res.json();
}

/**
 * Makes an authenticated POST request to the Mealie API.
 *
 * @param {string} url - Full URL to post to
 * @param {Object} body - Request body (will be JSON stringified)
 * @returns {Promise<Object>} Parsed JSON response
 * @throws {Error} If response is not OK
 */
async function apiPOST(url, body) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`POST ${url} -> ${res.status} ${text}`);
    }
    return res.json().catch(() => ({}));
}

// ============================================================
// UTILITIES
// ============================================================

/**
 * Parses command-line arguments into an options object.
 *
 * @param {Array<string>} argv - Array of command-line arguments
 * @returns {Object} Parsed arguments {start, days, norepeat, dry}
 *
 * @example
 * parseArgs(['--start', '2025-01-20', '--days', '7', '--dry'])
 * // Returns { start: '2025-01-20', days: '7', dry: true }
 */
function parseArgs(argv) {
    const result = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--start') result.start = argv[++i];
        else if (arg === '--days') result.days = argv[++i];
        else if (arg === '--norepeat') result.norepeat = argv[++i];
        else if (arg === '--dry') result.dry = true;
    }
    return result;
}

/**
 * Returns today's date in YYYY-MM-DD format.
 *
 * @returns {string} Today's date
 */
function today() {
    const d = new Date();
    return d.toISOString().slice(0, 10);
}

/**
 * Adds or subtracts days from a date string.
 *
 * @param {string} yyyyMmDd - Date string in YYYY-MM-DD format
 * @param {number} deltaDays - Number of days to add (negative to subtract)
 * @returns {string} New date in YYYY-MM-DD format
 *
 * @example
 * offsetDate('2025-01-15', 3)  // Returns '2025-01-18'
 * offsetDate('2025-01-15', -2) // Returns '2025-01-13'
 */
function offsetDate(yyyyMmDd, deltaDays) {
    const d = new Date(yyyyMmDd + 'T00:00:00');
    d.setDate(d.getDate() + deltaDays);
    return d.toISOString().slice(0, 10);
}

/**
 * Generates an array of consecutive dates starting from a given date.
 *
 * @param {string} start - Start date in YYYY-MM-DD format
 * @param {number} count - Number of days to generate
 * @returns {Array<string>} Array of date strings
 *
 * @example
 * rangeDays('2025-01-15', 3) // Returns ['2025-01-15', '2025-01-16', '2025-01-17']
 */
function rangeDays(start, count) {
    return Array.from({ length: count }, (_, i) => offsetDate(start, i));
}

/**
 * Shuffles an array using Fisher-Yates-like randomization.
 *
 * @param {Array} arr - Array to shuffle
 * @returns {Array} New shuffled array (original unchanged)
 */
function shuffled(arr) {
    return [...arr].sort(() => Math.random() - 0.5);
}

/**
 * Returns a promise that resolves after a delay.
 *
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// TAG EXTRACTION HELPERS (Mealie 3.x compatibility)
// ============================================================

/**
 * Extracts tag IDs from various shapes of recipe objects.
 * Handles multiple Mealie API response formats.
 *
 * @param {Object} recipe - Recipe object from Mealie API
 * @returns {Array<string>} Array of tag ID strings
 */
function extractTagIdsFromAnyShape(recipe) {
    const ids = new Set();

    // A) recipe.tags = [{ id, slug, name }]
    if (Array.isArray(recipe.tags)) {
        for (const tag of recipe.tags) {
            if (tag?.id) ids.add(String(tag.id));
        }
    }

    // B) recipe.recipeTags = [{ id, ... }] OR [{ tag: { id, ... } }]
    if (Array.isArray(recipe.recipeTags)) {
        for (const tag of recipe.recipeTags) {
            if (tag?.id) ids.add(String(tag.id));
            if (tag?.tag?.id) ids.add(String(tag.tag.id));
        }
    }

    // C) odd shapes sometimes appear
    for (const obj of [recipe.recipe_tag, recipe.tag]) {
        if (Array.isArray(obj)) {
            for (const tag of obj) {
                if (tag?.id) ids.add(String(tag.id));
                if (tag?.tag?.id) ids.add(String(tag.tag.id));
            }
        }
    }

    return Array.from(ids);
}

/**
 * Extracts tag slugs/names as lowercase strings from various recipe shapes.
 *
 * @param {Object} recipe - Recipe object from Mealie API
 * @returns {Array<string>} Array of lowercase tag strings
 */
function extractTagStringsFromAnyShape(recipe) {
    const strings = new Set();

    if (Array.isArray(recipe.tags)) {
        for (const tag of recipe.tags) {
            const str = (typeof tag === 'string' ? tag : (tag?.slug || tag?.name || '')).toLowerCase();
            if (str) strings.add(str);
        }
    }
    if (Array.isArray(recipe.recipeTags)) {
        for (const tag of recipe.recipeTags) {
            const str = (tag?.slug || tag?.name || tag?.tag?.slug || tag?.tag?.name || '').toLowerCase();
            if (str) strings.add(str);
        }
    }
    for (const obj of [recipe.recipe_tag, recipe.tag]) {
        if (Array.isArray(obj)) {
            for (const tag of obj) {
                const str = (tag?.slug || tag?.name || tag?.tag?.slug || tag?.tag?.name || '').toLowerCase();
                if (str) strings.add(str);
            }
        }
    }

    return Array.from(strings);
}

/**
 * Collects tag strings from a recipe, optionally fetching from API if none found.
 *
 * @param {Object} recipe - Recipe object
 * @param {boolean} allowFetch - Whether to fetch tags from API as fallback
 * @returns {Promise<Array<string>>} Array of lowercase tag strings
 */
async function collectTagStrings(recipe, allowFetch = false) {
    const strings = new Set();

    // A) recipe.tags = [{ slug, name }]
    if (Array.isArray(recipe.tags)) {
        for (const tag of recipe.tags) {
            const str = (tag?.slug || tag?.name || '').toLowerCase();
            if (str) strings.add(str);
        }
    }

    // B) recipe.recipeTags = [{ slug, name }] OR [{ tag: { slug, name } }]
    if (Array.isArray(recipe.recipeTags)) {
        for (const tag of recipe.recipeTags) {
            const str = (tag?.slug || tag?.name || tag?.tag?.slug || tag?.tag?.name || '').toLowerCase();
            if (str) strings.add(str);
        }
    }

    // C) odd shapes sometimes appear
    for (const obj of [recipe.recipe_tag, recipe.tag]) {
        if (Array.isArray(obj)) {
            for (const tag of obj) {
                const str = (tag?.slug || tag?.name || tag?.tag?.slug || tag?.tag?.name || '').toLowerCase();
                if (str) strings.add(str);
            }
        }
    }

    // D) fallback: GET /api/recipes/{id}/tags
    if (strings.size === 0 && allowFetch && recipe.id) {
        try {
            const tags = await apiGET(`${BASE}/api/recipes/${encodeURIComponent(recipe.id)}/tags`);
            if (Array.isArray(tags)) {
                for (const tag of tags) {
                    const str = (tag?.slug || tag?.name || '').toLowerCase();
                    if (str) strings.add(str);
                }
            }
        } catch {
            // Ignore fetch errors
        }
    }

    return Array.from(strings);
}

/**
 * Creates a slim recipe object with role information.
 * Handles various Mealie API response formats.
 *
 * @param {Object} recipe - Full recipe object from API
 * @param {boolean} allowFetch - Whether to fetch tags from API as fallback
 * @returns {Promise<Object>} Slim recipe with id, name, roles Set, and isDinner boolean
 */
async function slimRecipeAsync(recipe, allowFetch = false) {
    // 1) Try IDs from the object we already have
    let tagIds = extractTagIdsFromAnyShape(recipe);

    // 2) If none and we're allowed, fetch /recipes/{id}/tags (3.1.0 supports this)
    if (tagIds.length === 0 && allowFetch && recipe.id) {
        try {
            const tags = await apiGET(`${BASE}/api/recipes/${encodeURIComponent(recipe.id)}/tags`);
            if (Array.isArray(tags)) {
                tagIds = tags.map(tag => String(tag?.id)).filter(Boolean);
            }
        } catch {
            // Ignore fetch errors
        }
    }

    // 3) Build roles via ID membership
    const roles = new Set();
    const hasId = id => id && tagIds.includes(String(id));
    if (hasId(ROLE_IDS.protein)) roles.add(ROLE_TAGS.protein);
    if (hasId(ROLE_IDS.starch))  roles.add(ROLE_TAGS.starch);
    if (hasId(ROLE_IDS.veg))     roles.add(ROLE_TAGS.veg);

    // 4) Fallback to string names/slugs if IDs didn't resolve any role
    if (roles.size === 0) {
        const tagStrings = extractTagStringsFromAnyShape(recipe);
        const normalize = str => str?.toLowerCase().replace(/\s+/g, '');
        const stringSet = new Set(tagStrings.map(normalize));
        if (stringSet.has(normalize(ROLE_TAGS.protein))) roles.add(ROLE_TAGS.protein);
        if (stringSet.has(normalize(ROLE_TAGS.starch)))  roles.add(ROLE_TAGS.starch);
        if (stringSet.has(normalize(ROLE_TAGS.veg)))     roles.add(ROLE_TAGS.veg);
    }

    // 5) Store categories
    const categories = (recipe.categories || []).map(cat => (cat.slug || cat.name || '').toLowerCase());
    const isDinner = categories.includes('dinner');

    return {
        id:   recipe.id || recipe.slug || recipe.uid || recipe.recipeId || recipe._id,
        name: recipe.name || recipe.title || recipe.recipeName || '',
        roles,
        isDinner,
    };
}

// ============================================================
// RUN MAIN
// ============================================================

main().catch(err => {
    console.error('[fatal]', err);
    process.exit(1);
});

// ============================================================
// TEST EXPORTS
// ============================================================
// These exports allow unit testing of pure functions without
// needing to mock the Mealie API.

export const _testExports = {
    parseArgs,
    today,
    offsetDate,
    rangeDays,
    shuffled,
    rolesGain,
    isPureForNeeded,
    byBestScore,
    coveredRoles,
    countIntersect,
    trySelectCompleteMeal,
    buildMealFromComponents,
};
