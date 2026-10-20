/**
 * A real devtools endpoint for tests.
 *
 * It is an HTTP server on a unix socket that answers `/json/list` and upgrades
 * to a WebSocket speaking the subset of CDP the capture path uses. Nothing
 * here stands in for code under test: the tests connect to it over a real
 * socket exactly the way the app connects to the embedded webview's devtools
 * server.
 */
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocketServer } from 'ws';

const DEFAULT_TARGETS = [
    {
        type: 'page',
        url: 'http://127.0.0.1:8000/',
        webSocketDebuggerUrl: 'ws://localhost/devtools/page/test',
    },
];

function handleCdp(ws, { heapChunks, traceChunks, closeOnHeapStart, errorOnHeapStart, notifyDuringTraceDrain }) {
    let traceIndex = 0;

    ws.on('message', (raw) => {
        const message = JSON.parse(raw.toString());
        const reply = (result) => ws.send(JSON.stringify({ id: message.id, result }));

        switch (message.method) {
            case 'HeapProfiler.enable':
                reply({});
                break;
            case 'HeapProfiler.takeHeapSnapshot': {
                if (errorOnHeapStart) {
                    ws.send(JSON.stringify({ id: message.id, error: { code: -32000, message: 'boom' } }));
                    return;
                }
                const [first, ...rest] = heapChunks;
                if (first !== undefined) {
                    ws.send(JSON.stringify({ method: 'HeapProfiler.addHeapSnapshotChunk', params: { chunk: first } }));
                }
                if (closeOnHeapStart) {
                    ws.close();
                    return;
                }
                for (const chunk of rest) {
                    ws.send(JSON.stringify({ method: 'HeapProfiler.addHeapSnapshotChunk', params: { chunk } }));
                }
                reply({});
                break;
            }
            case 'Tracing.start':
            case 'Page.enable':
            case 'IO.close':
                reply({});
                break;
            case 'Tracing.end':
                reply({});
                ws.send(JSON.stringify({ method: 'Tracing.tracingComplete', params: { stream: '1', dataLossOccurred: false } }));
                break;
            case 'IO.read': {
                const data = traceChunks[traceIndex] ?? '';
                traceIndex += 1;
                reply({ data, eof: traceIndex >= traceChunks.length });
                if (notifyDuringTraceDrain) {
                    ws.send(JSON.stringify({ method: 'Page.loadEventFired', params: { timestamp: traceIndex } }));
                }
                break;
            }
            default:
                reply({});
        }
    });
}

/**
 * @param {{ targets?: object[], heapChunks?: string[], traceChunks?: string[], closeOnHeapStart?: boolean, errorOnHeapStart?: boolean, holdConnectionOpen?: boolean, notifyDuringTraceDrain?: boolean }} [options]
 * @returns {Promise<{ socketPath: string, navigate: () => void, close: () => Promise<void> }>}
 */
export async function startFakeDevtools(options = {}) {
    const {
        targets = DEFAULT_TARGETS,
        heapChunks = [],
        traceChunks = [],
        closeOnHeapStart = false,
        errorOnHeapStart = false,
        holdConnectionOpen = false,
        notifyDuringTraceDrain = false,
    } = options;

    const dir = mkdtempSync(path.join(tmpdir(), 'luker-devtools-'));
    const socketPath = path.join(dir, 'devtools.sock');
    const wss = new WebSocketServer({ noServer: true });
    const sockets = new Set();

    const server = createServer((request, response) => {
        if (request.url === '/json/list') {
            const body = JSON.stringify(targets);
            response.writeHead(200, {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
            });
            // The embedded devtools server answers with a complete response and
            // then keeps the connection open, so a client that waits for the
            // socket to end never hears back.
            if (holdConnectionOpen) {
                response.write(body);
                return;
            }
            response.end(body);
            return;
        }
        response.writeHead(404);
        response.end();
    });

    server.on('connection', (socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
    });

    server.on('upgrade', (request, socket, head) => {
        wss.handleUpgrade(request, socket, head, (ws) => handleCdp(ws, {
            heapChunks,
            traceChunks,
            closeOnHeapStart,
            errorOnHeapStart,
            notifyDuringTraceDrain,
        }));
    });

    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(socketPath, resolve);
    });

    return {
        socketPath,
        /**
         * Announce a page navigation the way the embedded devtools server does.
         */
        navigate() {
            for (const client of wss.clients) {
                client.send(JSON.stringify({
                    method: 'Page.frameNavigated',
                    params: { frame: { id: 'test', url: 'http://127.0.0.1:8000/next' } },
                }));
            }
        },
        async close() {
            for (const client of wss.clients) {
                client.terminate();
            }
            for (const socket of sockets) {
                socket.destroy();
            }
            await new Promise((resolve) => wss.close(resolve));
            await new Promise((resolve) => server.close(resolve));
            rmSync(dir, { recursive: true, force: true });
        },
    };
}
