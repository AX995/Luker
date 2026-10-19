// SPDX-License-Identifier: AGPL-3.0-or-later
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from '@jest/globals';

import * as constants from '../src/constants.js';
import * as users from '../src/users.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USERS_SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'src', 'users.js'), 'utf8');

// The body of migrateUserData, up to the next top-level export. Slicing the
// source (instead of matching the whole file) keeps the call-site assertion
// from being satisfied by an unrelated reference elsewhere in users.js.
function migrateUserDataBody() {
    const start = USERS_SOURCE.indexOf('export async function migrateUserData(');
    if (start === -1) {
        throw new Error('migrateUserData is not defined in src/users.js');
    }
    const rest = USERS_SOURCE.slice(start);
    const end = rest.indexOf('\nexport ', 1);
    return end === -1 ? rest : rest.slice(0, end);
}

describe('getMigrationBackupDirectory', () => {
    // Order matters: this case runs before the setter below mutates the
    // module-level PUBLIC_DIRECTORIES.backups.
    test('defaults to the relative backups directory under the server directory', () => {
        expect(users.getMigrationBackupDirectory(new Date('2026-10-19')))
            .toBe(path.join('backups/', '_migration', '2026-10-19'));
    });

    test('keeps an absolute backups directory absolute instead of prefixing the cwd', () => {
        constants.setBackupsDirectory('/abs/backups');
        const backupDirectory = users.getMigrationBackupDirectory(new Date('2026-10-19'));
        expect(backupDirectory).toBe(path.join('/abs/backups', '_migration', '2026-10-19'));
        expect(backupDirectory.startsWith(process.cwd())).toBe(false);
    });
});

describe('migrateUserData', () => {
    test('builds the migration backup path through getMigrationBackupDirectory', () => {
        const body = migrateUserDataBody();
        expect(body).toContain('getMigrationBackupDirectory(');
        // A revert to the inline path would reintroduce these and keep the
        // two behavioural cases above green, so pin the call site here.
        expect(body).not.toContain('_migration');
        expect(body).not.toContain('path.join(process.cwd(), PUBLIC_DIRECTORIES.backups');
    });
});
