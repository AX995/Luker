/**
 * The two capture conversations.
 *
 * Both stream straight into an open file descriptor: a heap snapshot can run
 * to hundreds of megabytes and a trace is unbounded, so nothing here
 * assembles a payload in memory. The writes are synchronous on purpose — the
 * capture owns the descriptor for its whole lifetime, so there is no window
 * in which a failure can land after the capture has already reported back.
 */
import { writeSync } from 'node:fs';

/**
 * @param {number} fd
 * @param {string|Buffer} chunk
 */
function writeChunk(fd, chunk) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');
    let offset = 0;
    while (offset < buffer.length) {
        offset += writeSync(fd, buffer, offset, buffer.length - offset);
    }
}

/**
 * How much of the trace stream to ask for in one `IO.read`. The embedded
 * engine answered a short recording's whole stream in a single read of
 * 471035 bytes, so this covers that case in one round trip.
 */
export const TRACE_READ_CHUNK_BYTES = 524288;

/**
 * The trace categories worth paying for when diagnosing a stalled renderer:
 * the timeline, the JavaScript engine, layout and paint, and the compositor.
 * Screenshot categories are deliberately absent — they multiply the payload
 * without showing anything about why the main thread stalled.
 */
export const TRACE_CATEGORIES = 'devtools.timeline,v8,blink,cc,gpu';

/**
 * Take a heap snapshot and stream it into an open descriptor.
 *
 * @param {{ channel: object, fd: number }} options
 * @returns {Promise<number>} bytes written
 */
export async function writeHeapSnapshot({ channel, fd }) {
    const takeId = 2;

    channel.send({ id: 1, method: 'HeapProfiler.enable' });
    channel.send({
        id: takeId,
        method: 'HeapProfiler.takeHeapSnapshot',
        params: { reportProgress: true },
    });

    let written = 0;

    for (;;) {
        const message = await channel.next();

        if (message.error) {
            throw new Error(`HeapProfiler.takeHeapSnapshot: ${message.error.message}`);
        }

        if (message.method === 'HeapProfiler.addHeapSnapshotChunk' && typeof message.params?.chunk === 'string') {
            written += Buffer.byteLength(message.params.chunk);
            writeChunk(fd, message.params.chunk);
            continue;
        }

        if (message.id === takeId) {
            break;
        }
    }

    if (written === 0) {
        throw new Error('renderer-capture: the heap snapshot arrived without any data');
    }

    return written;
}

/**
 * Begin a trace. The channel has to stay open until `writeTraceDrain` runs.
 *
 * Page events are switched on here so a navigation during the recording
 * arrives as `Page.frameNavigated`.
 *
 * @param {{ channel: object, categories: string }} options
 * @returns {Promise<void>}
 */
export async function writeTraceStart({ channel, categories }) {
    const pageId = 1;
    const startId = 2;

    channel.send({ id: pageId, method: 'Page.enable' });
    channel.send({
        id: startId,
        method: 'Tracing.start',
        params: { categories, transferMode: 'ReturnAsStream' },
    });

    for (;;) {
        const message = await channel.next();
        if (message.error) {
            throw new Error(`Tracing.start: ${message.error.message}`);
        }
        if (message.id === startId) {
            return;
        }
    }
}

/**
 * End the trace, drain the stream it produced, and write it into an open
 * descriptor.
 *
 * @param {{ channel: object, fd: number }} options
 * @returns {Promise<number>} bytes written
 */
export async function writeTraceDrain({ channel, fd }) {
    const endId = 3;
    channel.send({ id: endId, method: 'Tracing.end' });

    let stream = null;
    for (;;) {
        const message = await channel.next();
        if (message.error) {
            throw new Error(`Tracing.end: ${message.error.message}`);
        }
        if (message.method === 'Tracing.tracingComplete') {
            stream = message.params?.stream ?? null;
            break;
        }
    }

    if (!stream) {
        throw new Error('renderer-capture: the trace finished without a stream');
    }

    let written = 0;
    let readId = 4;

    for (;;) {
        const currentId = readId;
        readId += 1;
        channel.send({ id: currentId, method: 'IO.read', params: { handle: stream, size: TRACE_READ_CHUNK_BYTES } });

        // Only one read is outstanding at a time, and notifications the
        // channel forwards in between are stepped over rather than answered
        // with a second read.
        let message;
        for (;;) {
            message = await channel.next();
            if (message.error) {
                throw new Error(`IO.read: ${message.error.message}`);
            }
            if (message.id === currentId) {
                break;
            }
        }

        const result = message.result;
        if (!result) {
            throw new Error('renderer-capture: IO.read answered without a result');
        }

        // The embedded engine hands the trace back as plain text; base64 is
        // honoured too so the same code survives a build that switches.
        const data = result.base64Encoded ? Buffer.from(result.data, 'base64') : result.data;

        if (data && data.length > 0) {
            written += Buffer.byteLength(data);
            writeChunk(fd, data);
        }

        if (result.eof) {
            break;
        }
    }

    channel.send({ id: readId, method: 'IO.close', params: { handle: stream } });

    if (written === 0) {
        throw new Error('renderer-capture: the trace arrived without any data');
    }

    return written;
}
