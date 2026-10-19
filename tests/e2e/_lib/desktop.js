// Launch the desktop shell (desktop-app/) under Playwright's Electron
// driver, so a spec drives the same window a user sees: the shell spawns
// the backend in-process, then swaps its loading page for the local URL.
//
// The shell reads two things from its launch: `--port=<n>` (the port to
// prefer) and `LUKER_DESKTOP_USER_DATA` (the branded data root to use
// instead of the real `~/Library/Application Support/Luker`). Both are
// what make a spec isolated from the developer's own install.

import { _electron as electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { reservePort } from './ports.js';
import { cloneDataDir, SCRATCH_ROOT } from './server.js';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const DESKTOP_APP_DIR = resolve(REPO_ROOT, 'desktop-app');

// `require('electron')` from inside desktop-app resolves to the absolute
// path of the installed binary; the root node_modules has no Electron.
const ELECTRON_EXECUTABLE = createRequire(resolve(DESKTOP_APP_DIR, 'package.json'))('electron');

// The packaged artifact carries the backend under its resources, so it is
// launched as a plain executable with no application directory.
const PACKAGED_APP_DIR = resolve(DESKTOP_APP_DIR, 'dist', 'mac-arm64', 'Luker.app');
const PACKAGED_EXECUTABLE = resolve(PACKAGED_APP_DIR, 'Contents', 'MacOS', 'Luker');
export const PACKAGED_RESOURCES_DIR = resolve(PACKAGED_APP_DIR, 'Contents', 'Resources');

// The shell loads a bundled file:// page first and swaps to the backend
// origin once the server announces it is up. `browserLaunch.hostname` is
// `auto`, so the host may be either loopback spelling.
const BACKEND_URL = /^https?:\/\/(127\.0\.0\.1|localhost):\d+\//;

// The shell's two terminal states: the backend came up, or it did not and
// the same window now renders the failure (a file:// loading page
// carrying `error`). A spec that expects a boot failure must be able to
// reach the second state, so both count as "settled".
function isSettled(url) {
    return BACKEND_URL.test(url.href) || (url.protocol === 'file:' && url.searchParams.has('error'));
}

/**
 * @param {{ scenarioId?: string, passPort?: boolean, port?: number|null, userData?: string|null, extraEnv?: Record<string, string>, packaged?: boolean }} [options]
 *   `passPort: false` leaves the port unpinned so the shell probes upward
 *   from its default (the "preferred port is taken" case). `userData`
 *   skips the seed clone, for specs that construct the data root themselves.
 *   `packaged: true` launches the built artifact instead of the checkout, so
 *   the app carries its own backend and takes no application directory.
 *   `extraEnv` overrides the child environment, for the settings a spec has
 *   to vary per launch.
 * @returns {Promise<{ electronApp: object, page: object, baseURL: string, port: number, dataRoot: string, userData: string, relaunch: () => Promise<void>, close: () => Promise<void> }>}
 */
export async function launchLukerDesktop({ scenarioId = 'default', passPort = true, port = null, userData = null, extraEnv = {}, packaged = false } = {}) {
    const reservedPort = port ?? await reservePort('desktop');
    const resolvedUserData = userData ?? resolve(SCRATCH_ROOT, `desktop-${scenarioId}-${reservedPort}`);
    if (!userData) {
        mkdirSync(resolvedUserData, { recursive: true });
        cloneDataDir(resolve(resolvedUserData, 'data'));
    }

    const handle = {
        electronApp: null,
        page: null,
        baseURL: null,
        port: null,
        dataRoot: resolve(resolvedUserData, 'data'),
        userData: resolvedUserData,
    };

    const open = async () => {
        const electronApp = await electron.launch({
            executablePath: packaged ? PACKAGED_EXECUTABLE : ELECTRON_EXECUTABLE,
            args: [...(packaged ? [] : [DESKTOP_APP_DIR]), ...(passPort ? [`--port=${reservedPort}`] : [])],
            env: { ...process.env, LUKER_DESKTOP_USER_DATA: resolvedUserData, ...extraEnv },
        });
        const page = await electronApp.firstWindow();
        await page.waitForURL(u => isSettled(u), { timeout: 60_000 });
        const actual = new URL(page.url());
        handle.electronApp = electronApp;
        handle.page = page;
        if (BACKEND_URL.test(actual.href)) {
            handle.baseURL = actual.origin;
            handle.port = Number(actual.port);
        } else {
            handle.baseURL = null;
            handle.port = null;
        }
    };

    handle.relaunch = async () => {
        await handle.close();
        await open();
    };

    handle.close = async () => {
        const electronApp = handle.electronApp;
        if (!electronApp) return;
        handle.electronApp = null;
        await electronApp.close();
    };

    await open();
    return handle;
}
