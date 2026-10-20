import { readFileSync } from 'node:fs';
import { describe, expect, test } from '@jest/globals';

const pkg = JSON.parse(readFileSync(new URL('../../desktop-app/package.json', import.meta.url), 'utf8'));

describe('desktop linux packaging', () => {
    test('declares the three linux targets for both architectures', () => {
        const targets = pkg.build.linux.target.map(entry => entry.target).sort();
        expect(targets).toEqual(['AppImage', 'deb', 'rpm']);
        for (const entry of pkg.build.linux.target) {
            expect(entry.arch).toEqual(['x64', 'arm64']);
        }
    });

    test('carries the metadata fpm refuses to build without', () => {
        expect(pkg.build.linux.maintainer).toBe('Luker <support@cups.moe>');
        expect(pkg.build.linux.category).toBe('Utility');
        expect(pkg.homepage ?? pkg.repository?.url).toBe('https://github.com/funnycups/Luker');
    });

    test('exposes the linux build entry point', () => {
        expect(pkg.scripts['build:linux']).toBe('node scripts/build-desktop.mjs linux');
        const buildScript = readFileSync(new URL('../../desktop-app/scripts/build-desktop.mjs', import.meta.url), 'utf8');
        expect(buildScript).toMatch(/const PLATFORMS = \['mac', 'win', 'linux'\];/);
    });
});
