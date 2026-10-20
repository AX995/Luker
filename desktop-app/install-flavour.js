// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 FunnyCups (https://github.com/funnycups)

import fs from 'node:fs';

// The package formats the release carries an asset for, named the way the
// packaging step records them in its marker file.
const KNOWN_PACKAGE_TYPES = ['deb', 'rpm'];

/**
 * How this copy of the shell was installed, as far as it can tell. A
 * self-contained Linux bundle puts its own path in the environment, and an
 * installed package carries a marker file next to the resources naming the
 * package format. A source run has neither, and a format this shell carries
 * no update asset for reports the same empty value.
 * @param {{ appImagePath?: string, packageTypePath?: string, isPackaged?: boolean }} [options]
 * @returns {'appimage'|'deb'|'rpm'|''}
 */
export function detectInstallFlavour({ appImagePath = '', packageTypePath = '', isPackaged = false } = {}) {
    if (appImagePath) {
        return 'appimage';
    }

    let packageType = '';
    try {
        packageType = fs.readFileSync(packageTypePath, 'utf8').trim();
    } catch {
        return '';
    }

    return KNOWN_PACKAGE_TYPES.includes(packageType) ? packageType : '';
}
