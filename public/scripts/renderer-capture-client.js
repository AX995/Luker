// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 FunnyCups (https://github.com/funnycups)

// Client for the server-side renderer capture endpoints. On HarmonyOS the
// capture cannot run inside the WebView bridge, so it lives in the bundled
// node backend and reaches the page as ordinary same-origin HTTP.
import { getRequestHeaders } from '../script.js';

const STATUS_URL = '/api/debug/capture/status';
const HEAP_URL = '/api/debug/capture/heap';
const TRACE_START_URL = '/api/debug/capture/trace/start';
const TRACE_STOP_URL = '/api/debug/capture/trace/stop';
const ARTIFACT_URL = '/api/debug/capture/artifact/';

async function readEnvelope(response) {
    const body = await response.json();
    if (!response.ok) {
        throw new Error(body.error || `renderer capture request failed: ${response.status}`);
    }
    return body;
}

/**
 * @returns {Promise<{available: boolean, recording: boolean, reason: string|null}>}
 */
export async function readCaptureStatus() {
    return await readEnvelope(await fetch(STATUS_URL, { headers: getRequestHeaders({ omitContentType: true }) }));
}

/**
 * @returns {Promise<{name: string, bytes: number}>}
 */
export async function requestHeapSnapshot() {
    return await readEnvelope(await fetch(HEAP_URL, { method: 'POST', headers: getRequestHeaders() }));
}

/**
 * @returns {Promise<{name: string}>}
 */
export async function requestTraceStart() {
    return await readEnvelope(await fetch(TRACE_START_URL, { method: 'POST', headers: getRequestHeaders() }));
}

/**
 * @returns {Promise<{name: string, bytes: number}>}
 */
export async function requestTraceStop() {
    return await readEnvelope(await fetch(TRACE_STOP_URL, { method: 'POST', headers: getRequestHeaders() }));
}

/**
 * Hand an artifact to the browser's download machinery. The endpoint answers
 * with `Content-Disposition: attachment`, so a plain same-origin navigation is
 * enough. Going through a blob would buffer the whole snapshot in the page's
 * heap, which is the opposite of what the server side does with the bytes.
 * @param {string} name
 */
export function downloadArtifact(name) {
    const anchor = document.createElement('a');
    anchor.href = ARTIFACT_URL + encodeURIComponent(name);
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
}
