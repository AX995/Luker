import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import { afterEach, describe, expect, test } from '@jest/globals';

import { getPluginDependencyStatus, installPluginDependencies } from '../../src/plugin-dependencies.js';

const require = createRequire(import.meta.url);
const roots = [];

function makePlugin(packageJson) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-deps-'));
    roots.push(root);
    if (packageJson !== undefined) {
        fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(packageJson));
    }
    return root;
}

afterEach(() => {
    while (roots.length) {
        fs.rmSync(roots.pop(), { recursive: true, force: true });
    }
});

describe('getPluginDependencyStatus', () => {
    test('no package.json means no dependencies', () => {
        const root = makePlugin(undefined);
        expect(getPluginDependencyStatus(root)).toEqual({
            hasDependencies: false, declared: [], missing: [], needsInstall: false,
        });
    });

    test('package.json without dependencies needs nothing', () => {
        const root = makePlugin({ name: 'x', version: '1.0.0' });
        expect(getPluginDependencyStatus(root).needsInstall).toBe(false);
    });

    test('declared dependency with no node_modules is missing', () => {
        const root = makePlugin({ dependencies: { dayjs: '^1.11.13' } });
        expect(getPluginDependencyStatus(root)).toEqual({
            hasDependencies: true, declared: ['dayjs'], missing: ['dayjs'], needsInstall: true,
        });
    });

    test('installed dependency is not missing', () => {
        const root = makePlugin({ dependencies: { dayjs: '^1.11.13' } });
        const installed = path.join(root, 'node_modules', 'dayjs');
        fs.mkdirSync(installed, { recursive: true });
        fs.writeFileSync(path.join(installed, 'package.json'), '{}');
        expect(getPluginDependencyStatus(root)).toEqual({
            hasDependencies: true, declared: ['dayjs'], missing: [], needsInstall: false,
        });
    });

    test('optional-only dependencies expose the install action', () => {
        const root = makePlugin({ optionalDependencies: { 'tiny-dep': '1.0.0' } });
        expect(getPluginDependencyStatus(root)).toEqual({
            hasDependencies: true, declared: ['tiny-dep'], missing: ['tiny-dep'], needsInstall: true,
        });
    });

    test('overlapping declarations count installed optional dependencies once', () => {
        const root = makePlugin({
            dependencies: { required: '1.0.0', shared: '1.0.0' },
            optionalDependencies: { shared: '2.0.0', optional: '1.0.0' },
            devDependencies: { development: '1.0.0' },
        });
        for (const name of ['optional', 'shared']) {
            const installed = path.join(root, 'node_modules', name);
            fs.mkdirSync(installed, { recursive: true });
            fs.writeFileSync(path.join(installed, 'package.json'), '{}');
        }
        expect(getPluginDependencyStatus(root)).toEqual({
            hasDependencies: true, declared: ['optional', 'required', 'shared'], missing: ['required'], needsInstall: true,
        });
    });
});

function makeInstalledFixture(dependencyField = 'dependencies') {
    const pluginsPath = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-install-'));
    roots.push(pluginsPath);
    const dep = path.join(pluginsPath, 'tiny-dep');
    fs.mkdirSync(dep, { recursive: true });
    fs.writeFileSync(path.join(dep, 'package.json'), JSON.stringify({ name: 'tiny-dep', version: '1.0.0', main: 'index.js' }));
    fs.writeFileSync(path.join(dep, 'index.js'), 'module.exports = { value: 42 };');

    const plugin = path.join(pluginsPath, 'demo-plugin');
    fs.mkdirSync(plugin, { recursive: true });
    fs.writeFileSync(path.join(plugin, 'package.json'), JSON.stringify({
        name: 'demo-plugin', version: '1.0.0', type: 'commonjs', main: 'index.js',
        [dependencyField]: { 'tiny-dep': `file:${dep}` },
    }));
    fs.writeFileSync(path.join(plugin, 'index.js'), 'module.exports = require("tiny-dep");');
    return pluginsPath;
}

describe('installPluginDependencies', () => {
    test.each([{}, { forceManager: 'arborist' }])('installs optional-only dependencies with %j', async (options) => {
        const pluginsPath = makeInstalledFixture('optionalDependencies');
        const result = await installPluginDependencies(pluginsPath, 'demo-plugin', options);
        expect(result.installed).toBe(true);
        expect(result.manager).toBe(options.forceManager || 'npm');
        expect(getPluginDependencyStatus(result.path)).toEqual({
            hasDependencies: true, declared: ['tiny-dep'], missing: [], needsInstall: false,
        });
        expect(require(path.join(result.path, 'index.js')).value).toBe(42);
    }, 120000);

    test('installs declared dependencies and reports the manager', async () => {
        const pluginsPath = makeInstalledFixture();
        const result = await installPluginDependencies(pluginsPath, 'demo-plugin');
        expect(result.directory).toBe('demo-plugin');
        expect(['npm', 'arborist']).toContain(result.manager);
        expect(result.installed).toBe(true);
        expect(getPluginDependencyStatus(result.path).needsInstall).toBe(false);
        const resolved = require(path.join(result.path, 'node_modules', 'tiny-dep', 'index.js'));
        expect(resolved.value).toBe(42);
    }, 120000);

    test('installs declared dependencies with arborist when npm is unavailable', async () => {
        const pluginsPath = makeInstalledFixture();
        const result = await installPluginDependencies(pluginsPath, 'demo-plugin', { forceManager: 'arborist' });
        expect(result.directory).toBe('demo-plugin');
        expect(result.manager).toBe('arborist');
        expect(result.installed).toBe(true);
        expect(getPluginDependencyStatus(result.path).needsInstall).toBe(false);
        const resolved = require(path.join(result.path, 'node_modules', 'tiny-dep', 'index.js'));
        expect(resolved.value).toBe(42);
    }, 120000);

    test('rejects a directory that escapes the plugins root', async () => {
        const pluginsPath = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-escape-'));
        roots.push(pluginsPath);
        await expect(installPluginDependencies(pluginsPath, '..')).rejects.toMatchObject({
            statusCode: 400,
            message: expect.stringMatching(/escapes/),
        });
    });

    test('rejects a dot directory with 400', async () => {
        const pluginsPath = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-dot-'));
        roots.push(pluginsPath);
        await expect(installPluginDependencies(pluginsPath, '.')).rejects.toMatchObject({ statusCode: 400 });
    });

    test('rejects a missing plugin directory with 404', async () => {
        const pluginsPath = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-missing-'));
        roots.push(pluginsPath);
        await expect(installPluginDependencies(pluginsPath, 'nope')).rejects.toMatchObject({ statusCode: 404 });
    });

    test('rejects a missing plugin directory name with 400', async () => {
        const pluginsPath = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-noname-'));
        roots.push(pluginsPath);
        await expect(installPluginDependencies(pluginsPath, '   ')).rejects.toMatchObject({ statusCode: 400 });
    });
});
