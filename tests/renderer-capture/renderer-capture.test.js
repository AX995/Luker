import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startFakeDevtools } from './_lib/fake-devtools-server.js';

const HEAP = '{"snapshot":{}}';
const TRACE = '{"traceEvents":[]}';

let dataRoot;
let server;
let capture;

async function loadCapture() {
    jest.resetModules();
    return import('../../src/renderer-capture/index.js');
}

beforeEach(async () => {
    dataRoot = mkdtempSync(path.join(tmpdir(), 'luker-data-'));
    globalThis.DATA_ROOT = dataRoot;
    capture = await loadCapture();
});

afterEach(async () => {
    if (server) {
        await server.close();
        server = null;
    }
    delete process.env.LUKER_RENDERER_DEVTOOLS_SOCKET;
    delete globalThis.DATA_ROOT;
    rmSync(dataRoot, { recursive: true, force: true });
});

describe('renderer capture entry points', () => {
    test('probes availability when no devtools socket is listening', async () => {
        const missing = path.join(tmpdir(), 'luker-absent-devtools.sock');
        await expect(capture.probeCapture({ socketPath: missing }))
            .resolves.toEqual({ available: false, reason: expect.any(String) });
    });

    test('probes availability against a live devtools socket', async () => {
        server = await startFakeDevtools();
        await expect(capture.probeCapture({ socketPath: server.socketPath }))
            .resolves.toEqual({ available: true, reason: null });
    });

    test('captures a heap snapshot into the data root', async () => {
        server = await startFakeDevtools({ heapChunks: ['{"snapshot":', '{}}'] });
        process.env.LUKER_RENDERER_DEVTOOLS_SOCKET = server.socketPath;

        const result = await capture.captureHeapSnapshot();

        expect(result.name).toMatch(/^luker-heap-\d{8}-\d{6}-\d{3}\.heapsnapshot$/);
        expect(result.bytes).toBe(Buffer.byteLength(HEAP));
        expect(readFileSync(capture.artifactPath(result.name), 'utf8')).toBe(HEAP);
    });

    test('drops the artifact when the heap capture fails', async () => {
        server = await startFakeDevtools({ errorOnHeapStart: true });
        process.env.LUKER_RENDERER_DEVTOOLS_SOCKET = server.socketPath;

        await expect(capture.captureHeapSnapshot()).rejects.toThrow('boom');
        expect(readdirSync(capture.captureDir())).toEqual([]);
    });

    test('reports a failure when the artifact file cannot be created', async () => {
        server = await startFakeDevtools({ heapChunks: [HEAP] });
        process.env.LUKER_RENDERER_DEVTOOLS_SOCKET = server.socketPath;

        mkdirSync(capture.captureDir(), { recursive: true });
        chmodSync(capture.captureDir(), 0o500);

        try {
            await expect(capture.captureHeapSnapshot()).rejects.toThrow(/EACCES|permission denied/);
        } finally {
            chmodSync(capture.captureDir(), 0o700);
        }

        expect(readdirSync(capture.captureDir())).toEqual([]);
    });

    test('records a trace across start and stop', async () => {
        server = await startFakeDevtools({ traceChunks: ['{"traceEvents":', '[]}'] });
        process.env.LUKER_RENDERER_DEVTOOLS_SOCKET = server.socketPath;

        expect(capture.isTraceRecording()).toBe(false);
        const started = await capture.startTrace();
        expect(capture.isTraceRecording()).toBe(true);

        const stopped = await capture.stopTrace();
        expect(stopped.name).toBe(started.name);
        expect(stopped.bytes).toBe(Buffer.byteLength(TRACE));
        expect(readFileSync(capture.artifactPath(stopped.name), 'utf8')).toBe(TRACE);
        expect(capture.isTraceRecording()).toBe(false);
    });

    test('refuses a second recording', async () => {
        server = await startFakeDevtools({ traceChunks: [TRACE] });
        process.env.LUKER_RENDERER_DEVTOOLS_SOCKET = server.socketPath;

        await capture.startTrace();
        await expect(capture.startTrace()).rejects.toThrow('a recording is already running');
        capture.abortTrace();
    });

    test('refuses to stop when nothing is recording', async () => {
        await expect(capture.stopTrace()).rejects.toThrow('no recording is running');
    });

    test('aborts a recording and drops the empty artifact', async () => {
        server = await startFakeDevtools({ traceChunks: [TRACE] });
        process.env.LUKER_RENDERER_DEVTOOLS_SOCKET = server.socketPath;

        const started = await capture.startTrace();
        expect(capture.abortTrace()).toBe(true);
        expect(capture.isTraceRecording()).toBe(false);
        expect(existsSync(capture.artifactPath(started.name))).toBe(false);
        expect(capture.abortTrace()).toBe(false);
    });

    test('removes an artifact on request', async () => {
        server = await startFakeDevtools({ heapChunks: [HEAP] });
        process.env.LUKER_RENDERER_DEVTOOLS_SOCKET = server.socketPath;

        const result = await capture.captureHeapSnapshot();
        expect(existsSync(capture.artifactPath(result.name))).toBe(true);
        capture.removeArtifact(result.name);
        expect(existsSync(capture.artifactPath(result.name))).toBe(false);
    });

    test('drops the recording when the page navigates', async () => {
        server = await startFakeDevtools({ traceChunks: [TRACE] });
        process.env.LUKER_RENDERER_DEVTOOLS_SOCKET = server.socketPath;

        const started = await capture.startTrace();
        expect(capture.isTraceRecording()).toBe(true);

        server.navigate();
        await new Promise(resolve => setTimeout(resolve, 50));

        expect(capture.isTraceRecording()).toBe(false);
        expect(existsSync(capture.artifactPath(started.name))).toBe(false);
    });

    test('refuses a second recording while one is starting', async () => {
        server = await startFakeDevtools({ traceChunks: [TRACE] });
        process.env.LUKER_RENDERER_DEVTOOLS_SOCKET = server.socketPath;

        const results = await Promise.allSettled([capture.startTrace(), capture.startTrace()]);

        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    });

    test('refuses a second heap capture while one is running', async () => {
        server = await startFakeDevtools({ heapChunks: [HEAP] });
        process.env.LUKER_RENDERER_DEVTOOLS_SOCKET = server.socketPath;

        const results = await Promise.allSettled([
            capture.captureHeapSnapshot(),
            capture.captureHeapSnapshot(),
        ]);

        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    });
});
