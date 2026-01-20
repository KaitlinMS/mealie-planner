#!/usr/bin/env node
// Usage:
//   node auto-tag.js              # Dry run - shows proposed changes
//   node auto-tag.js --apply      # Actually apply the changes
//   node auto-tag.js --verbose    # Show detailed ingredient analysis

import 'dotenv/config';

const BASE = process.env.MEALIE_BASE?.replace(/\/+$/, '');
const TOKEN = process.env.MEALIE_TOKEN;

if (!BASE || !TOKEN) {
    console.error('Please set MEALIE_BASE and MEALIE_TOKEN in .env.');
    process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
const DRY_RUN = !args.apply;
const VERBOSE = !!args.verbose;

// ============== INGREDIENT KEYWORDS ==============
// These lists help identify what role(s) a recipe fulfills

// "Substantial" proteins - these make something a protein dish even in small amounts
const PROTEIN_KEYWORDS_SUBSTANTIAL = [
    // Meats
    'chicken', 'beef', 'pork', 'lamb', 'turkey', 'duck', 'veal', 'venison',
    'bacon', 'ham', 'sausage', 'pepperoni', 'salami', 'prosciutto',
    'ground beef', 'ground turkey', 'ground pork', 'ground chicken',
    'steak', 'roast', 'chop', 'tenderloin', 'brisket', 'ribs',
    'meatball', 'meatloaf',
    // Poultry parts
    'breast', 'thigh', 'drumstick', 'wing',
    // Seafood
    'fish', 'salmon', 'tuna', 'cod', 'tilapia', 'halibut', 'trout', 'bass', 'haddock',
    'shrimp', 'prawn', 'lobster', 'crab', 'scallop', 'mussel', 'clam', 'oyster',
    'calamari', 'squid', 'octopus', 'anchovy', 'sardine',
    // Plant proteins
    'tofu', 'tempeh', 'seitan', 'edamame',
    'lentils', 'chickpeas', 'black beans', 'kidney beans', 'cannellini',
];

// "Minor" proteins - only count as protein if the dish isn't a baked good/dessert
const PROTEIN_KEYWORDS_MINOR = [
    'egg', 'eggs', 'beans',
];

// Combined for backward compatibility
const PROTEIN_KEYWORDS = [...PROTEIN_KEYWORDS_SUBSTANTIAL, ...PROTEIN_KEYWORDS_MINOR];

const STARCH_KEYWORDS = [
    // Pasta
    'pasta', 'spaghetti', 'penne', 'rigatoni', 'fettuccine', 'linguine',
    'macaroni', 'lasagna', 'ravioli', 'tortellini', 'gnocchi', 'orzo',
    'noodle', 'ramen', 'udon', 'soba', 'rice noodle', 'lo mein', 'chow mein',
    // Rice & grains
    'rice', 'risotto', 'pilaf', 'biryani', 'fried rice',
    'quinoa', 'couscous', 'bulgur', 'farro', 'barley', 'polenta', 'grits',
    // Bread & baked
    'bread', 'roll', 'bun', 'baguette', 'ciabatta', 'focaccia', 'pita', 'naan',
    'tortilla', 'wrap', 'flatbread', 'croissant', 'biscuit',
    'pizza dough', 'pie crust', 'pastry',
    // Potatoes
    'potato', 'potatoes', 'mashed', 'fries', 'hash brown', 'tater tot',
    'sweet potato', 'yam',
    // Other starches
    'corn', 'cornmeal', 'cornbread', 'polenta',
    'dumpling', 'pierogi', 'wonton',
];

const VEGETABLE_KEYWORDS = [
    // Leafy greens
    'lettuce', 'spinach', 'kale', 'arugula', 'chard', 'collard', 'cabbage',
    'romaine', 'iceberg', 'mixed greens', 'salad',
    // Common vegetables
    'broccoli', 'cauliflower', 'carrot', 'celery', 'onion', 'garlic',
    'pepper', 'bell pepper', 'tomato', 'cucumber', 'zucchini', 'squash',
    'eggplant', 'mushroom', 'asparagus', 'green bean', 'pea', 'snap pea',
    'brussels sprout', 'artichoke', 'leek', 'shallot', 'scallion',
    'radish', 'turnip', 'beet', 'parsnip', 'rutabaga',
    'bok choy', 'napa cabbage', 'bean sprout',
    // Squashes
    'butternut', 'acorn squash', 'spaghetti squash', 'pumpkin',
    // Generic
    'vegetable', 'veggie', 'greens',
];

// Words that indicate this is likely a MAIN dish (dinner) vs a side
const MAIN_DISH_INDICATORS = [
    // Proteins in title usually mean main dish
    'chicken', 'beef', 'pork', 'lamb', 'turkey', 'fish', 'salmon', 'shrimp',
    'steak', 'roast', 'chop',
    // Meal types
    'casserole', 'stew', 'curry', 'stir fry', 'stir-fry',
    'bowl', 'plate', 'dinner', 'entree', 'main',
    // Complete dishes
    'lasagna', 'pizza', 'burger', 'sandwich', 'wrap', 'taco', 'burrito',
    'soup', 'chili',
];

const SIDE_DISH_INDICATORS = [
    'side', 'slaw', 'roasted vegetables', 'steamed',
    'mashed', 'baked potato', 'rice pilaf', 'garlic bread',
    'coleslaw', 'corn on the cob',
];

// Desserts should be excluded from meal planning entirely
const DESSERT_INDICATORS = [
    'cake', 'cookie', 'brownie', 'pie', 'tart', 'cobbler', 'crisp',
    'pudding', 'mousse', 'ice cream', 'gelato', 'sorbet',
    'cupcake', 'cheesecake', 'truffle', 'fudge', 'candy',
    'donut', 'doughnut', 'pastry', 'eclair', 'macaron',
    'chocolate chip', 'dessert', 'sweet treat',
];

// Breakfast items - categorize separately
const BREAKFAST_INDICATORS = [
    'pancake', 'waffle', 'french toast', 'oatmeal', 'cereal',
    'breakfast', 'morning', 'brunch',
    'smoothie', 'granola', 'yogurt parfait',
];

// Baked goods where eggs are structural, not the protein focus
const BAKED_GOOD_INDICATORS = [
    'bread', 'loaf', 'muffin', 'biscuit', 'scone', 'roll',
    'cake', 'cookie', 'brownie', 'pastry', 'croissant',
    'pie crust', 'dough', 'batter',
    'cornbread', 'banana bread', 'zucchini bread', 'pound cake',
];

// ============== MAIN ==============

async function main() {
    console.log(`[info] Base: ${BASE}`);
    console.log(`[info] Mode: ${DRY_RUN ? 'DRY RUN (use --apply to save changes)' : 'APPLYING CHANGES'}`);
    console.log('');

    // 1) Fetch existing tags and categories to get IDs
    const { tagMap, tagList, tagObjects } = await getOrCreateTags();
    const { categoryMap, categoryList, categoryObjects } = await getOrCreateCategories();

    console.log(`[info] Tags available: ${tagList.map(t => t.name).join(', ')}`);
    console.log(`[info] Categories available: ${categoryList.map(c => c.name).join(', ')}`);
    console.log('');

    // 2) Fetch all recipes
    const recipes = await getAllRecipes();
    console.log(`[info] Found ${recipes.length} recipes to analyze`);
    console.log('');

    // 3) Analyze and update each recipe
    let updated = 0;
    let skipped = 0;
    const summary = { protein: 0, starch: 0, veg: 0, dinner: 0, side: 0, breakfast: 0, dessert: 0 };

    for (const recipe of recipes) {
        const analysis = analyzeRecipe(recipe);

        if (VERBOSE) {
            console.log(`\n[analyze] "${recipe.name}"`);
            console.log(`  Ingredients: ${recipe.ingredients?.length || 0}`);
            console.log(`  Detected roles: ${analysis.roles.join(', ') || 'none'}`);
            console.log(`  Category: ${analysis.category}`);
            if (analysis.proteinMatches.length) console.log(`  Protein matches: ${analysis.proteinMatches.join(', ')}`);
            if (analysis.starchMatches.length) console.log(`  Starch matches: ${analysis.starchMatches.join(', ')}`);
            if (analysis.vegMatches.length) console.log(`  Veg matches: ${analysis.vegMatches.join(', ')}`);
        }

        // Skip desserts entirely - don't assign role tags
        if (analysis.category === 'dessert') {
            summary.dessert++;
            if (VERBOSE) {
                console.log(`[skip] "${recipe.name}" -> dessert (no role tags assigned)`);
            }
            skipped++;
            continue;
        }

        // Build new tags list
        const newTagIds = [];
        if (analysis.roles.includes('protein')) {
            newTagIds.push(tagMap['role:protein']);
            summary.protein++;
        }
        if (analysis.roles.includes('starch')) {
            newTagIds.push(tagMap['role:starch']);
            summary.starch++;
        }
        if (analysis.roles.includes('vegetable')) {
            newTagIds.push(tagMap['role:vegetable']);
            summary.veg++;
        }

        // Build new categories list (keep existing non-meal-type categories)
        const mealCatIds = [categoryMap['dinner'], categoryMap['side'], categoryMap['breakfast']].filter(Boolean);
        const existingCatIds = (recipe.recipeCategory || [])
            .map(c => c.id)
            .filter(id => !mealCatIds.includes(id));

        const newCatIds = [...existingCatIds];
        if (analysis.category === 'dinner' && categoryMap['dinner']) {
            newCatIds.push(categoryMap['dinner']);
            summary.dinner++;
        } else if (analysis.category === 'side' && categoryMap['side']) {
            newCatIds.push(categoryMap['side']);
            summary.side++;
        } else if (analysis.category === 'breakfast' && categoryMap['breakfast']) {
            newCatIds.push(categoryMap['breakfast']);
            summary.breakfast++;
        }

        // Check if anything changed
        const currentTagIds = (recipe.tags || []).map(t => t.id).sort();
        const currentCatIds = (recipe.recipeCategory || []).map(c => c.id).sort();
        const tagsChanged = JSON.stringify(newTagIds.filter(Boolean).sort()) !== JSON.stringify(currentTagIds);
        const catsChanged = JSON.stringify(newCatIds.filter(Boolean).sort()) !== JSON.stringify(currentCatIds);

        if (!tagsChanged && !catsChanged) {
            skipped++;
            continue;
        }

        // Log the change
        const tagNames = analysis.roles.map(r => `role:${r}`);
        console.log(`[${DRY_RUN ? 'would update' : 'updating'}] "${recipe.name}" -> tags: [${tagNames.join(', ')}], category: ${analysis.category}`);

        if (!DRY_RUN) {
            try {
                await updateRecipeTagsAndCategories(recipe.slug, newTagIds.filter(Boolean), newCatIds.filter(Boolean), tagObjects, categoryObjects);
                updated++;
                await sleep(100); // Rate limiting
            } catch (err) {
                console.error(`  [error] Failed to update: ${err.message}`);
            }
        } else {
            updated++;
        }
    }

    console.log('');
    console.log('============ SUMMARY ============');
    console.log(`Total recipes: ${recipes.length}`);
    console.log(`${DRY_RUN ? 'Would update' : 'Updated'}: ${updated}`);
    console.log(`Skipped (no changes): ${skipped}`);
    console.log('');
    console.log('Role distribution:');
    console.log(`  Protein: ${summary.protein}`);
    console.log(`  Starch: ${summary.starch}`);
    console.log(`  Vegetable: ${summary.veg}`);
    console.log('');
    console.log('Category distribution:');
    console.log(`  Dinner (main): ${summary.dinner}`);
    console.log(`  Side: ${summary.side}`);
    console.log(`  Breakfast: ${summary.breakfast}`);
    console.log(`  Dessert (skipped): ${summary.dessert}`);

    if (DRY_RUN) {
        console.log('');
        console.log('This was a dry run. Use --apply to save changes.');
    }
}

// ============== ANALYSIS ==============

function analyzeRecipe(recipe) {
    const result = {
        roles: [],
        category: 'unknown',
        proteinMatches: [],
        starchMatches: [],
        vegMatches: [],
        isBakedGood: false,
    };

    // Combine all text for analysis
    const ingredients = (recipe.recipeIngredient || [])
        .map(i => (i.note || i.display || i.originalText || '').toLowerCase())
        .join(' ');

    const title = (recipe.name || '').toLowerCase();
    const description = (recipe.description || '').toLowerCase();
    const titleAndDesc = `${title} ${description}`;
    const allText = `${title} ${description} ${ingredients}`;

    // First, check if this is a baked good (affects how we count eggs)
    result.isBakedGood = BAKED_GOOD_INDICATORS.some(ind => matchesKeyword(titleAndDesc, ind));

    // Check for substantial proteins (always count)
    for (const keyword of PROTEIN_KEYWORDS_SUBSTANTIAL) {
        if (matchesKeyword(allText, keyword)) {
            result.proteinMatches.push(keyword);
        }
    }

    // Check for minor proteins (eggs/beans) - only count if NOT a baked good
    if (!result.isBakedGood) {
        for (const keyword of PROTEIN_KEYWORDS_MINOR) {
            if (matchesKeyword(allText, keyword)) {
                result.proteinMatches.push(keyword);
            }
        }
    }

    if (result.proteinMatches.length > 0) {
        result.roles.push('protein');
    }

    // Check for starches
    for (const keyword of STARCH_KEYWORDS) {
        if (matchesKeyword(allText, keyword)) {
            result.starchMatches.push(keyword);
        }
    }
    if (result.starchMatches.length > 0) {
        result.roles.push('starch');
    }

    // Check for vegetables
    for (const keyword of VEGETABLE_KEYWORDS) {
        if (matchesKeyword(allText, keyword)) {
            result.vegMatches.push(keyword);
        }
    }
    if (result.vegMatches.length > 0) {
        result.roles.push('vegetable');
    }

    // Determine category (dessert, breakfast, dinner, side)
    result.category = determineCategory(recipe, result);

    return result;
}

function matchesKeyword(text, keyword) {
    // Word boundary matching to avoid false positives like "chicken" in "chickpea"
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}s?\\b`, 'i');
    return regex.test(text);
}

function determineCategory(recipe, analysis) {
    const title = (recipe.name || '').toLowerCase();
    const description = (recipe.description || '').toLowerCase();
    const titleAndDesc = `${title} ${description}`;

    // Check if recipe has SUBSTANTIAL protein (meat, fish, poultry - not just eggs/beans)
    const hasSubstantialProtein = analysis.proteinMatches.some(match =>
        PROTEIN_KEYWORDS_SUBSTANTIAL.includes(match)
    );

    // 1) Check for desserts FIRST - these skip meal planning entirely
    for (const indicator of DESSERT_INDICATORS) {
        if (matchesKeyword(titleAndDesc, indicator)) {
            return 'dessert';
        }
    }

    // 2) Check for breakfast items - but only in TITLE to avoid false positives
    //    (descriptions often say "great for breakfast OR dinner")
    for (const indicator of BREAKFAST_INDICATORS) {
        if (matchesKeyword(title, indicator)) {
            return 'breakfast';
        }
    }

    // 3) SUBSTANTIAL PROTEIN = DINNER (trumps most other indicators)
    //    If it has chicken, beef, fish, etc., it's a main dish regardless of
    //    whether it also mentions "rice pilaf" or "mashed potatoes"
    if (hasSubstantialProtein) {
        return 'dinner';
    }

    // 4) Check for salads - special handling
    const isSalad = matchesKeyword(title, 'salad');
    if (isSalad) {
        // Salads WITH protein (like egg salad) are dinner
        // Salads without protein are sides
        if (analysis.roles.includes('protein')) {
            return 'dinner';
        }
        return 'side';
    }

    // 5) Check explicit side indicators (only in title to avoid false positives)
    for (const indicator of SIDE_DISH_INDICATORS) {
        if (matchesKeyword(title, indicator)) {
            return 'side';
        }
    }

    // 6) Check main dish indicators in title
    for (const indicator of MAIN_DISH_INDICATORS) {
        if (matchesKeyword(title, indicator)) {
            return 'dinner';
        }
    }

    // 7) Heuristic: If it has any protein (including eggs as main ingredient), likely dinner
    if (analysis.roles.includes('protein')) {
        return 'dinner';
    }

    // 8) No protein - likely a side dish (starches and vegetables without protein)
    if (analysis.roles.includes('starch') || analysis.roles.includes('vegetable')) {
        return 'side';
    }

    return 'unknown';
}

// ============== API HELPERS ==============

async function getAllRecipes() {
    const recipes = [];
    let page = 1;

    while (true) {
        const url = `${BASE}/api/recipes?perPage=100&page=${page}`;
        const data = await apiGET(url);
        const items = data?.items || data || [];

        if (items.length === 0) break;

        // Fetch full details for each recipe to get ingredients
        for (const item of items) {
            try {
                const full = await apiGET(`${BASE}/api/recipes/${encodeURIComponent(item.slug)}`);
                recipes.push(full);
            } catch (err) {
                console.warn(`[warn] Could not fetch recipe ${item.slug}: ${err.message}`);
            }
            await sleep(50); // Rate limiting
        }

        if (!data?.total || recipes.length >= data.total) break;
        page++;
    }

    return recipes;
}

async function getOrCreateTags() {
    const url = `${BASE}/api/organizers/tags?perPage=500`;
    const data = await apiGET(url);
    const tagList = data?.items || data || [];

    // Store full tag objects (with id, name, slug) for API calls
    const tagMap = {};       // key -> id (for quick lookup)
    const tagObjects = {};   // id -> full object (for API payloads)

    for (const tag of tagList) {
        tagObjects[tag.id] = tag;
        // Store by multiple keys for flexible lookup
        if (tag.slug) tagMap[tag.slug] = tag.id;
        if (tag.name) tagMap[tag.name] = tag.id;
        // Also store lowercase and slug-ified versions
        if (tag.slug) tagMap[tag.slug.toLowerCase()] = tag.id;
        if (tag.name) tagMap[tag.name.toLowerCase()] = tag.id;
        // Handle colon vs dash variants (role:protein vs role-protein)
        if (tag.name) {
            tagMap[tag.name.replace(/:/g, '-')] = tag.id;
            tagMap[tag.name.replace(/-/g, ':')] = tag.id;
        }
    }

    // Ensure our role tags exist
    const roleTags = ['role:protein', 'role:starch', 'role:vegetable'];
    for (const tagName of roleTags) {
        // Check multiple possible keys
        const exists = tagMap[tagName] || tagMap[tagName.replace(/:/g, '-')];
        if (!exists) {
            if (DRY_RUN) {
                console.log(`[would create] Tag: ${tagName}`);
                tagMap[tagName] = `new-${tagName}`;
                tagObjects[`new-${tagName}`] = { id: `new-${tagName}`, name: tagName, slug: tagName };
            } else {
                console.log(`[creating] Tag: ${tagName}`);
                const newTag = await apiPOST(`${BASE}/api/organizers/tags`, { name: tagName });
                tagMap[tagName] = newTag.id;
                tagObjects[newTag.id] = newTag;
                tagList.push(newTag);
            }
        } else {
            // Ensure the preferred key is set
            tagMap[tagName] = exists;
        }
    }

    return { tagMap, tagList, tagObjects };
}

async function getOrCreateCategories() {
    const url = `${BASE}/api/organizers/categories?perPage=500`;
    const data = await apiGET(url);
    const categoryList = data?.items || data || [];

    // Store full category objects (with id, name, slug) for API calls
    const categoryMap = {};       // key -> id
    const categoryObjects = {};   // id -> full object

    for (const cat of categoryList) {
        categoryObjects[cat.id] = cat;
        // Store by lowercase slug/name for case-insensitive lookup
        const key = (cat.slug || cat.name || '').toLowerCase();
        categoryMap[key] = cat.id;
        // Also map common variants (e.g., "sides" -> same ID as "side")
        if (key === 'sides') categoryMap['side'] = cat.id;
        if (key === 'dinners') categoryMap['dinner'] = cat.id;
        if (key === 'breakfasts') categoryMap['breakfast'] = cat.id;
    }

    // Ensure dinner, side, and breakfast categories exist
    // Check case-insensitively since Mealie may have "Dinner" vs "dinner"
    const neededCats = ['dinner', 'side', 'breakfast'];
    for (const catName of neededCats) {
        if (!categoryMap[catName]) {
            if (DRY_RUN) {
                console.log(`[would create] Category: ${catName}`);
                categoryMap[catName] = `new-${catName}`;
                categoryObjects[`new-${catName}`] = { id: `new-${catName}`, name: catName, slug: catName };
            } else {
                console.log(`[creating] Category: ${catName}`);
                const newCat = await apiPOST(`${BASE}/api/organizers/categories`, { name: catName });
                categoryMap[catName] = newCat.id;
                categoryObjects[newCat.id] = newCat;
                categoryList.push(newCat);
            }
        }
    }

    return { categoryMap, categoryList, categoryObjects };
}

async function updateRecipeTagsAndCategories(slug, tagIds, categoryIds, tagObjects, categoryObjects) {
    // Mealie uses PATCH to update recipes
    const url = `${BASE}/api/recipes/${encodeURIComponent(slug)}`;

    // Build the update payload - Mealie requires full objects with id, name, slug
    const body = {
        tags: tagIds.map(id => tagObjects[id] || { id }).filter(t => t.name && t.slug),
        recipeCategory: categoryIds.map(id => categoryObjects[id] || { id }).filter(c => c.name && c.slug),
    };

    return apiPATCH(url, body);
}

// ============== HTTP ==============

async function apiGET(url) {
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${TOKEN}` }
    });
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    return res.json();
}

async function apiPOST(url, body) {
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`POST ${url} -> ${res.status} ${text}`);
    }
    return res.json().catch(() => ({}));
}

async function apiPATCH(url, body) {
    const res = await fetch(url, {
        method: 'PATCH',
        headers: {
            Authorization: `Bearer ${TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`PATCH ${url} -> ${res.status} ${text}`);
    }
    return res.json().catch(() => ({}));
}

// ============== UTILS ==============

function parseArgs(argv) {
    const out = {};
    for (const a of argv) {
        if (a === '--apply') out.apply = true;
        else if (a === '--verbose') out.verbose = true;
    }
    return out;
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

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
    matchesKeyword,
    analyzeRecipe,
    determineCategory,
    PROTEIN_KEYWORDS_SUBSTANTIAL,
    PROTEIN_KEYWORDS_MINOR,
    STARCH_KEYWORDS,
    VEGETABLE_KEYWORDS,
    DESSERT_INDICATORS,
    BREAKFAST_INDICATORS,
    BAKED_GOOD_INDICATORS,
    MAIN_DISH_INDICATORS,
    SIDE_DISH_INDICATORS,
};
