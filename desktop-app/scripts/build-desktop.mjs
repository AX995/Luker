// Build the installable desktop artifacts for one platform.
//
// The app version comes from the repository root manifest, so a desktop
// build never drifts from the server version it embeds. electron-builder
// receives it through `extraMetadata`, which is also what `artifactName`
// expands against.
//
// Usage: node scripts/build-desktop.mjs <mac|win|linux>

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { prepareBackend } from './prepare-backend.mjs';

const PLATFORMS = ['mac', 'win', 'linux'];
const platform = process.argv[2];

if (!PLATFORMS.includes(platform)) {
    console.error(`usage: node scripts/build-desktop.mjs <${PLATFORMS.join('|')}>`);
    process.exit(1);
}

const require = createRequire(import.meta.url);
const { version } = require('../../package.json');
const desktopDir = path.resolve(import.meta.dirname, '..');

await prepareBackend();

const result = spawnSync('npx', ['electron-builder', `--${platform}`, `-c.extraMetadata.version=${version}`], {
    cwd: desktopDir,
    stdio: 'inherit',
    // `npx` is a shell script on POSIX and a `.cmd` shim on Windows; the
    // latter only runs through the command interpreter. Arguments are passed
    // as an array either way, so no shell variable is ever concatenated.
    shell: process.platform === 'win32',
});

if (result.status !== 0) {
    process.exit(result.status ?? 1);
}
