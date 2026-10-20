// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 FunnyCups (https://github.com/funnycups)

import fs from 'node:fs';

/**
 * Put a freshly downloaded copy of the bundle in the place of the one that is
 * running. A running self-contained bundle is mounted, so its file cannot be
 * written in place; the download is staged under a temporary name in the same
 * directory — one filesystem, so the final move is a rename — marked executable
 * the way the packaging step does, and renamed over the target. A failure at
 * any step removes the staged file and propagates.
 * @param {{ appImagePath: string, downloadPath: string }} options
 * @returns {Promise<string>} the path that was replaced
 */
export async function replaceRunningAppImage({ appImagePath, downloadPath }) {
    const stagingPath = `${appImagePath}.update`;
    try {
        fs.copyFileSync(downloadPath, stagingPath);
        fs.chmodSync(stagingPath, 0o755);
        fs.renameSync(stagingPath, appImagePath);
    } catch (error) {
        fs.rmSync(stagingPath, { force: true });
        throw error;
    }

    return appImagePath;
}
