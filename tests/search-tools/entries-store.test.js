/**
 * search-tools managed-entry store tests.
 *
 * The store keeps one evolving payload in floor-state:
 *   { entries: { [entryId]: { title, keywords, content, alwaysInject } } }
 * and commits the prev→next diff on every search-agent run, so entries
 * that did not change are never re-serialized into the log.
 *
 * Harness mirrors tests/search-tools/persistence.test.js: a hand-rolled
 * chat-state store + event source wired through createFloorStateWithDeps,
 * plus a context shim that exposes createFloorState.
 */

import { describe, test, expect, beforeEach } from '@jest/globals';

import { createFloorStateWithDeps } from '../../public/scripts/floor-state.js';
import {
    commitManagedEntries,
    loadManagedEntries,
    resetFloorStateInstanceForTesting,
    constants as bindingConstants,
} from '../../public/scripts/extensions/search-tools/persistence.js';

function makeStore() {
    const partitions = new Map();
    function partitionFor(target) {
        const key = target && typeof target === 'object'
            ? (target.is_group ? `g:${target.id ?? ''}` : `c:${target.avatar_url ?? ''}/${target.file_name ?? ''}`)
            : '';
        if (!partitions.has(key)) partitions.set(key, new Map());
        return partitions.get(key);
    }
    return {
        async getChatState(ns, options) {
            const k = String(ns ?? '').trim().toLowerCase();
            const v = partitionFor(options?.target).get(k);
            return { ok: true, state: v == null ? null : structuredClone(v) };
        },
        async patchChatState(ns, ops, options) {
            const k = String(ns ?? '').trim().toLowerCase();
            const part = partitionFor(options?.target);
            const current = part.get(k) ?? {};
            const { applyPatch } = await import('../../public/scripts/util/fast-json-patch.js');
            const next = structuredClone(current);
            applyPatch(next, ops, false, true);
            part.set(k, next);
            return true;
        },
        async updateChatState(ns, updater, options) {
            const k = String(ns ?? '').trim().toLowerCase();
            const part = partitionFor(options?.target);
            const current = part.get(k) ?? null;
            const next = await updater(current == null ? null : structuredClone(current));
            if (next === null || next === undefined) part.delete(k);
            else part.set(k, structuredClone(next));
            return { ok: true, state: part.get(k) ?? null, updated: true };
        },
        get _raw() { return partitionFor(undefined); },
    };
}

const EVENT_TYPES = {
    CHAT_CHANGED: 'chat_id_changed',
    MESSAGE_SWIPED: 'message_swiped',
    MESSAGE_DELETED: 'message_deleted',
    MESSAGE_SWIPE_DELETED: 'message_swipe_deleted',
    CHAT_BRANCH_CREATED: 'chat_branch_created',
};

function makeEventSource() {
    const listeners = new Map();
    const boundInstances = new Set();
    return {
        on(name, fn) {
            if (!listeners.has(name)) listeners.set(name, new Set());
            listeners.get(name).add(fn);
        },
        removeListener(name, fn) { listeners.get(name)?.delete(fn); },
        async emit(name, ...args) {
            for (const inst of boundInstances) {
                switch (name) {
                    case EVENT_TYPES.MESSAGE_DELETED:
                        await inst.__handleMessageDeleted(args[0]);
                        break;
                    case EVENT_TYPES.MESSAGE_SWIPED:
                        await inst.__handleMessageSwiped();
                        break;
                    case EVENT_TYPES.MESSAGE_SWIPE_DELETED:
                        await inst.__handleSwipeDeleted(args[0]);
                        break;
                    case EVENT_TYPES.CHAT_CHANGED:
                        await inst.__handleChatChanged();
                        break;
                }
            }
            const set = listeners.get(name);
            if (!set) return;
            for (const fn of Array.from(set)) await fn(...args);
        },
        _bindInstance(inst) { boundInstances.add(inst); },
        _unbindInstance(inst) { boundInstances.delete(inst); },
    };
}

async function buildObjectPatchOperationsAsync(prev, next) {
    const { compare } = await import('../../public/scripts/util/fast-json-patch.js');
    return compare(prev ?? {}, next ?? {});
}

function makeContext(chatRef) {
    const store = makeStore();
    const eventSource = makeEventSource();
    const fsDeps = {
        getChatState: store.getChatState.bind(store),
        patchChatState: store.patchChatState.bind(store),
        updateChatState: store.updateChatState.bind(store),
        buildObjectPatchOperationsAsync,
        eventSource,
        event_types: EVENT_TYPES,
        getChat: () => chatRef.value,
    };
    const context = {
        getChatState: fsDeps.getChatState,
        patchChatState: fsDeps.patchChatState,
        updateChatState: fsDeps.updateChatState,
        deleteChatState: async (ns) => {
            store._raw.delete(String(ns ?? '').trim().toLowerCase());
            return { ok: true };
        },
        buildObjectPatchOperationsAsync,
        async createFloorState({ namespace }) {
            const instance = createFloorStateWithDeps({ namespace }, fsDeps);
            eventSource._bindInstance(instance);
            return instance;
        },
    };
    Object.defineProperty(context, 'chat', { get() { return chatRef.value; } });
    return { store, eventSource, context };
}

function userMsg(text, { swipe_id = 0 } = {}) {
    return { is_user: true, is_system: false, mes: String(text), swipe_id };
}
function asstMsg(text) {
    return { is_user: false, is_system: false, mes: String(text), swipe_id: 0 };
}

function entry(entryId, body) {
    return {
        entryId,
        title: `title-${entryId}`,
        keywords: [`kw-${entryId}`],
        content: body,
        alwaysInject: false,
    };
}

async function readLog(store) {
    const result = await store.getChatState(`${bindingConstants.STATE_NAMESPACE}__floor_log`, {});
    return result.state;
}

beforeEach(() => {
    resetFloorStateInstanceForTesting();
});

describe('managed-entry store', () => {
    test('a second commit serializes only the entries that changed', async () => {
        const chatRef = { value: [userMsg('q1'), asstMsg('a1'), userMsg('q2'), asstMsg('a2')] };
        const { store, context } = makeContext(chatRef);
        const body = 'B'.repeat(400);

        const first = await commitManagedEntries(context, { playableFloor: 3 }, [
            entry('e1', `A: ${body}`),
            entry('e2', `B: ${body}`),
        ]);
        expect(first.ok).toBe(true);

        const second = await commitManagedEntries(context, { playableFloor: 3 }, [
            entry('e1', `A: ${body}`),
            entry('e2', `B: ${body}`),
            entry('e3', `C: ${body}`),
        ]);
        expect(second.ok).toBe(true);

        const log = await readLog(store);
        expect(log.commits).toHaveLength(2);

        const secondPaths = log.commits[1].patches.map((op) => op.path);
        expect(secondPaths).toEqual(['/entries/e3']);

        const firstBytes = JSON.stringify(log.commits[0].patches).length;
        const secondBytes = JSON.stringify(log.commits[1].patches).length;
        expect(secondBytes).toBeLessThan(firstBytes);
    });

    test('the payload exposes the current entry set keyed by entryId', async () => {
        const chatRef = { value: [userMsg('q1'), asstMsg('a1'), userMsg('q2'), asstMsg('a2')] };
        const { context } = makeContext(chatRef);

        await commitManagedEntries(context, { playableFloor: 3 }, [
            entry('e1', 'A'),
            entry('e2', 'B'),
        ]);

        const entries = await loadManagedEntries(context);
        expect(Object.keys(entries).sort()).toEqual(['e1', 'e2']);
        expect(entries.e1.title).toBe('title-e1');
    });

    test('a later run drops entries that are absent from its result', async () => {
        const chatRef = { value: [userMsg('q1'), asstMsg('a1'), userMsg('q2'), asstMsg('a2')] };
        const { context } = makeContext(chatRef);

        await commitManagedEntries(context, { playableFloor: 3 }, [entry('e1', 'A'), entry('e2', 'B')]);
        await commitManagedEntries(context, { playableFloor: 3 }, [entry('e2', 'B'), entry('e3', 'C')]);

        const entries = await loadManagedEntries(context);
        expect(Object.keys(entries).sort()).toEqual(['e2', 'e3']);
    });

    test('a legacy { [playableFloor]: snapshot } payload is read and replaced with self-contained operations', async () => {
        const chatRef = { value: [userMsg('q1'), asstMsg('a1'), userMsg('q2'), asstMsg('a2')] };
        const { store, context } = makeContext(chatRef);

        store._raw.set(`${bindingConstants.STATE_NAMESPACE}__floor_log`, {
            version: 1,
            commits: [{
                floor: 2,
                swipeId: 0,
                patches: [{
                    op: 'add',
                    path: '/3',
                    value: {
                        anchorHash: 'legacy-hash',
                        updatedAt: '2026-01-01T00:00:00.000Z',
                        summary: '',
                        mutationCount: 1,
                        managedEntryCount: 2,
                        bookName: '__SEARCH_TOOLS__',
                        managedEntries: [entry('e1', 'A'), entry('e2', 'B')],
                    },
                }],
            }],
        });

        const legacyEntries = await loadManagedEntries(context);
        expect(Object.keys(legacyEntries).sort()).toEqual(['e1', 'e2']);

        const result = await commitManagedEntries(context, { playableFloor: 3 }, [entry('e2', 'B'), entry('e3', 'C')]);
        expect(result.ok).toBe(true);

        const log = await readLog(store);
        const patches = log.commits[1].patches;
        expect(patches.map((op) => op.path).sort()).toEqual(['/3', '/entries']);

        // The migration commit must survive replay even when the legacy commit
        // it was diffed against has been dropped: floor-state's replay applies
        // patches in place against `{}` and ignores the returned document, so
        // only in-place root operations are safe.
        const { applyPatch } = await import('../../public/scripts/util/fast-json-patch.js');
        const replayed = {};
        applyPatch(replayed, patches, false, true);
        expect(Object.keys(replayed.entries).sort()).toEqual(['e2', 'e3']);
    });

    test('rejects an anchor with no playableFloor', async () => {
        const chatRef = { value: [userMsg('q1')] };
        const { context } = makeContext(chatRef);
        expect((await commitManagedEntries(context, { playableFloor: 0 }, [entry('e1', 'A')])).ok).toBe(false);
    });

    test('rejects an anchor whose playable floor is not a user message', async () => {
        const chatRef = { value: [asstMsg('a1')] };
        const { context } = makeContext(chatRef);
        const result = await commitManagedEntries(context, { playableFloor: 1 }, [entry('e1', 'A')]);
        expect(result.ok).toBe(false);
        expect(await loadManagedEntries(context)).toEqual({});
    });

    test('swiping the owning user turn drops its entries', async () => {
        const chatRef = { value: [userMsg('q1', { swipe_id: 0 }), asstMsg('a1')] };
        const { eventSource, context } = makeContext(chatRef);
        await commitManagedEntries(context, { playableFloor: 1 }, [entry('e1', 'A')]);
        expect(Object.keys(await loadManagedEntries(context))).toEqual(['e1']);

        chatRef.value[0] = userMsg('q1-alt', { swipe_id: 1 });
        await eventSource.emit(EVENT_TYPES.MESSAGE_SWIPED, 0);

        expect(await loadManagedEntries(context)).toEqual({});
    });

    test('swiping a message other than the owning turn keeps the entries', async () => {
        const chatRef = { value: [userMsg('q1', { swipe_id: 0 }), asstMsg('a1', { swipe_id: 0 })] };
        const { eventSource, context } = makeContext(chatRef);
        await commitManagedEntries(context, { playableFloor: 1 }, [entry('e1', 'A')]);

        chatRef.value[1] = asstMsg('a1-alt', { swipe_id: 1 });
        await eventSource.emit(EVENT_TYPES.MESSAGE_SWIPED, 1);

        expect(Object.keys(await loadManagedEntries(context))).toEqual(['e1']);
    });
});
