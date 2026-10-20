import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { detectInstallFlavour } from '../desktop-app/install-flavour.js';

function packageTypeFile(content) {
    const dir = mkdtempSync(join(tmpdir(), 'luker-flavour-'));
    const file = join(dir, 'package-type');
    writeFileSync(file, content);
    return file;
}

describe('detectInstallFlavour', () => {
    test('reads the appimage marker from the environment first', () => {
        expect(detectInstallFlavour({
            appImagePath: '/home/u/Apps/Luker.AppImage',
            packageTypePath: packageTypeFile('deb'),
            isPackaged: true,
        })).toBe('appimage');
    });

    test('falls back to the package type electron-builder writes', () => {
        expect(detectInstallFlavour({ packageTypePath: packageTypeFile('deb\n'), isPackaged: true })).toBe('deb');
        expect(detectInstallFlavour({ packageTypePath: packageTypeFile('rpm\n'), isPackaged: true })).toBe('rpm');
    });

    test('reports unknown for a source run and for a package type it does not know', () => {
        expect(detectInstallFlavour({ isPackaged: false })).toBe('');
        expect(detectInstallFlavour({ packageTypePath: packageTypeFile('snap'), isPackaged: true })).toBe('');
        expect(detectInstallFlavour({ packageTypePath: '/nonexistent/package-type', isPackaged: true })).toBe('');
    });
});
