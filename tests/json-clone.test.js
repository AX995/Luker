import { describe, expect, test } from '@jest/globals';

import { cloneAsJsonWire } from '../public/scripts/util/json-clone.js';

describe('cloneAsJsonWire', () => {
    test('returns a detached clone for JSON-shaped values', () => {
        const value = { a: { b: 1 } };
        const cloned = cloneAsJsonWire(value);

        expect(cloned).toEqual(value);
        expect(cloned).not.toBe(value);
        expect(cloned.a).not.toBe(value.a);
    });

    test('preserves values shared between sibling properties', () => {
        const shared = [0, 1, 2];
        const value = {
            fn() {},
            first: { placement: shared },
            second: { placement: shared },
        };

        expect(cloneAsJsonWire(value)).toEqual({
            first: { placement: [0, 1, 2] },
            second: { placement: [0, 1, 2] },
        });
    });

    test('drops functions and symbols and normalizes JSON shapes', () => {
        const sparse = [];
        sparse.length = 2;
        sparse[1] = 'x';

        const value = {
            fn() {},
            [Symbol('key')]: 'symbol-key',
            when: new Date('2020-01-02T03:04:05.000Z'),
            bad: NaN,
            sparse,
        };

        expect(cloneAsJsonWire(value)).toEqual({
            when: '2020-01-02T03:04:05.000Z',
            bad: null,
            sparse: [null, 'x'],
        });
    });

    test('returns undefined for undefined input', () => {
        expect(cloneAsJsonWire(undefined)).toBeUndefined();
    });

    test('throws on true cycles', () => {
        const value = { name: 'root' };
        value.self = value;

        expect(() => cloneAsJsonWire(value)).toThrow(/circular/i);
    });

    test('throws on bigint', () => {
        expect(() => cloneAsJsonWire({ count: 10n })).toThrow(/BigInt/i);
    });
});
