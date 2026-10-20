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
