import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test } from '@jest/globals';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const roots = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));

test.each(['valid', 'mismatch', 'dangling'])('loads only the configured persistent plugins through a %s alias', (mode) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-alias-'));
    roots.push(root);
    const runtime = path.join(root, 'runtime');
    const plugins = path.join(root, 'data/plugins');
    fs.mkdirSync(path.join(plugins, 'demo/src'), { recursive: true });
    fs.mkdirSync(path.join(runtime, 'src'), { recursive: true });
    fs.mkdirSync(path.join(runtime, 'public'), { recursive: true });
    fs.writeFileSync(path.join(runtime, 'package.json'), '{"type":"module"}');
    fs.writeFileSync(path.join(runtime, 'src/host.js'), 'export default 42;');
    fs.writeFileSync(path.join(runtime, 'public/value.txt'), 'host-public');
    fs.symlinkSync(path.join(repo, 'node_modules'), path.join(runtime, 'node_modules'), 'dir');
    const alias = path.join(runtime, '_server-plugins');
    fs.symlinkSync(plugins, alias, 'dir');
    fs.writeFileSync(path.join(plugins, 'package.json'), '{"type":"commonjs"}');
    fs.mkdirSync(path.join(plugins, 'commonjs'));
    fs.writeFileSync(path.join(plugins, 'commonjs/index.js'), `
        const bytes = require('bytes');
        module.exports = {
            info: { id: 'commonjs', name: 'CommonJS', description: 'Alias fixture' },
            init: async router => router.get('/status', (req, res) => res.json({ bytes: bytes('2kb') })),
        };
    `);
    if (mode !== 'valid') {
        fs.unlinkSync(alias);
        const other = path.join(root, 'other');
        if (mode === 'mismatch') fs.mkdirSync(other);
        fs.symlinkSync(other, alias, 'dir');
    }
    fs.writeFileSync(path.join(plugins, 'demo/package.json'), '{"name":"demo","type":"module","main":"src/index.js"}');
    fs.writeFileSync(path.join(plugins, 'demo/src/index.js'), `
        import value from '../../../src/host.js';
        import bytes from 'bytes';
        import fs from 'node:fs';
        export const info = { id: 'demo', name: 'Demo', description: 'Alias test' };
        export async function init(router) {
            router.get('/status', (req, res) => res.json({ value, bytes: bytes('1kb'),
                public: fs.readFileSync(new URL('../../../public/value.txt', import.meta.url), 'utf8') }));
        }
    `);
    const script = `
        import assert from 'node:assert/strict';
        import express from 'express';
        import { setConfigFilePath } from './src/util.js';
        setConfigFilePath('./default/config.yaml');
        const { loadPlugins, listInstalledServerPlugins } = await import('./src/plugin-loader.js');
        const app = express();
        const cleanup = await loadPlugins(app, ${JSON.stringify(plugins)});
        const listed = await listInstalledServerPlugins(${JSON.stringify(plugins)});
        assert.equal(listed.find(plugin => plugin.directory === 'demo').path, ${JSON.stringify(path.join(plugins, 'demo'))});
        const server = app.listen(0, '127.0.0.1');
        await new Promise(resolve => server.once('listening', resolve));
        try {
            const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/plugins/demo/status');
            assert.equal(response.status, ${mode === 'valid' ? 200 : 404});
            if (${mode === 'valid'}) assert.deepEqual(await response.json(), { value: 42, bytes: 1024, public: 'host-public' });
            const cjs = await fetch('http://127.0.0.1:' + server.address().port + '/api/plugins/commonjs/status');
            assert.equal(cjs.status, ${mode === 'valid' ? 200 : 404});
            if (${mode === 'valid'}) assert.deepEqual(await cjs.json(), { bytes: 2048 });
        } finally { await cleanup(); server.close(); }
    `;
    expect(() => execFileSync(process.execPath, ['--preserve-symlinks', '--input-type=module', '-e', script], {
        cwd: repo,
        env: { ...process.env, LUKER_ENABLE_SERVER_PLUGINS: 'true', LUKER_ENABLE_SERVER_PLUGINS_AUTO_UPDATE: 'false', LUKER_SERVER_PLUGINS_LOAD_PATH: alias },
        stdio: 'pipe', timeout: 20000,
    })).not.toThrow();
});
