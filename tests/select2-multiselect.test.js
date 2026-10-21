import { describe, expect, test } from '@jest/globals';
import {
    buildBulkDeleteConfirmBody,
    createSelectionState,
    escapeHtmlText,
} from '../public/scripts/select2-multiselect.js';

describe('escapeHtmlText', () => {
    test('escapes the five html-significant characters', () => {
        expect(escapeHtmlText('<b>&"\'</b>')).toBe('&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
    });

    test('stringifies null and undefined to an empty string', () => {
        expect(escapeHtmlText(null)).toBe('');
        expect(escapeHtmlText(undefined)).toBe('');
    });
});

describe('buildBulkDeleteConfirmBody', () => {
    test('puts each name on its own line, in order', () => {
        expect(buildBulkDeleteConfirmBody(['reef', 'drifters'])).toBe('· reef<br>· drifters');
    });

    test('escapes names so markup in a name cannot break out', () => {
        expect(buildBulkDeleteConfirmBody(['<img src=x onerror=1>']))
            .toBe('· &lt;img src=x onerror=1&gt;');
    });

    test('returns an empty string for an empty list', () => {
        expect(buildBulkDeleteConfirmBody([])).toBe('');
    });
});

describe('createSelectionState', () => {
    test('toggle flips membership and reports the new state', () => {
        const state = createSelectionState();
        expect(state.toggle('a')).toBe(true);
        expect(state.has('a')).toBe(true);
        expect(state.toggle('a')).toBe(false);
        expect(state.has('a')).toBe(false);
    });

    test('add and remove take iterables and are idempotent', () => {
        const state = createSelectionState();
        state.add(['a', 'b', 'a']);
        expect(state.size()).toBe(2);
        state.remove(['a', 'z']);
        expect(state.values()).toEqual(['b']);
    });

    test('values keeps insertion order and clear empties the set', () => {
        const state = createSelectionState();
        state.add(['c', 'a', 'b']);
        expect(state.values()).toEqual(['c', 'a', 'b']);
        state.clear();
        expect(state.size()).toBe(0);
        expect(state.values()).toEqual([]);
    });

    test('coerces values to strings so numeric option values compare', () => {
        const state = createSelectionState();
        state.toggle(3);
        expect(state.has('3')).toBe(true);
    });
});
