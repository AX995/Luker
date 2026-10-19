import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const INDEX = resolve(REPO_ROOT, 'src/storage/index.js');

// 在子进程里跑，避免 jest 自身的模块注册表污染判断。
// better-sqlite3 是 CJS，被加载后会出现在 require.cache；sqlite-engine.js
// 是 ESM，不进 require.cache，所以只看 better-sqlite3 的条目。
function countSqliteModules(body) {
    const script = `
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const mod = await import(${JSON.stringify(INDEX)});
${body}
const n = Object.keys(require.cache).filter(k => /better-sqlite3/.test(k)).length;
console.log(JSON.stringify({ n }));
`;
    const out = execFileSync('node', ['--input-type=module', '-e', script], { encoding: 'utf8' });
    return JSON.parse(out.trim().split('\n').pop()).n;
}

test('importing the storage barrel does not load better-sqlite3', () => {
    expect(countSqliteModules('')).toBe(0);
});

test('initStorage({ mode: "sqlite" }) loads better-sqlite3', () => {
    expect(countSqliteModules(
        'await mod.initStorage({ mode: "sqlite", directoriesByHandle: () => ({ root: "/tmp" }) });',
    )).toBeGreaterThan(0);
});
