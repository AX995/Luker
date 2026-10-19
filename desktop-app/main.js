import { app, BrowserWindow, ipcMain, Menu, nativeImage, shell, Tray } from 'electron';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';

// Electron's main process exposes V8's WebAssembly but not the streaming
// compile helpers, which live at the Blink layer in Chromium. Emscripten-built
// wasm codecs probe `instantiateStreaming` to pick their load path; without it
// they fall through to a synchronous read that the same glue only defines for
// web and worker targets, so every decode aborts and the image pipelines that
// depend on them (thumbnails, average-color sampling) fail for jpeg and webp.
// Restore the standard semantics on top of the non-streaming primitives.
if (typeof WebAssembly.instantiateStreaming !== 'function') {
    WebAssembly.instantiateStreaming = async (source, importObject) => {
        const response = await source;
        const bytes = await response.arrayBuffer();
        const module = await WebAssembly.compile(bytes);
        return { module, instance: await WebAssembly.instantiate(module, importObject) };
    };
}

const DEFAULT_PORT = 8000;
// Probe window for a free port, matching the range the mobile shells use.
const PORT_PROBE_COUNT = 50;

app.setName('Luker');

// The backend tree lives next to this file in a checkout and under the app's
// resources once installed. Resolve it once and route every backend path
// through it, so both layouts share a single root.
const backendRoot = process.env.LUKER_BACKEND_ROOT
    || (app.isPackaged ? path.join(process.resourcesPath, 'luker') : path.resolve(import.meta.dirname, '..'));

// A packaged tree ships the frontend bundles pre-compiled; point the backend
// at them so it skips its in-process compile. An explicit setting wins.
if (!process.env.LUKER_PREBUILT_BUNDLES_DIR) {
    const prebuiltBundles = path.join(backendRoot, '_prebuilt-bundles');
    if (fs.existsSync(prebuiltBundles)) {
        process.env.LUKER_PREBUILT_BUNDLES_DIR = prebuiltBundles;
    }
}

function readPreferredPort(argv) {
    const prefix = '--port=';
    for (const arg of argv) {
        if (!arg.startsWith(prefix)) {
            continue;
        }
        const parsed = Number.parseInt(arg.slice(prefix.length), 10);
        if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
            return parsed;
        }
    }
    return DEFAULT_PORT;
}

const preferredPort = readPreferredPort(process.argv);

const userData = process.env.LUKER_DESKTOP_USER_DATA || app.getPath('userData');
if (process.env.LUKER_DESKTOP_USER_DATA) {
    app.setPath('userData', userData);
}

const UPDATE_PROGRESS_CHANNEL = 'luker:update-progress';

const updatesDirectory = path.join(userData, 'updates');

// The update prompt hands the downloaded installer to the OS, which owns it
// from there on, so the copy under the data root is only a staging file. A
// launch clears whatever an earlier run left behind.
fs.rmSync(updatesDirectory, { recursive: true, force: true });

// The renderer can only name the asset; the main process fetches it over the
// network and writes it under the data root. Streamed through a counting
// transform so the renderer sees `{ received, total }` while it downloads.
async function downloadUpdate(url, destination, onProgress) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`The update download failed (HTTP ${response.status}).`);
    }
    const total = Number(response.headers.get('content-length')) || 0;
    let received = 0;
    const counter = new Transform({
        transform(chunk, _encoding, callback) {
            received += chunk.length;
            onProgress(received, total);
            callback(null, chunk);
        },
    });
    await pipeline(Readable.fromWeb(response.body), counter, fs.createWriteStream(destination));
}

ipcMain.handle('luker:install-update', async (event, payload) => {
    const rawUrl = String(payload?.url || '');
    const updateUrl = new URL(rawUrl);
    if (updateUrl.protocol !== 'http:' && updateUrl.protocol !== 'https:') {
        throw new Error(`Refusing to download an update from a non-HTTP URL: ${rawUrl}`);
    }

    const name = path.basename(String(payload?.name || ''));
    if (!name || name === '.' || name === '..') {
        throw new Error(`The update download has no usable file name: ${String(payload?.name || '')}`);
    }

    fs.mkdirSync(updatesDirectory, { recursive: true });
    const finalPath = path.join(updatesDirectory, name);
    const partialPath = `${finalPath}.part`;

    try {
        await downloadUpdate(updateUrl.href, partialPath, (received, total) => {
            if (!event.sender.isDestroyed()) {
                event.sender.send(UPDATE_PROGRESS_CHANNEL, { received, total });
            }
        });
        fs.renameSync(partialPath, finalPath);
    } catch (error) {
        fs.rmSync(partialPath, { force: true });
        throw error;
    }

    // The e2e harness sets this so a test run never hands a file to the real
    // OS installer.
    if (process.env.LUKER_DESKTOP_SKIP_OPEN_INSTALLER !== '1') {
        await shell.openPath(finalPath);
    }

    return { path: finalPath };
});

// The backend is imported into this process, so a crash during module
// evaluation would otherwise leave no trace anywhere. Tee both streams to a
// file under the data directory until the server reports that it is up.
const logPath = path.join(userData, 'data', 'luker-boot.log');
fs.mkdirSync(path.dirname(logPath), { recursive: true });

const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const originalStderrWrite = process.stderr.write.bind(process.stderr);

process.stdout.write = (chunk, encoding, callback) => {
    fs.appendFileSync(logPath, chunk);
    return originalStdoutWrite(chunk, encoding, callback);
};

process.stderr.write = (chunk, encoding, callback) => {
    fs.appendFileSync(logPath, chunk);
    return originalStderrWrite(chunk, encoding, callback);
};

function stopTeeingLogs() {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
}

// The backend reports an unrecoverable startup problem in three ways, and all
// three have to reach the window instead of leaving it on the starting page:
// a rejection out of the module graph, a `process.exit()` raised while the
// backend is still booting, and an unhandled rejection from the boot chain
// src/server-main.js starts without attaching a catch. The last two end the
// process by default, which closes the window and takes the explanation with
// it, so while startup is in flight both are converted into a reported
// failure. Outside that window they are left untouched.
let backendStarting = false;
let bootFailure = null;
let reportBootFailure = () => {};

const nativeExit = process.exit.bind(process);

process.exit = (code) => {
    if (backendStarting) {
        reportStartupFailure(`The backend exited during startup (exit code ${code}).`);
        return;
    }
    return nativeExit(code);
};

function reportStartupFailure(error) {
    if (!backendStarting || bootFailure !== null) {
        return false;
    }
    const message = error instanceof Error ? error.message : String(error);
    bootFailure = message;
    console.error(`Luker failed to start: ${message}`);
    reportBootFailure(message);
    return true;
}

const onUnhandledRejection = (reason) => {
    reportStartupFailure(reason);
};

const onUncaughtException = (error) => {
    reportStartupFailure(error);
};

function stopWatchingStartup() {
    process.off('unhandledRejection', onUnhandledRejection);
    process.off('uncaughtException', onUncaughtException);
}

function probePort(port) {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                resolve(false);
            } else {
                reject(err);
            }
        });
        probe.listen({ host: '127.0.0.1', port }, () => {
            probe.close(() => resolve(true));
        });
    });
}

async function pickPort(preferred) {
    for (let offset = 0; offset < PORT_PROBE_COUNT; offset++) {
        const port = preferred + offset;
        if (await probePort(port)) {
            return port;
        }
    }
    throw new Error(`no free port between ${preferred} and ${preferred + PORT_PROBE_COUNT - 1}`);
}

async function startBackend(win, locale, port) {
    const configPath = path.join(userData, 'config.yaml');
    if (!fs.existsSync(configPath)) {
        fs.copyFileSync(path.resolve(backendRoot, 'default', 'config.yaml'), configPath);
    }

    const serverJs = path.resolve(backendRoot, 'server.js');

    process.argv = [
        process.execPath,
        serverJs,
        `--port=${port}`,
        `--dataRoot=${path.join(userData, 'data')}`,
        `--configPath=${configPath}`,
        `--serverPluginsPath=${path.join(userData, 'plugins')}`,
        `--globalExtensionsPath=${path.join(userData, 'extensions', 'third-party')}`,
        '--browserLaunchEnabled=false',
        `--backupsPath=${path.join(userData, 'backups')}`,
    ];

    // The import below never settles once the server is listening, so the
    // listener has to be attached before it runs.
    backendStarting = true;
    bootFailure = null;
    reportBootFailure = (message) => {
        win.loadFile('loading.html', { query: { locale, error: message, logPath } })
            .catch((err) => console.error('Failed to render the startup failure:', err));
    };
    process.on('unhandledRejection', onUnhandledRejection);
    process.on('uncaughtException', onUncaughtException);

    // The emitter has to be the exact module instance the backend imports,
    // which is the one under the resolved backend root. A static import would
    // resolve against this file's own directory instead.
    const { EVENT_NAMES, serverEvents } = await import(
        pathToFileURL(path.resolve(backendRoot, 'src', 'server-events.js')).href
    );

    serverEvents.once(EVENT_NAMES.SERVER_STARTED, ({ url }) => {
        // The server is up, so the startup window is over either way. A
        // failure reported earlier stands and the window keeps showing it.
        const failed = bootFailure !== null;
        backendStarting = false;
        stopWatchingStartup();
        stopTeeingLogs();
        if (!failed) {
            backendOrigin = url.origin;
            win.loadURL(url.toString());
        }
    });

    try {
        await import(pathToFileURL(serverJs).href);
    } catch (err) {
        reportStartupFailure(err);
    }
}

// Chromium hands `window.open` and `target="_blank"` targets to the embedder,
// and the default is a bare BrowserWindow with no address bar and no way back;
// an in-page link would likewise navigate the app window away from the UI.
// Both are the system browser's job, so anything outside the app's own origin
// goes there and the window keeps showing Luker.
let backendOrigin = null;

function isAppUrl(rawUrl) {
    if (!backendOrigin) {
        return false;
    }
    try {
        return new URL(rawUrl).origin === backendOrigin;
    } catch {
        return false;
    }
}

function openInSystemBrowser(rawUrl) {
    // The e2e harness sets this so a test run never launches a real browser.
    if (process.env.LUKER_DESKTOP_SKIP_OPEN_EXTERNAL === '1') {
        const opened = globalThis.__lukerExternalOpens ?? (globalThis.__lukerExternalOpens = []);
        opened.push(rawUrl);
        return;
    }
    shell.openExternal(rawUrl);
}

function routeExternalNavigation(contents) {
    contents.setWindowOpenHandler(({ url }) => {
        if (isAppUrl(url)) {
            return { action: 'allow' };
        }
        openInSystemBrowser(url);
        return { action: 'deny' };
    });

    contents.on('will-navigate', (event, url) => {
        if (isAppUrl(url)) {
            return;
        }
        event.preventDefault();
        openInSystemBrowser(url);
    });
}

// The shell draws a few labels of its own, outside the renderer: the tray menu
// and the macOS application menu. It carries its own copy of the loading
// page's locale table so those follow the system locale too.
const SHELL_STRINGS = {
    en: {
        showWindow: 'Show Luker',
        openDataDirectory: 'Open data directory',
        quit: 'Quit Luker',
        trayHint: 'Luker keeps running in the notification area. Quit from its menu when you are done.',
    },
    'zh-CN': {
        showWindow: '显示 Luker',
        openDataDirectory: '打开数据目录',
        quit: '退出 Luker',
        trayHint: 'Luker 仍在通知区域运行，结束时请从托盘菜单退出。',
    },
    'zh-TW': {
        showWindow: '顯示 Luker',
        openDataDirectory: '開啟資料目錄',
        quit: '結束 Luker',
        trayHint: 'Luker 仍在通知區域執行，結束時請從托盤選單結束。',
    },
};

function pickShellStrings(locale) {
    if (Object.prototype.hasOwnProperty.call(SHELL_STRINGS, locale)) {
        return SHELL_STRINGS[locale];
    }
    const lower = String(locale || '').toLowerCase();
    if (lower.startsWith('zh')) {
        if (lower.includes('tw') || lower.includes('hk') || lower.includes('hant')) {
            return SHELL_STRINGS['zh-TW'];
        }
        return SHELL_STRINGS['zh-CN'];
    }
    return SHELL_STRINGS.en;
}

// Closing the window hides it instead of destroying it. The backend runs in
// this process, so quitting on close would end any generation in flight; only
// a real quit takes the window down.
let quitting = false;
let tray = null;
let trayHintShown = false;

function showMainWindow(win) {
    if (win.isDestroyed()) {
        return;
    }
    if (win.isMinimized()) {
        win.restore();
    }
    win.show();
    win.focus();
}

function openDataDirectory() {
    // The e2e harness sets this so a test run never launches a file manager.
    if (process.env.LUKER_DESKTOP_SKIP_OPEN_DATA_DIR === '1') {
        const opened = globalThis.__lukerDataDirectoryOpens ?? (globalThis.__lukerDataDirectoryOpens = []);
        opened.push(userData);
        return;
    }
    return shell.openPath(userData);
}

function createTray(win, strings) {
    tray = new Tray(nativeImage.createFromPath(path.join(import.meta.dirname, 'tray-icon.png')));
    tray.setToolTip('Luker');
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: strings.showWindow, click: () => showMainWindow(win) },
        { label: strings.openDataDirectory, click: openDataDirectory },
        { type: 'separator' },
        { label: strings.quit, click: () => app.quit() },
    ]));
    tray.on('click', () => showMainWindow(win));
}

function installApplicationMenu(strings) {
    // macOS keeps an application menu, because its Edit roles carry the
    // clipboard accelerators. Electron's default menu does not take new items,
    // so the template below mirrors it and adds the data directory command to
    // the app menu, where macOS puts application-level commands.
    Menu.setApplicationMenu(Menu.buildFromTemplate([
        {
            label: app.name,
            submenu: [
                { role: 'about' },
                { label: strings.openDataDirectory, click: openDataDirectory },
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' },
            ],
        },
        { role: 'fileMenu' },
        { role: 'editMenu' },
        { role: 'viewMenu' },
        { role: 'windowMenu' },
    ]));
}

app.whenReady().then(async () => {
    // Electron installs a default application menu, which Windows and Linux
    // draw as an in-window bar the shell has no use for. macOS keeps its own,
    // because the standard Edit roles there also carry the clipboard
    // accelerators.
    if (process.platform !== 'darwin') {
        Menu.setApplicationMenu(null);
    }

    const locale = app.getLocale();
    const strings = pickShellStrings(locale);
    const win = new BrowserWindow({
        width: 1024,
        height: 768,
        webPreferences: {
            preload: path.join(import.meta.dirname, 'preload.js'),
            // A hidden window is throttled by default, which would slow the
            // renderer's timers and animations down while the app sits in the
            // tray. Leaving the page unthrottled matches what hiding does on
            // macOS on its own, so every platform behaves the same way.
            backgroundThrottling: false,
        },
    });
    routeExternalNavigation(win.webContents);

    win.on('close', (event) => {
        if (quitting) {
            return;
        }
        event.preventDefault();
        win.hide();
        // Windows tucks new tray icons into its overflow area, so the first
        // close tells the user where the app went.
        if (process.platform === 'win32' && !trayHintShown) {
            trayHintShown = true;
            tray.displayBalloon({ title: 'Luker', content: strings.trayHint });
        }
    });

    if (process.platform === 'darwin') {
        installApplicationMenu(strings);
    } else {
        createTray(win, strings);
    }

    app.on('activate', () => showMainWindow(win));

    await win.loadFile('loading.html', { query: { locale } });

    try {
        const port = await pickPort(preferredPort);
        await startBackend(win, locale, port);
    } catch (err) {
        if (bootFailure === null) {
            await win.loadFile('loading.html', {
                query: { locale, error: String(err?.message || err), logPath },
            });
        }
    }
});

app.on('before-quit', () => {
    // Lets the window's close handler through, so a real quit destroys the
    // window and the process can exit.
    quitting = true;
    backendStarting = false;
    stopWatchingStartup();
    stopTeeingLogs();
});
