import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { replaceRunningAppImage } from '../desktop-app/appimage-update.js';

function scratch() {
    const dir = mkdtempSync(join(tmpdir(), 'luker-appimage-'));
    const target = join(dir, 'Luker.AppImage');
    writeFileSync(target, 'old');
    chmodSync(target, 0o755);
    // The download lands under the data root, never beside the bundle.
    const download = join(mkdtempSync(join(tmpdir(), 'luker-download-')), 'download');
    writeFileSync(download, 'new');
    return { dir, target, download };
}

describe('replaceRunningAppImage', () => {
    test('swaps the file in place and leaves nothing behind', async () => {
        const { dir, target, download } = scratch();
        expect(await replaceRunningAppImage({ appImagePath: target, downloadPath: download })).toBe(target);
        expect(readFileSync(target, 'utf8')).toBe('new');
        expect(readdirSync(dir)).toEqual(['Luker.AppImage']);
    });

    test('keeps the file executable', async () => {
        const { target, download } = scratch();
        await replaceRunningAppImage({ appImagePath: target, downloadPath: download });
        expect(statSync(target).mode & 0o111).toBe(0o111);
    });

    test('throws and leaves no temporary file when the directory is not writable', async () => {
        const { dir, target, download } = scratch();
        chmodSync(dir, 0o555);
        try {
            await expect(replaceRunningAppImage({ appImagePath: target, downloadPath: download })).rejects.toThrow();
            expect(readdirSync(dir)).toEqual(['Luker.AppImage']);
        } finally {
            chmodSync(dir, 0o755);
        }
    });

    test('removes the staged file when the swap fails', async () => {
        const { dir, download } = scratch();
        // A directory where the app file should be makes the rename fail after
        // the new file has already been staged, which is what the cleanup in
        // the failure path exists for.
        const blocked = join(dir, 'blocked');
        mkdirSync(blocked);
        writeFileSync(join(blocked, 'keep'), 'x');
        await expect(replaceRunningAppImage({ appImagePath: blocked, downloadPath: download })).rejects.toThrow();
        expect(existsSync(`${blocked}.update`)).toBe(false);
    });
});
