/**
 * Verifies that a rejected extraction operation is surfaced as a batch
 * failure instead of being silently dropped.
 *
 * Contract:
 *   - `applyExtractionOpsImpl` still returns `{ applied, rejected }` and
 *     never throws on an individual op failure (public write-api depends
 *     on that report shape).
 *   - `assertExtractionOpsApplied(result)` throws when `rejected` is
 *     non-empty, naming the count and the first rejection; it returns
 *     normally when nothing was rejected.
 *   - `processPendingMessageBatchWithLLM` calls it right after applying, so
 *     the throw reaches the batch loop's rollback-and-retry path.
 */

import { describe, test, expect, beforeAll } from '@jest/globals';
import './_mocks/main-module-stack.js';

let createEmptyStore;
let applyExtractionOpsImpl;
let assertExtractionOpsApplied;

beforeAll(async () => {
    const persistence = await import('../../public/scripts/extensions/memory-graph/persistence.js');
    createEmptyStore = persistence.createEmptyStore;
    const main = await import('../../public/scripts/extensions/memory-graph/main.js');
    applyExtractionOpsImpl = main.applyExtractionOpsImpl;
    assertExtractionOpsApplied = main.assertExtractionOpsApplied;
});

describe('assertExtractionOpsApplied', () => {
    test('throws when an operation was rejected', () => {
        const store = createEmptyStore();
        const result = applyExtractionOpsImpl(store, [
            { op: 'edit', nodeId: 'nope', setFields: {} },
        ]);
        expect(result.rejected.length).toBeGreaterThan(0);
        expect(() => assertExtractionOpsApplied(result)).toThrow(/rejected/);
    });

    test('names the first rejection in the error message', () => {
        const store = createEmptyStore();
        const result = applyExtractionOpsImpl(store, [
            { op: 'edit', nodeId: 'nope', setFields: {} },
        ]);
        expect(() => assertExtractionOpsApplied(result))
            .toThrow(/Extraction operations rejected: 1 \(first: NODE_NOT_FOUND /);
    });

    test('does not throw when nothing was rejected', () => {
        const result = { applied: [], rejected: [] };
        expect(() => assertExtractionOpsApplied(result)).not.toThrow();
    });
});
