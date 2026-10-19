import { test, expect } from '@playwright/test';
import { launchLukerDesktop } from '../_lib/desktop.js';
import { awaitMainUI } from '../_lib/page.js';

// Electron installs a default application menu on its own. Windows and Linux
// draw it as an in-window bar, which the shell clears; macOS keeps it, because
// the standard Edit roles there also carry the clipboard accelerators. Only the
// running platform's expectation can be asserted here.

test('the application menu matches what the platform needs', async () => {
    const desktop = await launchLukerDesktop({ scenarioId: 'window-menu' });

    try {
        await awaitMainUI(desktop.page, desktop.baseURL);

        const hasApplicationMenu = await desktop.electronApp.evaluate(
            ({ Menu }) => Menu.getApplicationMenu() !== null,
        );

        if (process.platform === 'darwin') {
            expect(hasApplicationMenu).toBe(true);
        } else {
            expect(hasApplicationMenu).toBe(false);
        }
    } finally {
        await desktop.close();
    }
});
