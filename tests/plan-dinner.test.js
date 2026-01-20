/**
 * Tests for plan-dinner.js utility functions
 *
 * These tests cover the pure functions that can be tested without
 * making actual API calls to Mealie.
 */

import { describe, it, expect } from 'vitest';
import { _testExports } from '../plan-dinner.js';

const {
    parseArgs,
    offsetDate,
    rangeDays,
    rolesGain,
    isPureForNeeded,
    byBestScore,
    coveredRoles,
    countIntersect,
    trySelectCompleteMeal,
    buildMealFromComponents,
} = _testExports;

// ============================================================
// parseArgs tests
// ============================================================

describe('parseArgs', () => {
    it('parses --start flag', () => {
        const result = parseArgs(['--start', '2025-01-20']);
        expect(result.start).toBe('2025-01-20');
    });

    it('parses --days flag', () => {
        const result = parseArgs(['--days', '14']);
        expect(result.days).toBe('14');
    });

    it('parses --norepeat flag', () => {
        const result = parseArgs(['--norepeat', '3']);
        expect(result.norepeat).toBe('3');
    });

    it('parses --dry flag', () => {
        const result = parseArgs(['--dry']);
        expect(result.dry).toBe(true);
    });

    it('parses multiple flags together', () => {
        const result = parseArgs(['--start', '2025-01-20', '--days', '7', '--norepeat', '5', '--dry']);
        expect(result).toEqual({
            start: '2025-01-20',
            days: '7',
            norepeat: '5',
            dry: true,
        });
    });

    it('returns empty object for no arguments', () => {
        const result = parseArgs([]);
        expect(result).toEqual({});
    });

    it('ignores unknown flags', () => {
        const result = parseArgs(['--unknown', 'value', '--dry']);
        expect(result.dry).toBe(true);
        expect(result.unknown).toBeUndefined();
    });
});

// ============================================================
// offsetDate tests
// ============================================================

describe('offsetDate', () => {
    it('adds days to a date', () => {
        expect(offsetDate('2025-01-15', 3)).toBe('2025-01-18');
    });

    it('subtracts days from a date', () => {
        expect(offsetDate('2025-01-15', -2)).toBe('2025-01-13');
    });

    it('handles month boundaries', () => {
        expect(offsetDate('2025-01-31', 1)).toBe('2025-02-01');
    });

    it('handles year boundaries', () => {
        expect(offsetDate('2025-12-31', 1)).toBe('2026-01-01');
    });

    it('handles leap year', () => {
        expect(offsetDate('2024-02-28', 1)).toBe('2024-02-29');
        expect(offsetDate('2024-02-29', 1)).toBe('2024-03-01');
    });

    it('returns same date for zero offset', () => {
        expect(offsetDate('2025-01-15', 0)).toBe('2025-01-15');
    });
});

// ============================================================
// rangeDays tests
// ============================================================

describe('rangeDays', () => {
    it('generates array of consecutive dates', () => {
        const result = rangeDays('2025-01-15', 3);
        expect(result).toEqual(['2025-01-15', '2025-01-16', '2025-01-17']);
    });

    it('returns single date for count of 1', () => {
        const result = rangeDays('2025-01-15', 1);
        expect(result).toEqual(['2025-01-15']);
    });

    it('returns empty array for count of 0', () => {
        const result = rangeDays('2025-01-15', 0);
        expect(result).toEqual([]);
    });

    it('handles month boundaries', () => {
        const result = rangeDays('2025-01-30', 4);
        expect(result).toEqual(['2025-01-30', '2025-01-31', '2025-02-01', '2025-02-02']);
    });

    it('generates a full week', () => {
        const result = rangeDays('2025-01-01', 7);
        expect(result.length).toBe(7);
        expect(result[0]).toBe('2025-01-01');
        expect(result[6]).toBe('2025-01-07');
    });
});

// ============================================================
// rolesGain tests
// ============================================================

describe('rolesGain', () => {
    it('returns count of needed roles the recipe provides', () => {
        const recipe = { roles: new Set(['role:protein', 'role:starch']) };
        const needed = new Set(['role:protein', 'role:starch', 'role:vegetable']);
        expect(rolesGain(recipe, needed)).toBe(2);
    });

    it('returns 0 if recipe has no needed roles', () => {
        const recipe = { roles: new Set(['role:protein']) };
        const needed = new Set(['role:vegetable']);
        expect(rolesGain(recipe, needed)).toBe(0);
    });

    it('returns 1 for single matching role', () => {
        const recipe = { roles: new Set(['role:protein']) };
        const needed = new Set(['role:protein', 'role:starch']);
        expect(rolesGain(recipe, needed)).toBe(1);
    });

    it('returns 3 for complete meal covering all roles', () => {
        const recipe = { roles: new Set(['role:protein', 'role:starch', 'role:vegetable']) };
        const needed = new Set(['role:protein', 'role:starch', 'role:vegetable']);
        expect(rolesGain(recipe, needed)).toBe(3);
    });

    it('handles empty roles', () => {
        const recipe = { roles: new Set() };
        const needed = new Set(['role:protein']);
        expect(rolesGain(recipe, needed)).toBe(0);
    });
});

// ============================================================
// isPureForNeeded tests
// ============================================================

describe('isPureForNeeded', () => {
    it('returns true for single-role recipe matching needed', () => {
        const recipe = { roles: new Set(['role:protein']) };
        const needed = new Set(['role:protein']);
        expect(isPureForNeeded(recipe, needed)).toBe(true);
    });

    it('returns false for multi-role recipe', () => {
        const recipe = { roles: new Set(['role:protein', 'role:starch']) };
        const needed = new Set(['role:protein']);
        expect(isPureForNeeded(recipe, needed)).toBe(false);
    });

    it('returns false if single role is not needed', () => {
        const recipe = { roles: new Set(['role:protein']) };
        const needed = new Set(['role:vegetable']);
        expect(isPureForNeeded(recipe, needed)).toBe(false);
    });

    it('returns false for empty roles', () => {
        const recipe = { roles: new Set() };
        const needed = new Set(['role:protein']);
        expect(isPureForNeeded(recipe, needed)).toBe(false);
    });
});

// ============================================================
// coveredRoles tests
// ============================================================

describe('coveredRoles', () => {
    it('collects all roles from multiple recipes', () => {
        const picks = [
            { roles: new Set(['role:protein']) },
            { roles: new Set(['role:starch']) },
            { roles: new Set(['role:vegetable']) },
        ];
        const covered = coveredRoles(picks);
        expect(covered.size).toBe(3);
        expect(covered.has('role:protein')).toBe(true);
        expect(covered.has('role:starch')).toBe(true);
        expect(covered.has('role:vegetable')).toBe(true);
    });

    it('handles overlapping roles', () => {
        const picks = [
            { roles: new Set(['role:protein', 'role:starch']) },
            { roles: new Set(['role:starch', 'role:vegetable']) },
        ];
        const covered = coveredRoles(picks);
        expect(covered.size).toBe(3);
    });

    it('returns empty set for empty picks', () => {
        const covered = coveredRoles([]);
        expect(covered.size).toBe(0);
    });

    it('handles single recipe with all roles', () => {
        const picks = [
            { roles: new Set(['role:protein', 'role:starch', 'role:vegetable']) },
        ];
        const covered = coveredRoles(picks);
        expect(covered.size).toBe(3);
    });
});

// ============================================================
// countIntersect tests
// ============================================================

describe('countIntersect', () => {
    it('counts common elements between sets', () => {
        const setA = new Set(['a', 'b', 'c']);
        const setB = new Set(['b', 'c', 'd']);
        expect(countIntersect(setA, setB)).toBe(2);
    });

    it('returns 0 for disjoint sets', () => {
        const setA = new Set(['a', 'b']);
        const setB = new Set(['c', 'd']);
        expect(countIntersect(setA, setB)).toBe(0);
    });

    it('returns full count for identical sets', () => {
        const setA = new Set(['a', 'b', 'c']);
        const setB = new Set(['a', 'b', 'c']);
        expect(countIntersect(setA, setB)).toBe(3);
    });

    it('handles empty sets', () => {
        expect(countIntersect(new Set(), new Set(['a']))).toBe(0);
        expect(countIntersect(new Set(['a']), new Set())).toBe(0);
        expect(countIntersect(new Set(), new Set())).toBe(0);
    });
});

// ============================================================
// byBestScore tests
// ============================================================

describe('byBestScore', () => {
    it('prefers recipe with more role gain', () => {
        const needed = new Set(['role:protein', 'role:starch']);
        const a = { roles: new Set(['role:protein']) };
        const b = { roles: new Set(['role:protein', 'role:starch']) };
        // b should come first (higher gain), so byBestScore should return positive
        expect(byBestScore(a, b, needed)).toBeGreaterThan(0);
    });

    it('prefers recipe with fewer roles when gain is equal', () => {
        const needed = new Set(['role:protein']);
        const a = { roles: new Set(['role:protein', 'role:starch']) };
        const b = { roles: new Set(['role:protein']) };
        // Both have gain=1, but b has fewer roles, so a vs b should favor b
        expect(byBestScore(a, b, needed)).toBeGreaterThan(0);
    });
});

// ============================================================
// No-repeat filtering tests (trySelectCompleteMeal)
// ============================================================

describe('trySelectCompleteMeal', () => {
    // Helper to create a complete meal recipe (has all 3 roles)
    const makeCompleteRecipe = (id) => ({
        id,
        name: `Complete Meal ${id}`,
        roles: new Set(['role:protein', 'role:starch', 'role:vegetable']),
    });

    it('selects a recipe from the complete pool', () => {
        const pool = [makeCompleteRecipe('recipe-1'), makeCompleteRecipe('recipe-2')];
        const recentIds = new Set();

        const result = trySelectCompleteMeal(pool, recentIds);

        expect(result).not.toBeNull();
        expect(result.length).toBe(1);
        expect(['recipe-1', 'recipe-2']).toContain(result[0].recipeId);
    });

    it('excludes recipes that are in the recent set', () => {
        const pool = [
            makeCompleteRecipe('recent-recipe'),
            makeCompleteRecipe('fresh-recipe'),
        ];
        const recentIds = new Set(['recent-recipe']);

        const result = trySelectCompleteMeal(pool, recentIds);

        expect(result).not.toBeNull();
        expect(result[0].recipeId).toBe('fresh-recipe');
    });

    it('returns null when all recipes are recent', () => {
        const pool = [
            makeCompleteRecipe('recipe-1'),
            makeCompleteRecipe('recipe-2'),
        ];
        const recentIds = new Set(['recipe-1', 'recipe-2']);

        const result = trySelectCompleteMeal(pool, recentIds);

        expect(result).toBeNull();
    });

    it('adds selected recipe to the recent set', () => {
        const pool = [makeCompleteRecipe('recipe-1')];
        const recentIds = new Set();

        trySelectCompleteMeal(pool, recentIds);

        expect(recentIds.has('recipe-1')).toBe(true);
    });

    it('returns null for empty pool', () => {
        const result = trySelectCompleteMeal([], new Set());
        expect(result).toBeNull();
    });
});

// ============================================================
// No-repeat filtering tests (buildMealFromComponents)
// ============================================================

describe('buildMealFromComponents', () => {
    // Helper to create role-specific recipes
    const makeProtein = (id) => ({
        id,
        name: `Protein ${id}`,
        roles: new Set(['role:protein']),
    });

    const makeStarch = (id) => ({
        id,
        name: `Starch ${id}`,
        roles: new Set(['role:starch']),
    });

    const makeVeg = (id) => ({
        id,
        name: `Vegetable ${id}`,
        roles: new Set(['role:vegetable']),
    });

    it('builds a meal from component recipes', () => {
        const proteinPool = [makeProtein('p1')];
        const starchPool = [makeStarch('s1')];
        const vegPool = [makeVeg('v1')];
        const recentIds = new Set();

        const result = buildMealFromComponents(proteinPool, starchPool, vegPool, recentIds);

        expect(result.length).toBe(3);
        const ids = result.map(r => r.recipeId);
        expect(ids).toContain('p1');
        expect(ids).toContain('s1');
        expect(ids).toContain('v1');
    });

    it('excludes recent recipes from selection', () => {
        const proteinPool = [makeProtein('p-recent'), makeProtein('p-fresh')];
        const starchPool = [makeStarch('s1')];
        const vegPool = [makeVeg('v1')];
        const recentIds = new Set(['p-recent']);

        const result = buildMealFromComponents(proteinPool, starchPool, vegPool, recentIds);

        const ids = result.map(r => r.recipeId);
        expect(ids).not.toContain('p-recent');
        expect(ids).toContain('p-fresh');
    });

    it('returns empty array when a required role cannot be filled', () => {
        const proteinPool = [makeProtein('p1')];
        const starchPool = [makeStarch('s1')];
        const vegPool = []; // No vegetables available!
        const recentIds = new Set();

        const result = buildMealFromComponents(proteinPool, starchPool, vegPool, recentIds);

        // Can only cover 2 roles, which meets minimum, but let's test with all recent
        const proteinPool2 = [makeProtein('p1')];
        const starchPool2 = [];
        const vegPool2 = [];
        const result2 = buildMealFromComponents(proteinPool2, starchPool2, vegPool2, new Set());

        // Only 1 role covered - should return empty
        expect(result2).toEqual([]);
    });

    it('adds all selected recipes to the recent set', () => {
        const proteinPool = [makeProtein('p1')];
        const starchPool = [makeStarch('s1')];
        const vegPool = [makeVeg('v1')];
        const recentIds = new Set();

        buildMealFromComponents(proteinPool, starchPool, vegPool, recentIds);

        expect(recentIds.has('p1')).toBe(true);
        expect(recentIds.has('s1')).toBe(true);
        expect(recentIds.has('v1')).toBe(true);
    });

    it('will not select the same recipe twice even if in multiple pools', () => {
        // A recipe that has both protein and starch
        const multiRole = {
            id: 'multi',
            name: 'Multi-role dish',
            roles: new Set(['role:protein', 'role:starch']),
        };
        const proteinPool = [multiRole];
        const starchPool = [multiRole];
        const vegPool = [makeVeg('v1')];
        const recentIds = new Set();

        const result = buildMealFromComponents(proteinPool, starchPool, vegPool, recentIds);

        // Should pick the multi-role dish once (covers protein + starch) and veg once
        expect(result.length).toBe(2);
        const ids = result.map(r => r.recipeId);
        expect(ids).toContain('multi');
        expect(ids).toContain('v1');
    });
});

// ============================================================
// Date window calculation tests (no-repeat lookback)
// ============================================================

describe('no-repeat date window', () => {
    it('calculates correct lookback window start', () => {
        // If planning starts on Jan 20 with 5-day no-repeat,
        // window should start on Jan 15
        const startDate = '2025-01-20';
        const noRepeatDays = 5;
        const windowStart = offsetDate(startDate, -noRepeatDays);

        expect(windowStart).toBe('2025-01-15');
    });

    it('lookback window includes enough days', () => {
        const startDate = '2025-01-20';
        const noRepeatDays = 7;
        const windowStart = offsetDate(startDate, -noRepeatDays);

        // Generate the dates in the lookback window
        const lookbackDates = rangeDays(windowStart, noRepeatDays);

        expect(lookbackDates.length).toBe(7);
        expect(lookbackDates[0]).toBe('2025-01-13');
        expect(lookbackDates[6]).toBe('2025-01-19'); // Day before start
    });

    it('handles month boundary in lookback', () => {
        const startDate = '2025-02-03';
        const noRepeatDays = 5;
        const windowStart = offsetDate(startDate, -noRepeatDays);

        expect(windowStart).toBe('2025-01-29');
    });

    it('handles year boundary in lookback', () => {
        const startDate = '2025-01-02';
        const noRepeatDays = 5;
        const windowStart = offsetDate(startDate, -noRepeatDays);

        expect(windowStart).toBe('2024-12-28');
    });
});
