/**
 * Integration tests for Mealie API communication
 *
 * These tests make real API calls to verify the scripts can talk to Mealie.
 * They are skipped if MEALIE_BASE and MEALIE_TOKEN are not set.
 *
 * To run these tests:
 *   1. Copy .env.example to .env and fill in your Mealie credentials
 *   2. Run: npm test
 */

import { describe, it, expect, beforeAll } from 'vitest';
import 'dotenv/config';

const BASE = process.env.MEALIE_BASE?.replace(/\/+$/, '');
const TOKEN = process.env.MEALIE_TOKEN;

// Skip all tests if credentials are not configured
const runIntegrationTests = BASE && TOKEN;

/**
 * Helper to make authenticated GET requests to Mealie
 */
async function apiGET(url) {
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${TOKEN}` }
    });
    if (!res.ok) {
        throw new Error(`GET ${url} -> ${res.status}`);
    }
    return res.json();
}

describe.skipIf(!runIntegrationTests)('Mealie API Integration', () => {
    // Increase timeout for network requests
    const TIMEOUT = 10000;

    describe('Authentication', () => {
        it('can authenticate with the API token', async () => {
            // The /api/users/self endpoint requires authentication
            const url = `${BASE}/api/users/self`;
            const user = await apiGET(url);

            expect(user).toBeDefined();
            expect(user.id).toBeDefined();
            expect(user.username).toBeDefined();
        }, TIMEOUT);
    });

    describe('Tags API', () => {
        it('can fetch tags from Mealie', async () => {
            const url = `${BASE}/api/organizers/tags?perPage=100`;
            const data = await apiGET(url);

            expect(data).toBeDefined();
            // Response should have items array (paginated) or be an array directly
            const items = data.items || data;
            expect(Array.isArray(items)).toBe(true);
        }, TIMEOUT);

        it('tags have expected structure', async () => {
            const url = `${BASE}/api/organizers/tags?perPage=10`;
            const data = await apiGET(url);
            const items = data.items || data;

            if (items.length > 0) {
                const tag = items[0];
                // Tags should have id, name, and slug
                expect(tag.id).toBeDefined();
                expect(typeof tag.name).toBe('string');
                expect(typeof tag.slug).toBe('string');
            }
        }, TIMEOUT);
    });

    describe('Categories API', () => {
        it('can fetch categories from Mealie', async () => {
            const url = `${BASE}/api/organizers/categories?perPage=100`;
            const data = await apiGET(url);

            expect(data).toBeDefined();
            const items = data.items || data;
            expect(Array.isArray(items)).toBe(true);
        }, TIMEOUT);

        it('categories have expected structure', async () => {
            const url = `${BASE}/api/organizers/categories?perPage=10`;
            const data = await apiGET(url);
            const items = data.items || data;

            if (items.length > 0) {
                const category = items[0];
                expect(category.id).toBeDefined();
                expect(typeof category.name).toBe('string');
                expect(typeof category.slug).toBe('string');
            }
        }, TIMEOUT);
    });

    describe('Recipes API', () => {
        it('can fetch recipes list from Mealie', async () => {
            const url = `${BASE}/api/recipes?perPage=10`;
            const data = await apiGET(url);

            expect(data).toBeDefined();
            const items = data.items || data;
            expect(Array.isArray(items)).toBe(true);
        }, TIMEOUT);

        it('recipe list items have expected structure', async () => {
            const url = `${BASE}/api/recipes?perPage=5`;
            const data = await apiGET(url);
            const items = data.items || data;

            if (items.length > 0) {
                const recipe = items[0];
                // List items should have at least id/slug and name
                expect(recipe.id || recipe.slug).toBeDefined();
                expect(typeof recipe.name).toBe('string');
            }
        }, TIMEOUT);

        it('can fetch a single recipe with full details', async () => {
            // First get a recipe slug from the list
            const listUrl = `${BASE}/api/recipes?perPage=1`;
            const listData = await apiGET(listUrl);
            const items = listData.items || listData;

            if (items.length > 0) {
                const slug = items[0].slug;
                const recipeUrl = `${BASE}/api/recipes/${encodeURIComponent(slug)}`;
                const recipe = await apiGET(recipeUrl);

                expect(recipe).toBeDefined();
                expect(recipe.name).toBeDefined();
                // Full recipe should have ingredients
                expect(recipe.recipeIngredient).toBeDefined();
                expect(Array.isArray(recipe.recipeIngredient)).toBe(true);
            }
        }, TIMEOUT);
    });

    describe('Meal Plans API', () => {
        it('can fetch meal plans', async () => {
            // Get meal plans for a date range
            const today = new Date().toISOString().slice(0, 10);
            const url = `${BASE}/api/households/mealplans?start_date=${today}&end_date=${today}&perPage=10`;
            const data = await apiGET(url);

            expect(data).toBeDefined();
            // Should be an array or have items property
            const items = data.items || data;
            expect(Array.isArray(items)).toBe(true);
        }, TIMEOUT);
    });

    describe('Role Tags', () => {
        it('can find role tags if they exist', async () => {
            const url = `${BASE}/api/organizers/tags?perPage=500`;
            const data = await apiGET(url);
            const items = data.items || data;

            // Look for our role tags
            const roleTagNames = ['role:protein', 'role:starch', 'role:vegetable'];
            const foundTags = items.filter(tag =>
                roleTagNames.includes(tag.name) || roleTagNames.includes(tag.slug)
            );

            // This test just reports what was found - doesn't fail if tags don't exist
            // because the auto-tag script creates them
            console.log(`Found ${foundTags.length} of 3 role tags:`,
                foundTags.map(t => t.name).join(', ') || '(none)');

            // If role tags exist, verify their structure
            for (const tag of foundTags) {
                expect(tag.id).toBeDefined();
                expect(tag.name).toBeDefined();
            }
        }, TIMEOUT);
    });
});

// Provide helpful message when tests are skipped
describe.skipIf(runIntegrationTests)('Integration Tests Skipped', () => {
    it('skipped because MEALIE_BASE or MEALIE_TOKEN not set', () => {
        console.log('\n');
        console.log('  Integration tests were skipped.');
        console.log('  To run them, create a .env file with:');
        console.log('    MEALIE_BASE=https://your-mealie-server.com');
        console.log('    MEALIE_TOKEN=your_api_token');
        console.log('\n');
        expect(true).toBe(true);
    });
});
