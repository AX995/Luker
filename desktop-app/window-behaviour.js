// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 FunnyCups (https://github.com/funnycups)

/**
 * Whether closing the window hides it instead of quitting. Hiding only works
 * where something else can bring the window back: a tray icon or an
 * application menu the platform itself keeps around. Linux has neither, so a
 * hidden window there would have no way back.
 * @param {NodeJS.Platform} platform
 * @returns {boolean}
 */
export function hidesOnClose(platform) {
    return platform !== 'linux';
}

/**
 * Whether this platform carries a tray icon. Windows tucks the app into its
 * notification area; the other platforms do not.
 * @param {NodeJS.Platform} platform
 * @returns {boolean}
 */
export function usesTray(platform) {
    return platform === 'win32';
}

/**
 * Which devtools action a key event triggers, or null when the key is not a
 * devtools shortcut. macOS always returns null: its application menu already
 * binds the toggle, so a second handler there would fire alongside the menu
 * accelerator and the two would cancel out.
 * @param {NodeJS.Platform} platform
 * @param {{key?: string, control?: boolean, shift?: boolean}} input
 * @returns {'toggle' | null}
 */
export function devtoolsShortcutFor(platform, input) {
    if (platform === 'darwin') {
        return null;
    }

    const key = String(input?.key ?? '');
    if (key === 'F12') {
        return 'toggle';
    }

    // Shift makes the reported key an uppercase 'I', so compare case-insensitively.
    if (input?.control && input?.shift && key.toLowerCase() === 'i') {
        return 'toggle';
    }

    return null;
}
