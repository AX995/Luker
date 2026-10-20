/**
 * On-demand capture of the renderer that hosts the webview.
 *
 * The webview's devtools server speaks CDP over an abstract unix socket. This
 * module owns the artifact directory and the one recording session the app can
 * have at a time; every entry point either returns a finished artifact or
 * throws.
 */
import { closeSync, mkdirSync, openSync, rmSync } from 'node:fs';
import path from 'node:path';
import { connectChannel } from './cdp-channel.js';
import { fetchTargets, resolveSocketPath, selectPageTarget } from './devtools-socket.js';
import { TRACE_CATEGORIES, writeHeapSnapshot, writeTraceDrain, writeTraceStart } from './capture-session.js';

const CAPTURE_DIR_NAME = 'renderer-capture';

/** @type {{ name: string, channel: object, fd: number }|null} */
let session = null;
let traceStarting = false;
let heapInFlight = false;

export function captureDir() {
    return path.join(globalThis.DATA_ROOT, CAPTURE_DIR_NAME);
}

export function artifactPath(name) {
    return path.join(captureDir(), name);
}

export function removeArtifact(name) {
    rmSync(artifactPath(name), { force: true });
}

function stamp() {
    const now = new Date();
    const pad = (value, width = 2) => String(value).padStart(width, '0');
    // Milliseconds keep two captures of the same kind in the same second from
    // opening the same path.
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
        + `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
        + `-${pad(now.getMilliseconds(), 3)}`;
}

async function openCaptureChannel(socketPath) {
    const resolved = socketPath ?? resolveSocketPath();
    const target = selectPageTarget(await fetchTargets(resolved));
    if (!target) {
        throw new Error('renderer-capture: the devtools server has no local page target');
    }
    return connectChannel(resolved, target.webSocketDebuggerUrl);
}

/**
 * Report whether a capture can run at all, and why not when it cannot.
 *
 * An unavailable devtools server is the answer here, not an error, so the
 * failure is turned into the `reason` field rather than thrown — nothing is
 * swallowed, it is reported to the caller.
 *
 * @param {{ socketPath?: string }} [options]
 * @returns {Promise<{ available: boolean, reason: string|null }>}
 */
export async function probeCapture({ socketPath } = {}) {
    try {
        const resolved = socketPath ?? resolveSocketPath();
        const target = selectPageTarget(await fetchTargets(resolved));
        if (!target) {
            return { available: false, reason: 'the devtools server has no local page target' };
        }
        return { available: true, reason: null };
    } catch (error) {
        return { available: false, reason: error.message };
    }
}

/**
 * @returns {Promise<{ name: string, bytes: number }>}
 */
export async function captureHeapSnapshot() {
    if (heapInFlight) {
        throw new Error('renderer-capture: a heap capture is already running');
    }
    heapInFlight = true;

    try {
        mkdirSync(captureDir(), { recursive: true });

        const name = `luker-heap-${stamp()}.heapsnapshot`;
        // Open the artifact before touching the renderer: a path the app cannot
        // write to must fail the capture, not start one it cannot save.
        const fd = openSync(artifactPath(name), 'w');

        try {
            const channel = await openCaptureChannel();
            try {
                const bytes = await writeHeapSnapshot({ channel, fd });
                return { name, bytes };
            } finally {
                channel.close();
            }
        } catch (error) {
            removeArtifact(name);
            throw error;
        } finally {
            closeSync(fd);
        }
    } finally {
        heapInFlight = false;
    }
}

/**
 * @returns {Promise<{ name: string }>}
 */
export async function startTrace() {
    if (session || traceStarting) {
        throw new Error('renderer-capture: a recording is already running');
    }
    traceStarting = true;

    try {
        mkdirSync(captureDir(), { recursive: true });

        const name = `luker-trace-${stamp()}.json`;
        const fd = openSync(artifactPath(name), 'w');

        let channel;
        try {
            channel = await openCaptureChannel();
        } catch (error) {
            closeSync(fd);
            removeArtifact(name);
            throw error;
        }

        // The slot is claimed before the first command so a navigation that
        // arrives while the trace is starting still ends the recording, and so
        // two callers cannot both open a session.
        session = { name, channel, fd };
        channel.onEvent((message) => {
            // A navigation replaces the page the recording was started for, so
            // the recording ends there rather than spanning two documents.
            if (message.method === 'Page.frameNavigated') {
                abortTrace();
            }
        });

        try {
            await writeTraceStart({ channel, categories: TRACE_CATEGORIES });
        } catch (error) {
            abortTrace();
            throw error;
        }

        return { name };
    } finally {
        traceStarting = false;
    }
}

/**
 * @returns {Promise<{ name: string, bytes: number }>}
 */
export async function stopTrace() {
    if (!session) {
        throw new Error('renderer-capture: no recording is running');
    }

    const current = session;
    session = null;

    try {
        const bytes = await writeTraceDrain({ channel: current.channel, fd: current.fd });
        return { name: current.name, bytes };
    } catch (error) {
        removeArtifact(current.name);
        throw error;
    } finally {
        current.channel.close();
        closeSync(current.fd);
    }
}

export function isTraceRecording() {
    if (session?.channel.closed) {
        // The renderer went away mid-recording: nothing was ever written, so
        // the session is dropped rather than reported as still running.
        abortTrace();
    }
    return session !== null;
}

/**
 * Drop a recording that can no longer be finished, for instance because the
 * page navigated or the renderer went away. Nothing has been written at that
 * point, so the artifact is removed rather than kept.
 *
 * @returns {boolean} whether a recording was running
 */
export function abortTrace() {
    if (!session) {
        return false;
    }

    const current = session;
    session = null;
    current.channel.close();
    closeSync(current.fd);
    removeArtifact(current.name);
    return true;
}
