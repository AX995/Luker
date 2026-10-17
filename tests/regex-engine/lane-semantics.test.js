/**
 * Lane-semantics matrix for getRegexedString.
 *
 * Contract:
 *   - The three scope flags are independent channel switches. None of
 *     them changes the meaning of another.
 *   - `isPrompt` lane applies promptOnly scripts (main generation
 *     pipeline), whether or not pluginOnly is also set.
 *   - `isMarkdown` lane applies markdownOnly scripts (chat display),
 *     whether or not pluginOnly is also set.
 *   - `isPluginInput` lane applies pluginOnly scripts: text going INTO
 *     a plugin request.
 *   - `isPluginOutput` lane applies pluginOnly scripts: the assistant
 *     text a plugin request returns.
 *   - A pluginOnly script therefore hits both plugin directions; the
 *     directions are disjoint text streams, so it never fires twice on
 *     the same text.
 *   - Depth filtering only runs when a numeric depth is passed.
 *   - A script with no scope flags matches only the unscoped lane
 *     (!isMarkdown && !isPrompt && !isPluginInput && !isPluginOutput).
 */

import { describe, test, expect, beforeAll, jest } from '@jest/globals';

jest.unstable_mockModule('../../public/script.js', () => ({
    characters: {},
    saveSettingsDebounced: () => {},
    substituteParams: (s) => s,
    substituteParamsExtended: (s) => s,
    this_chid: null,
}));

const extensionSettings = {
    disabledExtensions: [],
    regex: [
        {
            id: 'script-prompt-only',
            scriptName: 'A promptOnly',
            findRegex: '/MAINONLY/g',
            replaceString: 'main',
            placement: [1, 2],
            disabled: false,
            markdownOnly: false,
            promptOnly: true,
            minDepth: null,
            maxDepth: null,
        },
        {
            id: 'script-plugin-only',
            scriptName: 'B pluginOnly',
            findRegex: '/PLUGINONLY/g',
            replaceString: 'plugin',
            placement: [1, 2],
            disabled: false,
            markdownOnly: false,
            pluginOnly: true,
            minDepth: 5,
            maxDepth: null,
        },
        {
            id: 'script-dual-scope',
            scriptName: 'Dual-scope rule',
            findRegex: '/DUAL/g',
            replaceString: 'both',
            placement: [1, 2],
            disabled: false,
            markdownOnly: false,
            promptOnly: true,
            pluginOnly: true,
            minDepth: null,
            maxDepth: null,
        },
        {
            id: 'script-display-and-plugin',
            scriptName: 'Display and plugin rule',
            findRegex: '/DISPLAYPLUGIN/g',
            replaceString: 'twolanes',
            placement: [1, 2],
            disabled: false,
            markdownOnly: true,
            pluginOnly: true,
            minDepth: null,
            maxDepth: null,
        },
        {
            id: 'script-unscoped',
            scriptName: 'Unscoped rule',
            findRegex: '/UNSCOPED/g',
            replaceString: 'raw',
            placement: [1, 2],
            disabled: false,
            minDepth: null,
            maxDepth: null,
        },
    ],
};

jest.unstable_mockModule('../../public/scripts/extensions.js', () => ({
    extension_settings: extensionSettings,
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

let getRegexedString;

beforeAll(async () => {
    ({ getRegexedString } = await import('../../public/scripts/extensions/regex/engine.js'));
});

// placement 1 = USER_INPUT
const PLACEMENT = 1;

describe('getRegexedString lane semantics', () => {
    test('isPrompt lane applies promptOnly scripts, including dual-scope ones', () => {
        const out = getRegexedString('x MAINONLY y PLUGINONLY z DUAL w UNSCOPED', PLACEMENT, { isPrompt: true, depth: 9 });
        expect(out).toBe('x main y PLUGINONLY z both w UNSCOPED');
    });

    test('isPluginInput lane applies pluginOnly scripts, including dual-scope ones', () => {
        const out = getRegexedString('x MAINONLY y PLUGINONLY z DUAL w UNSCOPED', PLACEMENT, { isPluginInput: true, depth: 9 });
        expect(out).toBe('x MAINONLY y plugin z both w UNSCOPED');
    });

    test('isPluginOutput lane applies pluginOnly scripts, including dual-scope ones', () => {
        const out = getRegexedString('x MAINONLY y PLUGINONLY z DUAL w UNSCOPED', PLACEMENT, { isPluginOutput: true, depth: 9 });
        expect(out).toBe('x MAINONLY y plugin z both w UNSCOPED');
    });

    test('markdownOnly and pluginOnly on one script hit the display lane and both plugin lanes', () => {
        expect(getRegexedString('DISPLAYPLUGIN', PLACEMENT, { isMarkdown: true })).toBe('twolanes');
        expect(getRegexedString('DISPLAYPLUGIN', PLACEMENT, { isPluginInput: true, depth: 0 })).toBe('twolanes');
        expect(getRegexedString('DISPLAYPLUGIN', PLACEMENT, { isPluginOutput: true, depth: 0 })).toBe('twolanes');
        // No promptOnly flag, so the main pipeline stays untouched.
        expect(getRegexedString('DISPLAYPLUGIN', PLACEMENT, { isPrompt: true, depth: 0 })).toBe('DISPLAYPLUGIN');
    });

    test('promptOnly and pluginOnly on one script hit the main lane and both plugin lanes', () => {
        expect(getRegexedString('DUAL', PLACEMENT, { isPrompt: true, depth: 0 })).toBe('both');
        expect(getRegexedString('DUAL', PLACEMENT, { isPluginInput: true, depth: 0 })).toBe('both');
        expect(getRegexedString('DUAL', PLACEMENT, { isPluginOutput: true, depth: 0 })).toBe('both');
    });

    test('depth=undefined skips minDepth/maxDepth filtering (undepthed plugin output message still matches)', () => {
        // pluginOnly script has minDepth:5; with numeric depth 0 it must NOT match...
        expect(getRegexedString('PLUGINONLY', PLACEMENT, { isPluginOutput: true, depth: 0 })).toBe('PLUGINONLY');
        // ...but with no depth the filter is skipped entirely.
        expect(getRegexedString('PLUGINONLY', PLACEMENT, { isPluginOutput: true })).toBe('plugin');
    });

    test('unscoped script only matches the default lane', () => {
        expect(getRegexedString('UNSCOPED', PLACEMENT, {})).toBe('raw');
        expect(getRegexedString('UNSCOPED', PLACEMENT, { isPrompt: true, depth: 0 })).toBe('UNSCOPED');
        expect(getRegexedString('UNSCOPED', PLACEMENT, { isPluginInput: true, depth: 0 })).toBe('UNSCOPED');
        expect(getRegexedString('UNSCOPED', PLACEMENT, { isPluginOutput: true, depth: 0 })).toBe('UNSCOPED');
        expect(getRegexedString('UNSCOPED', PLACEMENT, { isMarkdown: true })).toBe('UNSCOPED');
    });
});
