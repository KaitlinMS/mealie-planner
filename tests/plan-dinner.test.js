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
