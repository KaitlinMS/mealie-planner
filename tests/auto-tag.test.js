/**
 * Tests for auto-tag.js utility functions
 *
 * These tests cover the pure functions that can be tested without
 * making actual API calls to Mealie.
 */

import { describe, it, expect } from 'vitest';
import { _testExports } from '../auto-tag.js';

const {
    parseArgs,
    matchesKeyword,
    analyzeRecipe,
    determineCategory,
    PROTEIN_KEYWORDS_SUBSTANTIAL,
    DESSERT_INDICATORS,
    BREAKFAST_INDICATORS,
} = _testExports;

// ============================================================
// parseArgs tests
// ============================================================

describe('parseArgs', () => {
    it('parses --apply flag', () => {
        const result = parseArgs(['--apply']);
        expect(result.apply).toBe(true);
    });

    it('parses --verbose flag', () => {
        const result = parseArgs(['--verbose']);
        expect(result.verbose).toBe(true);
    });

    it('parses multiple flags together', () => {
        const result = parseArgs(['--apply', '--verbose']);
        expect(result).toEqual({
            apply: true,
            verbose: true,
        });
    });

    it('returns empty object for no arguments', () => {
        const result = parseArgs([]);
        expect(result).toEqual({});
    });

    it('ignores unknown flags', () => {
        const result = parseArgs(['--unknown', '--apply']);
        expect(result.apply).toBe(true);
        expect(result.unknown).toBeUndefined();
    });
});

// ============================================================
// matchesKeyword tests
// ============================================================

describe('matchesKeyword', () => {
    it('finds keyword as whole word', () => {
        expect(matchesKeyword('grilled chicken breast', 'chicken')).toBe(true);
    });

    it('avoids false positives with similar words', () => {
        // "chicken" should not match "chickpea"
        expect(matchesKeyword('chickpea curry', 'chicken')).toBe(false);
    });

    it('matches plural forms', () => {
        expect(matchesKeyword('scrambled eggs', 'egg')).toBe(true);
    });

    it('is case insensitive', () => {
        expect(matchesKeyword('GRILLED CHICKEN', 'chicken')).toBe(true);
        expect(matchesKeyword('grilled chicken', 'CHICKEN')).toBe(true);
    });

    it('matches at start of text', () => {
        expect(matchesKeyword('chicken parmesan', 'chicken')).toBe(true);
    });

    it('matches at end of text', () => {
        expect(matchesKeyword('roasted chicken', 'chicken')).toBe(true);
    });

    it('handles special regex characters in keyword without crashing', () => {
        // Keywords with special regex chars should be escaped to avoid errors
        // The function uses word boundaries which have specific behavior with
        // special characters, so we mainly test that it doesn't throw
        expect(() => matchesKeyword('test (value) here', '(value)')).not.toThrow();
        expect(() => matchesKeyword('price is $10', '$10')).not.toThrow();
        expect(() => matchesKeyword('a+b=c', 'a+b')).not.toThrow();
    });

    it('handles multi-word keywords', () => {
        expect(matchesKeyword('creamy black beans soup', 'black beans')).toBe(true);
    });
});

// ============================================================
// analyzeRecipe tests
// ============================================================

describe('analyzeRecipe', () => {
    it('detects protein from title', () => {
        const recipe = {
            name: 'Grilled Chicken',
            description: '',
            recipeIngredient: [],
        };
        const result = analyzeRecipe(recipe);
        expect(result.roles).toContain('protein');
        expect(result.proteinMatches).toContain('chicken');
    });

    it('detects starch from ingredients', () => {
        const recipe = {
            name: 'Simple Dish',
            description: '',
            recipeIngredient: [
                { note: '2 cups rice' },
            ],
        };
        const result = analyzeRecipe(recipe);
        expect(result.roles).toContain('starch');
        expect(result.starchMatches).toContain('rice');
    });

    it('detects vegetables from description', () => {
        const recipe = {
            name: 'Side Dish',
            description: 'Served with fresh broccoli',
            recipeIngredient: [],
        };
        const result = analyzeRecipe(recipe);
        expect(result.roles).toContain('vegetable');
        expect(result.vegMatches).toContain('broccoli');
    });

    it('detects multiple roles', () => {
        const recipe = {
            name: 'Chicken and Rice with Broccoli',
            description: '',
            recipeIngredient: [],
        };
        const result = analyzeRecipe(recipe);
        expect(result.roles).toContain('protein');
        expect(result.roles).toContain('starch');
        expect(result.roles).toContain('vegetable');
    });

    it('identifies baked goods and excludes minor proteins', () => {
        const recipe = {
            name: 'Banana Bread',
            description: '',
            recipeIngredient: [
                { note: '2 eggs' },
                { note: '3 bananas' },
            ],
        };
        const result = analyzeRecipe(recipe);
        expect(result.isBakedGood).toBe(true);
        // Eggs shouldn't count as protein in baked goods
        expect(result.proteinMatches).not.toContain('egg');
        expect(result.proteinMatches).not.toContain('eggs');
    });

    it('counts eggs as protein in non-baked dishes', () => {
        const recipe = {
            name: 'Scrambled Eggs',
            description: '',
            recipeIngredient: [
                { note: '4 eggs' },
            ],
        };
        const result = analyzeRecipe(recipe);
        expect(result.isBakedGood).toBe(false);
        expect(result.roles).toContain('protein');
    });

    it('returns empty roles for unrecognized recipe', () => {
        const recipe = {
            name: 'Mystery Dish',
            description: '',
            recipeIngredient: [],
        };
        const result = analyzeRecipe(recipe);
        expect(result.roles).toEqual([]);
    });
});

// ============================================================
// determineCategory tests
// ============================================================

describe('determineCategory', () => {
    it('categorizes desserts correctly', () => {
        const recipe = { name: 'Chocolate Cake', description: '' };
        const analysis = { roles: [], proteinMatches: [] };
        expect(determineCategory(recipe, analysis)).toBe('dessert');
    });

    it('categorizes breakfast items from title', () => {
        const recipe = { name: 'Fluffy Pancakes', description: '' };
        const analysis = { roles: ['starch'], proteinMatches: [] };
        expect(determineCategory(recipe, analysis)).toBe('breakfast');
    });

    it('categorizes substantial protein as dinner', () => {
        const recipe = { name: 'Herb Roasted Dish', description: '' };
        const analysis = { roles: ['protein'], proteinMatches: ['chicken'] };
        expect(determineCategory(recipe, analysis)).toBe('dinner');
    });

    it('categorizes protein salads as dinner', () => {
        const recipe = { name: 'Chicken Salad', description: '' };
        const analysis = { roles: ['protein', 'vegetable'], proteinMatches: ['chicken'] };
        expect(determineCategory(recipe, analysis)).toBe('dinner');
    });

    it('categorizes vegetable salads as side', () => {
        const recipe = { name: 'Garden Salad', description: '' };
        const analysis = { roles: ['vegetable'], proteinMatches: [] };
        expect(determineCategory(recipe, analysis)).toBe('side');
    });

    it('categorizes explicit side dishes', () => {
        const recipe = { name: 'Garlic Bread', description: '' };
        const analysis = { roles: ['starch'], proteinMatches: [] };
        expect(determineCategory(recipe, analysis)).toBe('side');
    });

    it('categorizes complete meals as dinner', () => {
        const recipe = { name: 'Beef Stew', description: '' };
        const analysis = { roles: ['protein', 'starch', 'vegetable'], proteinMatches: ['beef'] };
        expect(determineCategory(recipe, analysis)).toBe('dinner');
    });

    it('categorizes starch-only dishes as side', () => {
        const recipe = { name: 'Rice Pilaf', description: '' };
        const analysis = { roles: ['starch'], proteinMatches: [] };
        expect(determineCategory(recipe, analysis)).toBe('side');
    });

    it('returns unknown for unrecognized recipes', () => {
        const recipe = { name: 'Something', description: '' };
        const analysis = { roles: [], proteinMatches: [] };
        expect(determineCategory(recipe, analysis)).toBe('unknown');
    });

    it('prioritizes dessert over other categories', () => {
        // Even if it mentions "breakfast", dessert indicators should win
        const recipe = { name: 'Breakfast Cookie', description: '' };
        const analysis = { roles: [], proteinMatches: [] };
        expect(determineCategory(recipe, analysis)).toBe('dessert');
    });
});

// ============================================================
// Keyword list validation tests
// ============================================================

describe('keyword lists', () => {
    it('substantial proteins includes common meats', () => {
        expect(PROTEIN_KEYWORDS_SUBSTANTIAL).toContain('chicken');
        expect(PROTEIN_KEYWORDS_SUBSTANTIAL).toContain('beef');
        expect(PROTEIN_KEYWORDS_SUBSTANTIAL).toContain('salmon');
        expect(PROTEIN_KEYWORDS_SUBSTANTIAL).toContain('tofu');
    });

    it('dessert indicators includes common desserts', () => {
        expect(DESSERT_INDICATORS).toContain('cake');
        expect(DESSERT_INDICATORS).toContain('cookie');
        expect(DESSERT_INDICATORS).toContain('ice cream');
        expect(DESSERT_INDICATORS).toContain('pie');
    });

    it('breakfast indicators includes common breakfast items', () => {
        expect(BREAKFAST_INDICATORS).toContain('pancake');
        expect(BREAKFAST_INDICATORS).toContain('waffle');
        expect(BREAKFAST_INDICATORS).toContain('oatmeal');
    });
});

// ============================================================
// Edge case tests
// ============================================================

describe('edge cases', () => {
    it('handles recipe with empty name', () => {
        const recipe = {
            name: '',
            description: 'A chicken dish',
            recipeIngredient: [],
        };
        const result = analyzeRecipe(recipe);
        expect(result.roles).toContain('protein');
    });

    it('handles recipe with no ingredients', () => {
        const recipe = {
            name: 'Beef Tacos',
            description: '',
            recipeIngredient: [],
        };
        const result = analyzeRecipe(recipe);
        expect(result.roles).toContain('protein');
    });

    it('handles recipe with various ingredient formats', () => {
        const recipe = {
            name: 'Mixed Dish',
            description: '',
            recipeIngredient: [
                { note: '1 lb chicken' },
                { display: '2 cups rice' },
                { originalText: '1 head broccoli' },
            ],
        };
        const result = analyzeRecipe(recipe);
        expect(result.roles).toContain('protein');
        expect(result.roles).toContain('starch');
        expect(result.roles).toContain('vegetable');
    });

    it('handles null/undefined fields gracefully', () => {
        const recipe = {
            name: null,
            description: undefined,
            recipeIngredient: null,
        };
        // Should not throw
        expect(() => analyzeRecipe(recipe)).not.toThrow();
    });
});
