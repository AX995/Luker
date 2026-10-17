// Case #101 — Regex scope: "Alter Chat Display" and "Plugin Messages" are
// independent channel switches and may be ticked together on one script.
//
// Regression: the editor used to disable and clear "Alter Chat Display" while
// "Plugin Messages" was ticked, so an existing rule that cleaned the
// chat display could not be reused for plugin requests.
//
// Real-UI version:
//   - Open Extensions → Regex → "+ Global".
//   - Tick "Plugin Messages" through a real click and assert "Alter Chat
//     Display" stays enabled and checked.
//   - Tick "Alter Outgoing Prompt" too, fill the script, save via the popup.
//   - Assert all three scope flags persisted on the stored script.
//   - Send a real turn; assert the rendered bubble carries the substitution
//     (the display lane is live for a rule that also carries the plugin flag).

import { test, expect } from '@playwright/test';
import { startServer, tearDownServer } from '../_lib/server.js';
import { startMockLLM } from '../_lib/mockLLM.js';
import { bootstrapCustomBackend, appendConnectionProfile, markOnboarded } from '../_lib/fixtures.js';
import {
    awaitMainUI,
    selectCharacterByName,
    sendMessageAndAwaitReply,
    openExtensionsDrawer,
} from '../_lib/page.js';

const REPLY = 'The lantern flame settles to a steady blue.';

let server, mock;

test.beforeAll(async () => {
    mock = await startMockLLM({ scriptedReplies: [REPLY] });
    server = await startServer({ batchKey: 'extensions', scenarioId: '101-regex-display-plugin' });
    markOnboarded({ dataRoot: server.dataRoot });
    bootstrapCustomBackend({ dataRoot: server.dataRoot, baseURL: mock.baseURL });
    appendConnectionProfile({ dataRoot: server.dataRoot, baseURL: mock.baseURL });
});

test.afterAll(async () => {
    await tearDownServer(server);
    await mock?.stop();
});

async function openRegexDrawer(page) {
    const regexDrawer = page.locator('#regex_container .inline-drawer').first();
    const regexContent = regexDrawer.locator('> .inline-drawer-content');
    const hidden = await regexContent.evaluate(el => {
        if (!el) return true;
        return window.getComputedStyle(el).display === 'none';
    }).catch(() => true);
    if (hidden) {
        await regexDrawer.locator('> .inline-drawer-toggle').first().click();
        await regexContent.waitFor({ state: 'visible', timeout: 5000 });
    }
}

test.describe('#101 — Regex display and plugin scope coexist', () => {
    test('ticking Plugin Messages keeps Alter Chat Display enabled, and both persist', async ({ page }) => {
        test.setTimeout(180_000);
        await awaitMainUI(page, server.baseURL);
        await selectCharacterByName(page, 'Seraphina');
        await page.waitForFunction(() => {
            const ctx = window.Luker.getContext();
            return Array.isArray(ctx.chat) && ctx.chat.length >= 1;
        }, { timeout: 10_000 }).catch(() => {});

        await openExtensionsDrawer(page);
        await openRegexDrawer(page);

        await page.locator('#open_regex_editor').click();
        const popup = page.locator('.popup:visible').last();
        await popup.waitFor({ state: 'visible', timeout: 5000 });

        await popup.locator('input.regex_script_name').fill('e2e-display-and-plugin');
        await popup.locator('input.find_regex').fill('/lantern/g');
        await popup.locator('textarea.regex_replace_string').fill('LANTERN');

        const allPlacements = popup.locator('input[name="replace_position"]');
        const count = await allPlacements.count();
        for (let i = 0; i < count; i++) {
            const cb = allPlacements.nth(i);
            if (await cb.isChecked()) await cb.uncheck();
        }
        await popup.locator('input[name="replace_position"][value="2"]').check(); // AI_OUTPUT

        const display = popup.locator('input[name="only_format_display"]');
        const prompt = popup.locator('input[name="only_format_prompt"]');
        const plugin = popup.locator('input[name="only_format_plugin"]');

        // The editor seeds "Alter Chat Display" for a new script.
        await expect(display).toBeChecked();

        // Real click on the plugin box. It must not disable or clear the
        // display box.
        await plugin.check();
        await expect(display, 'Alter Chat Display must stay enabled while Plugin Messages is ticked').toBeEnabled();
        await expect(display, 'Alter Chat Display must stay checked while Plugin Messages is ticked').toBeChecked();

        // The original user scenario: the rule also cleaned the outgoing prompt.
        await prompt.check();

        await popup.locator('.popup-button-ok').first().click();
        await popup.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});

        const saved = await page.evaluate(() => {
            const list = window.Luker.getContext().extensionSettings?.regex ?? [];
            const found = list.find(s => s && s.scriptName === 'e2e-display-and-plugin');
            return found ? {
                markdownOnly: Boolean(found.markdownOnly),
                promptOnly: Boolean(found.promptOnly),
                pluginOnly: Boolean(found.pluginOnly),
            } : null;
        });
        expect(saved, 'script should be persisted after save').toBeTruthy();
        expect(saved.markdownOnly).toBe(true);
        expect(saved.promptOnly).toBe(true);
        expect(saved.pluginOnly).toBe(true);

        // Display lane is live: the rendered bubble carries the substitution.
        const { text } = await sendMessageAndAwaitReply(page, 'I trimmed the wick.');
        expect(text).toMatch(/LANTERN/);
    });
});
