import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse as parseYaml } from 'yaml';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOW = path.join(REPO_ROOT, '.github', 'workflows', 'desktop-release.yml');
const ROOT_PACKAGE = path.join(REPO_ROOT, 'package.json');
const DESKTOP_PACKAGE = path.join(REPO_ROOT, 'desktop-app', 'package.json');

// Every artifact a plain `--mac` / `--win` build emits lands here; the release
// globs are relative to the repository root.
const DIST = 'desktop-app/dist';

// electron-builder's `artifactName` carries `${ext}`, which is the target's own
// extension rather than the target name.
const TARGET_EXTENSION = { dmg: 'dmg', nsis: 'exe', zip: 'zip' };

function readWorkflow() {
    return parseYaml(fs.readFileSync(WORKFLOW, 'utf8'));
}

function allSteps(workflow) {
    return Object.values(workflow.jobs).flatMap(job => job.steps ?? []);
}

function runSteps(workflow) {
    return allSteps(workflow).filter(step => typeof step.run === 'string');
}

function publishSteps(workflow) {
    return allSteps(workflow).filter(step => String(step.uses ?? '').startsWith('softprops/action-gh-release'));
}

// A `run:` script that reads a shell variable or opens a subshell is executed by
// the runner's default shell. Windows runners default to PowerShell, so any
// such step has to ask for bash explicitly. GitHub's `${{ }}` expressions are
// substituted before the shell ever sees them, so they are not matches.
const SHELL_SUBSTITUTION = /\$\(|\$\{?[A-Za-z_]/;

// The workflow only uses `*` inside a path segment, so a literal translation is
// an exact matcher for the patterns under test.
function globToRegExp(pattern) {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
    return new RegExp(`^${escaped}$`);
}

test('the workflow triggers on every branch, on tags and on a manual dispatch', () => {
    const workflow = readWorkflow();
    expect(workflow.permissions?.contents).toBe('write');

    const dispatch = workflow.on?.workflow_dispatch?.inputs?.build_type;
    expect(dispatch).toEqual({
        description: 'Build type to run manually',
        required: true,
        default: 'debug',
        type: 'choice',
        options: ['debug', 'release'],
    });

    expect(workflow.on?.push?.branches).toEqual(['**']);
    expect(workflow.on?.push?.tags).toEqual(['*']);
});

test('the two platform jobs run on their own runners behind the repository gate', () => {
    const jobs = readWorkflow().jobs;
    expect(Object.keys(jobs).sort()).toEqual(['build-macos', 'build-windows']);
    expect(jobs['build-macos']['runs-on']).toBe('macos-latest');
    expect(jobs['build-windows']['runs-on']).toBe('windows-latest');
    for (const job of Object.values(jobs)) {
        expect(String(job.if)).toContain("github.repository == 'funnycups/Luker'");
    }
});

test('only the desktop install lets lifecycle scripts run', () => {
    const installs = runSteps(readWorkflow()).filter(step => step.run.trim().startsWith('npm '));
    const withScripts = installs.filter(step => step.run.includes('--ignore-scripts'));

    // The root .npmrc keeps `ignore-scripts=true`; overriding it there would make
    // CI compile native modules. Electron's postinstall is the one exception, and
    // it runs in the desktop package, once per platform job.
    expect(withScripts.length).toBe(2);
    for (const step of withScripts) {
        expect(step.run.trim()).toBe('npm install --ignore-scripts=false');
        expect(step['working-directory']).toBe('desktop-app');
    }

    const rootInstalls = installs.filter(step => step.run.trim() === 'npm ci');
    expect(rootInstalls.length).toBe(2);
    for (const step of rootInstalls) {
        expect(step['working-directory']).toBeUndefined();
    }
});

test('every run step that uses shell substitution asks for bash', () => {
    const substituting = runSteps(readWorkflow()).filter(step => SHELL_SUBSTITUTION.test(step.run));
    expect(substituting.length).toBeGreaterThan(0);
    expect(substituting.filter(step => step.shell !== 'bash').map(step => step.name)).toEqual([]);
});

test('each job builds through the desktop build script', () => {
    const jobs = readWorkflow().jobs;
    for (const [job, platform] of [['build-macos', 'mac'], ['build-windows', 'win']]) {
        const build = runSteps({ jobs: { [job]: jobs[job] } })
            .find(step => step.run.trim() === `node scripts/build-desktop.mjs ${platform}`);
        expect(build).toBeDefined();
        expect(build['working-directory']).toBe('desktop-app');
    }

    // The script owns the electron-builder invocation, so the workflow must not
    // assemble one of its own.
    expect(runSteps(readWorkflow()).map(step => step.run).join('\n')).not.toContain('electron-builder');
});

test('a tag build refuses to run when the tag and the manifest version disagree', () => {
    const validate = runSteps(readWorkflow())
        .find(step => step.run.includes("require('./package.json').version"));
    expect(validate).toBeDefined();
    expect(validate.run).toContain('GITHUB_REF_NAME');
    expect(validate.run).toContain('exit 1');
    expect(validate.shell).toBe('bash');
    expect(String(validate.if)).toContain('refs/tags/');
});

test('a tag build publishes the artifacts through the shared release action', () => {
    const publishes = publishSteps(readWorkflow());
    expect(publishes.length).toBeGreaterThan(0);
    for (const step of publishes) {
        expect(step.uses).toBe('softprops/action-gh-release@v2');
        expect(String(step.if)).toContain('refs/tags/');
        expect(step.with.tag_name).toBe('${{ github.ref_name }}');
        expect(step.with.name).toBe('${{ github.ref_name }}');
        expect(step.with.prerelease).toBe("${{ contains(github.ref_name, '-') }}");
        expect(step.with.generate_release_notes).toBe(true);
    }
});

test('the release globs cover both architectures of both platforms', () => {
    const desktop = JSON.parse(fs.readFileSync(DESKTOP_PACKAGE, 'utf8')).build;
    const { version } = JSON.parse(fs.readFileSync(ROOT_PACKAGE, 'utf8'));

    const names = [];
    for (const os of ['mac', 'win']) {
        for (const entry of desktop[os].target) {
            // A plain `--mac` / `--win` has to emit both architectures, so the
            // arch list is asserted alongside the names it produces.
            expect(entry.arch).toEqual(expect.arrayContaining(['arm64', 'x64']));
            for (const arch of entry.arch) {
                names.push(desktop.artifactName
                    .replace('${version}', version)
                    .replace('${os}', os)
                    .replace('${arch}', arch)
                    .replace('${ext}', TARGET_EXTENSION[entry.target]));
            }
        }
    }
    expect(names).toHaveLength(8);

    const patterns = publishSteps(readWorkflow())
        .flatMap(step => String(step.with.files).split('\n').map(line => line.trim()).filter(Boolean));
    for (const name of names) {
        expect(patterns.some(pattern => globToRegExp(pattern).test(`${DIST}/${name}`))).toBe(true);
    }
});
