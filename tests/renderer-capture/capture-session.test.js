import { describe, test, expect } from '@jest/globals';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { connectChannel } from '../../src/renderer-capture/cdp-channel.js';
import { fetchTargets, selectPageTarget } from '../../src/renderer-capture/devtools-socket.js';
import { writeHeapSnapshot, writeTraceStart, writeTraceDrain, TRACE_CATEGORIES } from '../../src/renderer-capture/capture-session.js';
import { startFakeDevtools } from './_lib/fake-devtools-server.js';

async function openChannel(server) {
    const target = selectPageTarget(await fetchTargets(server.socketPath));
    return connectChannel(server.socketPath, target.webSocketDebuggerUrl);
}

/**
 * A real artifact file. The capture writes through the descriptor it is
 * handed, so the assertions read the bytes back off disk.
 */
function openArtifact() {
    const dir = mkdtempSync(path.join(tmpdir(), 'luker-artifact-'));
    const file = path.join(dir, 'artifact');
    const fd = openSync(file, 'w');
    return {
        fd,
        read: () => readFileSync(file, 'utf8'),
        dispose: () => {
            closeSync(fd);
            rmSync(dir, { recursive: true, force: true });
        },
    };
}

describe('heap snapshot capture', () => {
    test('streams every heap chunk into the artifact', async () => {
        const server = await startFakeDevtools({ heapChunks: ['{"snapshot"', ':{}}'] });
        const artifact = openArtifact();
        try {
            const channel = await openChannel(server);
            const bytes = await writeHeapSnapshot({ channel, fd: artifact.fd });
            expect(artifact.read()).toBe('{"snapshot":{}}');
            expect(bytes).toBe(15);
            channel.close();
        } finally {
            artifact.dispose();
            await server.close();
        }
    });

    test('reports a failure when the renderer disappears mid-capture', async () => {
        const server = await startFakeDevtools({ heapChunks: ['{"snapshot"'], closeOnHeapStart: true });
        const artifact = openArtifact();
        try {
            const channel = await openChannel(server);
            await expect(writeHeapSnapshot({ channel, fd: artifact.fd })).rejects.toThrow();
        } finally {
            artifact.dispose();
            await server.close();
        }
    });

    test('reports a failure when the renderer answers with an error', async () => {
        const server = await startFakeDevtools({ errorOnHeapStart: true });
        const artifact = openArtifact();
        try {
            const channel = await openChannel(server);
            await expect(writeHeapSnapshot({ channel, fd: artifact.fd }))
                .rejects.toThrow('HeapProfiler.takeHeapSnapshot: boom');
        } finally {
            artifact.dispose();
            await server.close();
        }
    });

    test('reports a failure when the snapshot arrives without a single chunk', async () => {
        const server = await startFakeDevtools({ heapChunks: [] });
        const artifact = openArtifact();
        try {
            const channel = await openChannel(server);
            await expect(writeHeapSnapshot({ channel, fd: artifact.fd }))
                .rejects.toThrow('the heap snapshot arrived without any data');
        } finally {
            artifact.dispose();
            await server.close();
        }
    });
});

describe('performance trace capture', () => {
    test('asks for a streamed trace', async () => {
        const server = await startFakeDevtools({ traceChunks: ['{"traceEvents":[]}'] });
        try {
            const channel = await openChannel(server);
            await expect(writeTraceStart({ channel, categories: TRACE_CATEGORIES })).resolves.toBeUndefined();
            channel.close();
        } finally {
            await server.close();
        }
    });

    test('drains the trace stream into the artifact', async () => {
        const server = await startFakeDevtools({ traceChunks: ['{"traceEvents":', '[]}'] });
        const artifact = openArtifact();
        try {
            const channel = await openChannel(server);
            await writeTraceStart({ channel, categories: TRACE_CATEGORIES });
            const bytes = await writeTraceDrain({ channel, fd: artifact.fd });
            expect(artifact.read()).toBe('{"traceEvents":[]}');
            expect(bytes).toBe(Buffer.byteLength('{"traceEvents":[]}'));
            channel.close();
        } finally {
            artifact.dispose();
            await server.close();
        }
    });

    test('reports a failure when the trace arrives without any data', async () => {
        const server = await startFakeDevtools({ traceChunks: [] });
        const artifact = openArtifact();
        try {
            const channel = await openChannel(server);
            await writeTraceStart({ channel, categories: TRACE_CATEGORIES });
            await expect(writeTraceDrain({ channel, fd: artifact.fd }))
                .rejects.toThrow('the trace arrived without any data');
            channel.close();
        } finally {
            artifact.dispose();
            await server.close();
        }
    });

    test('keeps every chunk when a notification lands between reads', async () => {
        const server = await startFakeDevtools({
            traceChunks: ['{"a"', ',"b"', ',"c"}'],
            notifyDuringTraceDrain: true,
        });
        const artifact = openArtifact();
        try {
            const channel = await openChannel(server);
            await writeTraceStart({ channel, categories: TRACE_CATEGORIES });
            const bytes = await writeTraceDrain({ channel, fd: artifact.fd });
            expect(artifact.read()).toBe('{"a","b","c"}');
            expect(bytes).toBe(Buffer.byteLength('{"a","b","c"}'));
            channel.close();
        } finally {
            artifact.dispose();
            await server.close();
        }
    });
});
