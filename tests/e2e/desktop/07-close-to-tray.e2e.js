import { test, expect } from '@playwright/test';
import { launchLukerDesktop } from '../_lib/desktop.js';
import { awaitMainUI } from '../_lib/page.js';

// Closing the window hides it instead of quitting. The backend runs inside the
// shell process, so the app has to outlive a close for a generation in flight
// to finish, and the page keeps its state because it is never unloaded. The
// tray belongs to Windows and Linux; macOS reopens the app from the Dock and
// carries the data directory command in its application menu.

test.describe.configure({ mode: 'serial' });

let desktop;

test.beforeAll(async () => {
    desktop = await launchLukerDesktop({
        scenarioId: 'close-to-tray',
        extraEnv: { LUKER_DESKTOP_SKIP_OPEN_DATA_DIR: '1' },
    });
    await awaitMainUI(desktop.page, desktop.baseURL);
});

test.afterAll(async () => {
    await desktop?.close();
});

test('closing the window hides it and leaves the backend serving', async () => {
    const { electronApp, port } = desktop;

    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());

    const windowState = await electronApp.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        return { destroyed: win.isDestroyed(), visible: win.isVisible() };
    });
    expect(windowState.destroyed).toBe(false);
    expect(windowState.visible).toBe(false);

    const response = await fetch(`http://127.0.0.1:${port}/`);
    expect(response.ok).toBe(true);
});

test('showing the window again lands on the same page', async () => {
    const { electronApp, page } = desktop;
    const url = page.url();
    await page.evaluate(() => { window.__lukerCloseProbe = 'kept'; });
    const timeOrigin = await page.evaluate(() => performance.timeOrigin);

    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());

    await expect.poll(() => electronApp.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible(),
    )).toBe(true);

    expect(page.url()).toBe(url);
    expect(await page.evaluate(() => window.__lukerCloseProbe)).toBe('kept');
    // A reload would reset the document's time origin, so this rules out the
    // window coming back as a fresh boot.
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
    await expect(page.locator('#chat')).toBeVisible();
});

test('the app comes back from the Dock on macOS', async () => {
    const { electronApp } = desktop;

    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    // Clicking the Dock icon makes macOS emit `activate` on the app, which is
    // as close as a test can get to that click.
    await electronApp.evaluate(({ app }) => app.emit('activate'));

    const visible = await electronApp.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible(),
    );
    if (process.platform === 'darwin') {
        expect(visible).toBe(true);
    } else {
        expect(visible).toBe(false);
    }
});

test('the data directory command reaches the configured data root', async () => {
    const { electronApp, userData } = desktop;

    if (process.platform !== 'darwin') {
        // Windows and Linux carry the command in the tray menu, and Electron
        // exposes no handle for a tray, so what this run can assert is the
        // platform split itself.
        const hasApplicationMenu = await electronApp.evaluate(
            ({ Menu }) => Menu.getApplicationMenu() !== null,
        );
        expect(hasApplicationMenu).toBe(false);
        return;
    }

    const labels = await electronApp.evaluate(({ Menu }) => {
        const appMenu = Menu.getApplicationMenu().items[0].submenu;
        const item = appMenu.items.find(entry => !entry.role && entry.type === 'normal');
        // Calling the item's own handler is what the native menu does.
        item.click();
        return appMenu.items.filter(entry => entry.type === 'normal').map(entry => entry.label);
    });

    const opened = await electronApp.evaluate(() => globalThis.__lukerDataDirectoryOpens);
    expect(opened).toEqual([userData]);
    expect(labels.length).toBeGreaterThan(1);
});
