import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// The backend runs on two Node builds: the OpenSSL build that ships with the
// system install, and the BoringSSL build embedded in the desktop shell. The
// BoringSSL build's crypto.getHashes() has none of these families, so a call
// site using one throws "Digest method not supported" at runtime — after the
// server has already started booting, which makes it look like a hang.
const OPENSSL_ONLY_DIGEST = /^(shake\d+|sha3-\d+|blake2[bs]\d*|sm3|ripemd\d+|md4|whirlpool)$/i;

const DIGEST_CALL = /create(?:Hash|Hmac|Sign|Verify)\(\s*['"]([^'"]+)['"]/g;

const SCAN_ROOTS = ['src', 'scripts'];
const SCAN_FILES = ['server.js', 'webpack.config.js'];

function listSourceFiles(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
            continue;
        }
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...listSourceFiles(full));
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            out.push(full);
        }
    }
    return out;
}

function collectFiles() {
    const files = SCAN_ROOTS.flatMap(root => listSourceFiles(path.join(REPO_ROOT, root)));
    for (const file of SCAN_FILES) {
        files.push(path.join(REPO_ROOT, file));
    }
    return files;
}

function findOffenders() {
    const offenders = [];
    for (const file of collectFiles()) {
        const source = fs.readFileSync(file, 'utf8');
        for (const match of source.matchAll(DIGEST_CALL)) {
            if (!OPENSSL_ONLY_DIGEST.test(match[1])) {
                continue;
            }
            const line = source.slice(0, match.index).split('\n').length;
            offenders.push(`${path.relative(REPO_ROOT, file)}:${line} → ${match[0]}`);
        }
    }
    return offenders;
}

test('server-side code uses only digests the embedded runtime provides', () => {
    expect(findOffenders()).toEqual([]);
});
