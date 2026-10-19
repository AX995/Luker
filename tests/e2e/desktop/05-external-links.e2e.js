import { test, expect } from '@playwright/test';
import { launchLukerDesktop } from '../_lib/desktop.js';
import { awaitMainUI } from '../_lib/page.js';

// Chromium hands `window.open` and `target="_blank"` to the embedder, and the
// default is a bare BrowserWindow: no address bar, no back button, nothing the
// user can do with it but close it. The shell routes anything outside the
// app's own origin to the system browser instead. These specs drive real links
// in the real UI against the real Electron shell.

test.describe.configure({ mode: 'serial' });

async function openedExternally(electronApp) {
    return electronApp.evaluate(() => globalThis.__lukerExternalOpens ?? []);
}

test('an external link opens outside the app instead of in a bare window', async () => {
    const desktop = await launchLukerDesktop({
        scenarioId: 'external-link',
        extraEnv: { LUKER_DESKTOP_SKIP_OPEN_EXTERNAL: '1' },
    });

    try {
        await awaitMainUI(desktop.page, desktop.baseURL);
        const windowsBefore = desktop.electronApp.windows().length;

        // The AI response configuration drawer carries a help link to the docs.
        await desktop.page.locator('#leftNavDrawerIcon').click();
        const link = desktop.page
            .locator('#left-nav-panel a[target="_blank"][href^="https://"]:visible')
            .first();
        await expect(link).toBeVisible();
        const href = await link.getAttribute('href');

        await link.click();

        await expect
            .poll(async () => (await openedExternally(desktop.electronApp)).length)
            .toBe(1);
        expect(await openedExternally(desktop.electronApp)).toEqual([href]);
        expect(desktop.electronApp.windows().length).toBe(windowsBefore);
    } finally {
        await desktop.close();
    }
});

test('a link that would navigate the app window away is handed to the browser instead', async () => {
    const desktop = await launchLukerDesktop({
        scenarioId: 'external-navigate',
        extraEnv: { LUKER_DESKTOP_SKIP_OPEN_EXTERNAL: '1' },
    });

    try {
        await awaitMainUI(desktop.page, desktop.baseURL);

        // No shipped page has an external link without target="_blank", so an
        // in-page link is the only way to reach the navigation path. The click
        // and everything after it are real.
        await desktop.page.evaluate(() => {
            const anchor = document.createElement('a');
            anchor.id = 'e2e-external-navigate';
            anchor.href = 'https://example.com/e2e-external-navigate';
            anchor.textContent = 'e2e external navigate';
            anchor.style.cssText =
                'position: fixed; top: 4px; left: 4px; z-index: 2147483647; background: white; padding: 4px;';
            document.body.append(anchor);
        });
        // The navigation is prevented, so Playwright's click would wait for a
        // navigation that never settles; a real mouse click at the element's
        // coordinates does not auto-wait and is still a trusted event.
        const box = await desktop.page.locator('#e2e-external-navigate').boundingBox();
        await desktop.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

        await expect
            .poll(async () => (await openedExternally(desktop.electronApp)).length)
            .toBe(1);
        expect(await openedExternally(desktop.electronApp)).toEqual([
            'https://example.com/e2e-external-navigate',
        ]);
        expect(new URL(desktop.page.url()).origin).toBe(desktop.baseURL);
    } finally {
        await desktop.close();
    }
});
