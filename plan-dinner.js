#!/usr/bin/env node
// Usage:
//   node plan-dinners.js
//   node plan-dinners.js --start 2025-08-27 --days 7 --norepeat 5 --dry

import 'dotenv/config';

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

const ROLE_TAGS = {
    protein: 'role:protein',
    starch:  'role:starch',
    veg:     'role:vegetable',
};

const ROLE_IDS = { protein: null, starch: null, veg: null };

const CATEGORY_IDS = { dinner: null };

async function main() {
    console.log(`[info] Base: ${BASE}`);
    console.log(`[info] Start: ${START_DATE}`);
    console.log(`[info] Days: ${DAYS}`);
    console.log(`[info] No repeat: ${NO_REPEAT_DAYS}`);
    console.log(`[info] Dry run: ${DRY_RUN}`);

    // 1) Get all recipes that have at least one of the role tags (by ID)
    let roleRecipes = await getRoleLabeledRecipes();

    // 2) If list results don't include tags, hydrate per recipe
    const withRolesCount = roleRecipes.filter(r => r.roles.size > 0).length;
    if (withRolesCount === 0) {
        console.log('[info] No role tags on list results; hydrating recipes individually…');
        roleRecipes = await hydrateMissingRoles(roleRecipes);
    }
    console.log('[info] roleRecipes with roles:', roleRecipes.filter(r => r.roles.size > 0).length);

    // quick probe of one raw recipe to see where Mealie 3.1.0 exposes tags in your instance
    if (roleRecipes.length) {
        try {
            const raw = await apiGET(`${BASE}/api/recipes/${encodeURIComponent(roleRecipes[0].id)}`);
            console.log('[probe] raw keys:', Object.keys(raw));
            console.log('[probe] tag fields present:', {
                has_tags: Array.isArray(raw.tags),
                has_recipeTags: Array.isArray(raw.recipeTags),
                recipeTags_inner_tag: Array.isArray(raw.recipeTags) && !!raw.recipeTags[0]?.tag,
            });
            if (Array.isArray(raw.tags) && raw.tags.length) {
                console.log('[probe] sample raw.tags[0]:', raw.tags[0]);  // should show { id, name, slug, ... }
            }
        } catch {}
    }

    const completePool = roleRecipes.filter(r =>
        r.roles.has(ROLE_TAGS.protein) &&
        r.roles.has(ROLE_TAGS.starch)  &&
        r.roles.has(ROLE_TAGS.veg)
    );
    const proteinPool = roleRecipes.filter(r => r.roles.has(ROLE_TAGS.protein));
    const starchPool  = roleRecipes.filter(r => r.roles.has(ROLE_TAGS.starch));
    const vegPool     = roleRecipes.filter(r => r.roles.has(ROLE_TAGS.veg));
    const dinnerOnly  = roleRecipes.filter(r => r.isDinner);

    console.log(`[info] Pools -> complete:${completePool.length} protein:${proteinPool.length} starch:${starchPool.length} veg:${vegPool.length} dinner only:${dinnerOnly.length}`);

    // 3) Build date list and recent window
    const dates = rangeDays(START_DATE, DAYS);
    const recentWindowStart = offsetDate(START_DATE, -NO_REPEAT_DAYS);
    const recentEntries = await listMealPlanRange(recentWindowStart, offsetDate(START_DATE, DAYS - 1));
    const recentDinnerRecipeIds = new Set(
        recentEntries
            .filter(e => e.entryType === 'dinner' && e.recipe)
            .map(e => e.recipe.id)
    );

    // 4) Generate + (optionally) write
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

        console.log(`[debug] ${date} -> picks:`, chosen.map(x => x.recipeId || x.title));

        const roles = new Set();
        for (const item of chosen) {
            const r = roleRecipes.find(rr => rr.id === item.recipeId);
            if (r) r.roles.forEach(ro => roles.add(ro));
        }
        console.log(`[debug] ${date} covers:`, Array.from(roles).join(', ') || '(none)');

        for (const item of chosen) {
            if (DRY_RUN) {
                console.log(`[dry] ${date} dinner ->`, item.recipeId ? `recipeId=${item.recipeId}` : `title=${item.title}`);
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

// ---------------- PLANNER LOGIC ----------------

async function chooseDinnerForDate(ctx) {
    const { recentDinnerRecipeIds, completePool, proteinPool, starchPool, vegPool } = ctx;

    // 1) Prefer complete meals, avoid recent repeats
    const completeCandidates = shuffled(completePool).filter(r => !recentDinnerRecipeIds.has(r.id));
    if (completeCandidates.length > 0) {
        const chosen = completeCandidates[0];
        recentDinnerRecipeIds.add(chosen.id);
        return [{ recipeId: chosen.id }];
    }

    // 2) Greedy cover for roles with "pure-role" preference at the end
    const NEED = new Set(['role:protein','role:starch','role:vegetable']);

    // Universe = any recipe that has at least one needed role, not recently used
    const universe = Array.from(new Map(
        [...proteinPool, ...starchPool, ...vegPool]
            .filter(r => !recentDinnerRecipeIds.has(r.id))
            .map(r => [r.id, r])
    ).values());

    const picks = [];
    const used = new Set();

    while (NEED.size > 0) {
        const needCount = NEED.size;

        // Candidates that contribute something new
        const contrib = universe.filter(r => !used.has(r.id) && rolesGain(r, NEED) > 0);

        if (contrib.length === 0) break;

        let best;

        if (needCount === 1) {
            // EXACTLY ONE ROLE LEFT → prefer "pure" single-role recipes for that role
            const [neededRole] = [...NEED];
            const pure = contrib.filter(r => isPureForNeeded(r, NEED));

            if (pure.length > 0) {
                // pick any pure candidate (fewest extras is guaranteed since extras == 0)
                best = pure[Math.floor(Math.random() * pure.length)];
            } else {
                // fall back to any recipe that provides the needed role (even if it also has others)
                const hasNeeded = contrib.filter(r => rolesHas(r, neededRole));
                // prefer those with the *fewest* total roles to minimize overlap
                hasNeeded.sort((a, b) => a.roles.size - b.roles.size || (Math.random() - 0.5));
                best = hasNeeded[0];
            }
        } else {
            // 2 or 3 roles left → prefer more coverage (gain 2 > gain 1), then fewer extras
            contrib.sort((a, b) => byBestScore(a, b, NEED));
            best = contrib[0];
        }

        if (!best) break;

        picks.push(best);
        used.add(best.id);
        // remove newly covered roles from NEED
        for (const role of best.roles) if (NEED.has(role)) NEED.delete(role);
    }

    // Require at least 2 roles covered (or switch to === 3 to be strict)
    if (coveredRoles(picks).size >= 2) {
        for (const r of picks) recentDinnerRecipeIds.add(r.id);
        return picks.map(r => ({ recipeId: r.id }));
    }

    return [];
}

function countIntersect(aSet, bSet) {
    let n = 0; for (const v of aSet) if (bSet.has(v)) n++; return n;
}
function coveredRoles(picks) {
    const s = new Set(); for (const p of picks) for (const role of p.roles) s.add(role); return s;
}

// ---------------- API HELPERS ----------------

async function getTagObjects() {
    const url = `${BASE}/api/organizers/tags?perPage=500&page=1`;
    const data = await apiGET(url);
    const items = data?.items || data || [];
    const byKey = new Map();
    for (const t of items) {
        if (t.id)   byKey.set(t.id, t);
        if (t.slug) byKey.set(t.slug, t);
        if (t.name) byKey.set(t.name, t);
    }
    return { list: items, byKey };
}

async function getRoleLabeledRecipes() {
    // Resolve role tag IDs once
    const { list } = await getTagObjects();
    const id = name =>
        (list.find(t => t.slug === name) || list.find(t => t.name === name))?.id;

    const { list: catList } = await getCategoryObjects();
    const dinnerCat = catList.find(c =>
        (c.slug?.toLowerCase() === 'dinner') || (c.name?.toLowerCase() === 'dinner')
    );
    CATEGORY_IDS.dinner = dinnerCat?.id || CATEGORY_IDS.dinner;

    const proteinId = id(ROLE_TAGS.protein);
    const starchId  = id(ROLE_TAGS.starch);
    const vegId     = id(ROLE_TAGS.veg);

    ROLE_IDS.protein = proteinId || ROLE_IDS.protein;
    ROLE_IDS.starch  = starchId  || ROLE_IDS.starch;
    ROLE_IDS.veg     = vegId     || ROLE_IDS.veg;

    const all = [];
    for (const tagId of [proteinId, starchId, vegId].filter(Boolean)) {
        const batch = await getRecipesByTagIds([tagId]);
        all.push(...batch);
    }

    // De-duplicate by recipe id
    const dedup = Array.from(new Map(all.map(r => [r.id, r])).values());
    return dedup;
}

async function getRecipesByTagIds(tagIds) {
    const url = new URL(`${BASE}/api/recipes`);
    for (const id of tagIds) url.searchParams.append('tags', id);
    if (CATEGORY_IDS.dinner) url.searchParams.append('categories', CATEGORY_IDS.dinner);
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
        const slims = await Promise.all(items.map(x => slimRecipeAsync(x, false)));
        results.push(...slims);
        if (!data?.total || results.length >= data.total || items.length === 0) break;
        page += 1;
    }
    return results;
}

// Hydrate any recipes that came back without tags/roles by fetching each full recipe
async function hydrateMissingRoles(recipes, concurrency = 5) {
    const out = [];
    const q = [...recipes];
    const workers = Array.from({ length: concurrency }, async () => {
        while (q.length) {
            const r = q.shift();
            if (r.roles && r.roles.size > 0) { out.push(r); continue; }
            try {
                const full = await apiGET(`${BASE}/api/recipes/${encodeURIComponent(r.id)}`);
                out.push(await slimRecipeAsync(full, true));
            } catch {
                out.push(r);
            }
        }
    });
    await Promise.all(workers);
    return out;
}

async function listMealPlanRange(startDate, endDate) {
    const url = new URL(`${BASE}/api/households/mealplans`);
    url.searchParams.set('start_date', startDate);
    url.searchParams.set('end_date', endDate);
    url.searchParams.set('perPage', '200');
    const data = await apiGET(url.toString());
    const items = data?.items || data || [];
    return items;
}

async function createMealPlanEntry({ date, entryType, recipeId, title }) {
    const body = { date, entryType };
    if (recipeId) body.recipeId = recipeId;
    if (title)    body.title = title;
    return apiPOST(`${BASE}/api/households/mealplans`, body);
}

// ---------------- HTTP base ----------------

async function apiGET(url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    return res.json();
}

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

// ---------------- utils ----------------

function extractTagIdsFromAnyShape(r) {
    const ids = new Set();

    // A) recipe.tags = [{ id, slug, name }]
    if (Array.isArray(r.tags)) {
        for (const t of r.tags) {
            if (t?.id) ids.add(String(t.id));
        }
    }

    // B) recipe.recipeTags = [{ id, ... }] OR [{ tag: { id, ... } }]
    if (Array.isArray(r.recipeTags)) {
        for (const t of r.recipeTags) {
            if (t?.id) ids.add(String(t.id));
            if (t?.tag?.id) ids.add(String(t.tag.id));
        }
    }

    // C) odd shapes sometimes appear
    for (const obj of [r.recipe_tag, r.tag]) {
        if (Array.isArray(obj)) {
            for (const t of obj) {
                if (t?.id) ids.add(String(t.id));
                if (t?.tag?.id) ids.add(String(t.tag.id));
            }
        }
    }

    return Array.from(ids);
}

function extractTagStringsFromAnyShape(r) {
    const out = new Set();

    if (Array.isArray(r.tags)) {
        for (const t of r.tags) {
            const s = (typeof t === 'string' ? t : (t?.slug || t?.name || '')).toLowerCase();
            if (s) out.add(s);
        }
    }
    if (Array.isArray(r.recipeTags)) {
        for (const t of r.recipeTags) {
            const s = (t?.slug || t?.name || t?.tag?.slug || t?.tag?.name || '').toLowerCase();
            if (s) out.add(s);
        }
    }
    for (const obj of [r.recipe_tag, r.tag]) {
        if (Array.isArray(obj)) {
            for (const t of obj) {
                const s = (t?.slug || t?.name || t?.tag?.slug || t?.tag?.name || '').toLowerCase();
                if (s) out.add(s);
            }
        }
    }

    return Array.from(out);
}

function parseArgs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--start') out.start = argv[++i];
        else if (a === '--days') out.days = argv[++i];
        else if (a === '--norepeat') out.norepeat = argv[++i];
        else if (a === '--dry') out.dry = true;
    }
    return out;
}

function today() { const d = new Date(); return d.toISOString().slice(0, 10); }
function offsetDate(yyyyMmDd, deltaDays) { const d = new Date(yyyyMmDd + 'T00:00:00'); d.setDate(d.getDate() + deltaDays); return d.toISOString().slice(0, 10); }
function rangeDays(start, count) { return Array.from({ length: count }, (_, i) => offsetDate(start, i)); }
function shuffled(arr) { return [...arr].sort(() => Math.random() - 0.5); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// -------- robust tag extraction for Mealie 3.x --------

// Pull tag strings from list shapes; if none found and allowFetch=true, call /recipes/{id}/tags
async function collectTagStrings(r, allowFetch = false) {
    const out = new Set();

    // A) recipe.tags = [{ slug, name }]
    if (Array.isArray(r.tags)) {
        for (const t of r.tags) {
            const s = (t?.slug || t?.name || '').toLowerCase();
            if (s) out.add(s);
        }
    }

    // B) recipe.recipeTags = [{ slug, name }] OR [{ tag: { slug, name } }]
    if (Array.isArray(r.recipeTags)) {
        for (const t of r.recipeTags) {
            const s = (t?.slug || t?.name || t?.tag?.slug || t?.tag?.name || '').toLowerCase();
            if (s) out.add(s);
        }
    }

    // C) odd shapes sometimes appear
    for (const obj of [r.recipe_tag, r.tag]) {
        if (Array.isArray(obj)) {
            for (const t of obj) {
                const s = (t?.slug || t?.name || t?.tag?.slug || t?.tag?.name || '').toLowerCase();
                if (s) out.add(s);
            }
        }
    }

    // D) fallback: GET /api/recipes/{id}/tags
    if (out.size === 0 && allowFetch && r.id) {
        try {
            const tags = await apiGET(`${BASE}/api/recipes/${encodeURIComponent(r.id)}/tags`);
            if (Array.isArray(tags)) {
                for (const t of tags) {
                    const s = (t?.slug || t?.name || '').toLowerCase();
                    if (s) out.add(s);
                }
            }
        } catch {}
    }

    return Array.from(out);
}

// slim recipe with roles; async because we might fetch tags in fallback mode
async function slimRecipeAsync(r, allowFetch = false) {
    // 1) Try IDs from the object we already have
    let tagIds = extractTagIdsFromAnyShape(r);

    // 2) If none and we’re allowed, fetch /recipes/{id}/tags (3.1.0 supports this)
    if (tagIds.length === 0 && allowFetch && r.id) {
        try {
            const tags = await apiGET(`${BASE}/api/recipes/${encodeURIComponent(r.id)}/tags`);
            if (Array.isArray(tags)) {
                tagIds = tags.map(t => String(t?.id)).filter(Boolean);
            }
        } catch {/* ignore */}
    }

    // 3) Build roles via ID membership
    const roles = new Set();
    const hasId = id => id && tagIds.includes(String(id));
    if (hasId(ROLE_IDS.protein)) roles.add(ROLE_TAGS.protein);
    if (hasId(ROLE_IDS.starch))  roles.add(ROLE_TAGS.starch);
    if (hasId(ROLE_IDS.veg))     roles.add(ROLE_TAGS.veg);

    // 4) Fallback to string names/slugs if IDs didn’t resolve any role
    if (roles.size === 0) {
        const tagStrings = extractTagStringsFromAnyShape(r);
        const norm = s => s?.toLowerCase().replace(/\s+/g, '');
        const set = new Set(tagStrings.map(norm));
        if (set.has(norm(ROLE_TAGS.protein))) roles.add(ROLE_TAGS.protein);
        if (set.has(norm(ROLE_TAGS.starch)))  roles.add(ROLE_TAGS.starch);
        if (set.has(norm(ROLE_TAGS.veg)))     roles.add(ROLE_TAGS.veg);
    }

    // 5) Store categories
    const cats = (r.categories || []).map(c => (c.slug || c.name || '').toLowerCase());
    const isDinner = cats.includes('dinner');

    return {
        id:   r.id || r.slug || r.uid || r.recipeId || r._id,
        name: r.name || r.title || r.recipeName || '',
        roles,
        isDinner,
    };
}

async function getCategoryObjects() {
    const url = `${BASE}/api/organizers/categories?perPage=500&page=1`;
    const data = await apiGET(url);
    const items = data?.items || data || [];
    return { list: items };
}

// ---- helpers for role logic ----
function rolesHas(r, role) {
    return r.roles && r.roles.has(role);
}
function rolesGain(r, NEED) {
    let n = 0; for (const v of r.roles) if (NEED.has(v)) n++; return n;
}
function isPureForNeeded(r, NEED) {
    // exactly one role on the recipe, and it's the needed one
    return r.roles.size === 1 && rolesGain(r, NEED) === 1;
}
function byBestScore(a, b, NEED) {
    // Prefer more gain (2 > 1), then fewer total roles (prefer single-role),
    // then random-ish tie-breaker
    const ga = rolesGain(a, NEED), gb = rolesGain(b, NEED);
    if (ga !== gb) return gb - ga;
    if (a.roles.size !== b.roles.size) return a.roles.size - b.roles.size;
    return Math.random() - 0.5;
}

main().catch(err => {
    console.error('[fatal]', err);
    process.exit(1);
});
