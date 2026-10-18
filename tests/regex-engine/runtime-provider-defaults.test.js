/**
 * Field defaults for runtime regex providers.
 *
 * Contract:
 *   - Scripts handed in at runtime bypass the regex editor, which is the
 *     only writer that guarantees `trimStrings` exists.
 *   - A script whose replaceString references a capture group reaches
 *     filterString(), which iterates trimStrings; a missing value must
 *     not abort the regex pass.
 *   - Both runtime entry points (the callback provider and the managed
 *     provider) fill the field.
 */

import { describe, test, expect, beforeAll, jest } from '@jest/globals';

jest.unstable_mockModule('../../public/script.js', () => ({
    characters: {},
    saveSettingsDebounced: () => {},
    substituteParams: (s) => s,
    substituteParamsExtended: (s) => s,
    this_chid: null,
}));

jest.unstable_mockModule('../../public/scripts/extensions.js', () => ({
    extension_settings: { disabledExtensions: [], regex: [] },
    writeExtensionField: () => {},
}));

jest.unstable_mockModule('../../public/scripts/i18n.js', () => ({ t: (s) => s }));
jest.unstable_mockModule('../../public/scripts/preset-manager.js', () => ({ getPresetManager: () => null }));
jest.unstable_mockModule('../../public/scripts/utils.js', () => ({
    regexFromString: (input) => {
        if (typeof input !== 'string') return null;
        const m = input.match(/\/(.+)\/([gimsuy]*)/s);
        return m ? new RegExp(m[1], m[2]) : new RegExp(input);
    },
}));
jest.unstable_mockModule('../../public/scripts/popup.js', () => ({
    callGenericPopup: () => Promise.resolve(false),
    POPUP_RESULT: { AFFIRMATIVE: 1 },
    POPUP_TYPE: { CONFIRM: 1 },
}));
jest.unstable_mockModule('../../public/scripts/extensions/regex/redos-reporter.js', () => ({
    isRegexScriptPaused: () => false,
    recordRegexExecution: () => {},
    resetRegexScriptState: () => {},
}));

let engine;

beforeAll(async () => {
    engine = await import('../../public/scripts/extensions/regex/engine.js');
});

// placement 1 = USER_INPUT
const PLACEMENT = 1;

const baseScript = {
    placement: [PLACEMENT],
    disabled: false,
    markdownOnly: true,
    runOnEdit: false,
    substituteRegex: 0,
};

const captureGroupScript = (id, scriptName) => ({
    ...baseScript,
    id,
    scriptName,
    findRegex: '/\\[mood: (.*?)\\]/g',
    replaceString: '($1)',
});

describe('runtime regex provider field defaults', () => {
    test('callback provider script without trimStrings still substitutes its capture group', () => {
        engine.registerRegexProvider('test-raw-provider', () => [captureGroupScript('raw-no-trim', 'Raw without trimStrings')]);
        try {
            expect(engine.getRegexedString('[mood: happy]', PLACEMENT, { isMarkdown: true })).toBe('(happy)');
        } finally {
            engine.unregisterRegexProvider('test-raw-provider');
        }
    });

    test('managed provider script without trimStrings still substitutes its capture group', () => {
        const handle = engine.registerManagedRegexProvider('test-managed-provider');
        handle.upsertScript(captureGroupScript('managed-no-trim', 'Managed without trimStrings'));
        try {
            expect(engine.getRegexedString('[mood: happy]', PLACEMENT, { isMarkdown: true })).toBe('(happy)');
        } finally {
            handle.unregister();
        }
    });

    test('managed provider setScripts path without trimStrings still substitutes its capture group', () => {
        const handle = engine.registerManagedRegexProvider('test-managed-set-provider');
        handle.setScripts([captureGroupScript('managed-set-no-trim', 'Managed setScripts without trimStrings')]);
        try {
            expect(engine.getRegexedString('[mood: happy]', PLACEMENT, { isMarkdown: true })).toBe('(happy)');
        } finally {
            handle.unregister();
        }
    });
});
