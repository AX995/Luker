import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOCS = path.join(REPO_ROOT, 'docs');
const CONFIG = path.join(DOCS, '.vitepress', 'config.ts');

// Each locale ships its own guide page and its own sidebar array, so the page
// only appears in the docs site when both halves are present.
const PAGES = [
    { file: path.join(DOCS, 'guide', 'desktop.md'), sidebar: 'enSidebar', link: '/guide/desktop' },
    { file: path.join(DOCS, 'zh-CN', 'guide', 'desktop.md'), sidebar: 'zhCNSidebar', link: '/zh-CN/guide/desktop' },
    { file: path.join(DOCS, 'zh-TW', 'guide', 'desktop.md'), sidebar: 'zhTWSidebar', link: '/zh-TW/guide/desktop' },
];

function requireFile(file) {
    if (!fs.existsSync(file)) {
        throw new Error(`${path.relative(REPO_ROOT, file)} does not exist`);
    }
}

// A sidebar array is a top-level `const <name>Sidebar = [...]` block. A link
// belongs to the block it sits in, so slice from that block's declaration up to
// the next sidebar declaration and search only inside the slice.
function sidebarSection(source, name) {
    const declarations = [];
    const pattern = /const (\w+Sidebar) = \[/g;
    let match;
    while ((match = pattern.exec(source)) !== null) {
        declarations.push({ name: match[1], index: match.index });
    }

    const position = declarations.findIndex(entry => entry.name === name);
    if (position === -1) {
        throw new Error(`${name} is not declared in config.ts`);
    }

    const end = declarations[position + 1]?.index ?? source.length;
    return source.slice(declarations[position].index, end);
}

test('the desktop guide page exists in all three locales', () => {
    for (const page of PAGES) {
        requireFile(page.file);
    }
});

test('each sidebar lists its locale desktop page', () => {
    const source = fs.readFileSync(CONFIG, 'utf8');
    for (const page of PAGES) {
        expect(sidebarSection(source, page.sidebar)).toContain(`link: '${page.link}'`);
    }
});
