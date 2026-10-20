import { describe, test, expect } from '@jest/globals';
import { connectChannel } from '../../src/renderer-capture/cdp-channel.js';
import { fetchTargets, selectPageTarget } from '../../src/renderer-capture/devtools-socket.js';
import { startFakeDevtools } from './_lib/fake-devtools-server.js';

async function openChannel(server) {
    const target = selectPageTarget(await fetchTargets(server.socketPath));
    return connectChannel(server.socketPath, target.webSocketDebuggerUrl);
}

describe('cdp channel', () => {
    test('connects to the websocket over the devtools socket', async () => {
        const server = await startFakeDevtools({ heapChunks: ['a'] });
        try {
            const channel = await openChannel(server);
            channel.send({ id: 1, method: 'HeapProfiler.enable' });
            await expect(channel.next()).resolves.toMatchObject({ id: 1 });
            channel.close();
        } finally {
            await server.close();
        }
    });

    test('rejects a pending read when the renderer goes away', async () => {
        const server = await startFakeDevtools({ heapChunks: ['a'], closeOnHeapStart: true });
        try {
            const channel = await openChannel(server);
            channel.send({ id: 1, method: 'HeapProfiler.takeHeapSnapshot' });
            await expect(channel.next()).resolves.toMatchObject({ method: 'HeapProfiler.addHeapSnapshotChunk' });
            await expect(channel.next()).rejects.toThrow();
        } finally {
            await server.close();
        }
    });

    test('fails every later read once the channel is closed', async () => {
        const server = await startFakeDevtools();
        try {
            const channel = await openChannel(server);
            channel.close();
            await expect(channel.next()).rejects.toThrow('renderer-capture: the cdp channel is closed');
        } finally {
            await server.close();
        }
    });

    test('hands notifications to a registered handler', async () => {
        const server = await startFakeDevtools();
        try {
            const channel = await openChannel(server);
            const seen = [];
            channel.onEvent(message => seen.push(message.method));
            server.navigate();
            await new Promise(resolve => setTimeout(resolve, 50));
            expect(seen).toContain('Page.frameNavigated');
            channel.close();
        } finally {
            await server.close();
        }
    });
});
