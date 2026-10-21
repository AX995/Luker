/**
 * Verifies that force-update node types do not carry an extraction cadence:
 *   - `readSchemaCard` omits `extractEveryN` when the card's force-update box
 *     is ticked, and still emits a numeric value when it is not
 *   - the default `event` type (force-update) ships without `extractEveryN`
 *   - `normalizeNodeTypeSchema` does not synthesize `extractEveryN` for
 *     force-update types, but leaves an already-persisted value untouched
 *
 * main.js transitively pulls script.js / lib.js / popup.js etc. at module
 * load. The shared mock stack at `./_mocks/main-module-stack.js` registers
 * the jest.unstable_mockModule calls at import time so main.js loads under
 * jest. That side-effect import MUST come before any SUT import.
 *
 * `readSchemaCard` drives the editor card through jQuery. We swap the global
 * jQuery for a minimal stub whose `find('[data-field="..."]')` reads back the
 * field values recorded on a plain card object, so no jsdom is required.
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import './_mocks/main-module-stack.js';

let readSchemaCard;
let normalizeNodeTypeSchema;
let getDefaultNodeTypeSchema;
let originalJQuery;

// Minimal card element: `readSchemaCard` only needs `jQuery(card).find(...)`.
function makeCard(fields) {
    return { __fields: fields };
}

function installJQueryStub() {
    const readField = (fields, selector) => {
        const match = /data-field="([^"]+)"/.exec(selector);
        const name = match ? match[1] : '';
        const value = fields ? fields[name] : undefined;
        return {
            val: () => value,
            prop: () => Boolean(value),
            map: () => ({ get: () => (Array.isArray(value) ? value : []) }),
        };
    };
    return (target) => ({
        find: (selector) => readField(target && target.__fields, selector),
    });
}

beforeAll(async () => {
    const mod = await import('../../public/scripts/extensions/memory-graph/main.js');
    readSchemaCard = mod.readSchemaCard;
    normalizeNodeTypeSchema = mod.normalizeNodeTypeSchema;
    getDefaultNodeTypeSchema = mod.getDefaultNodeTypeSchema;
    originalJQuery = globalThis.jQuery;
    globalThis.jQuery = installJQueryStub();
});

afterAll(() => {
    globalThis.jQuery = originalJQuery;
});

describe('readSchemaCard — force-update cards drop the cadence field', () => {
    test('force-update ticked: result has no extractEveryN key', () => {
        const card = makeCard({ forceUpdate: true, extractEveryN: '3' });
        expect('extractEveryN' in readSchemaCard(card)).toBe(false);
    });

    test('force-update unticked: result carries a numeric extractEveryN', () => {
        const card = makeCard({ forceUpdate: false, extractEveryN: '3' });
        const out = readSchemaCard(card);
        expect('extractEveryN' in out).toBe(true);
        expect(out.extractEveryN).toBe(3);
    });

    test('force-update unticked with a blank cadence clamps to 1', () => {
        const out = readSchemaCard(makeCard({ forceUpdate: false, extractEveryN: '' }));
        expect(out.extractEveryN).toBe(1);
    });
});

describe('default node-type schema — event carries no cadence', () => {
    test('event ships without extractEveryN', () => {
        const event = getDefaultNodeTypeSchema().find(t => t.id === 'event');
        expect(event).toBeDefined();
        expect('extractEveryN' in event).toBe(false);
    });
});

describe('normalizeNodeTypeSchema — cadence guard for force-update types', () => {
    test('force-update entry without extractEveryN comes out without the key', () => {
        const out = normalizeNodeTypeSchema([
            { id: 'event', forceUpdate: true, tableName: 'event_table' },
        ]);
        const event = out.find(t => t.id === 'event');
        expect(event).toBeDefined();
        expect('extractEveryN' in event).toBe(false);
    });

    test('force-update entry with a persisted extractEveryN keeps its value', () => {
        const out = normalizeNodeTypeSchema([
            { id: 'event', forceUpdate: true, extractEveryN: 4, tableName: 'event_table' },
        ]);
        const event = out.find(t => t.id === 'event');
        expect(event.extractEveryN).toBe(4);
    });

    test('non-force-update entry still gets extractEveryN filled', () => {
        const out = normalizeNodeTypeSchema([
            { id: 'custom', forceUpdate: false, tableName: 'custom_table' },
        ]);
        const custom = out.find(t => t.id === 'custom');
        expect(custom.extractEveryN).toBe(1);
    });
});
