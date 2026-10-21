import { beforeAll, expect, test } from '@jest/globals';

import './_mocks/main-module-stack.js';

let normalizeAdvancedSettings;
let defaultSettings;

beforeAll(async () => {
    const mod = await import('../../public/scripts/extensions/memory-graph/main.js');
    normalizeAdvancedSettings = mod.normalizeAdvancedSettings;
    defaultSettings = mod.defaultSettings;
});

test('the key is not seeded into the settings defaults', () => {
    expect(Object.prototype.hasOwnProperty.call(defaultSettings, 'extractConcurrent')).toBe(false);
});

test('the key reads as false when neither input nor base carries it', () => {
    expect(normalizeAdvancedSettings({}, {}).extractConcurrent).toBe(false);
});

test('an explicit input value wins', () => {
    expect(normalizeAdvancedSettings({ extractConcurrent: true }, {}).extractConcurrent).toBe(true);
    expect(normalizeAdvancedSettings({ extractConcurrent: false }, { extractConcurrent: true }).extractConcurrent).toBe(false);
});

test('a non-boolean input falls back to the base', () => {
    expect(normalizeAdvancedSettings({ extractConcurrent: 'yes' }, { extractConcurrent: true }).extractConcurrent).toBe(true);
});
