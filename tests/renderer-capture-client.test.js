/**
 * @jest-environment jsdom
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';

describe('renderer capture client', () => {
    let fetchMock;
    let headers;

    beforeEach(() => {
        jest.resetModules();
        fetchMock = jest.fn();
        headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': 'token' };
        globalThis.fetch = fetchMock;
        jest.unstable_mockModule('../public/script.js', () => ({
            getRequestHeaders: () => headers,
        }));
    });

    async function loadClient() {
        return await import('../public/scripts/renderer-capture-client.js');
    }

    test('reads the capture status with the request headers', async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({ available: true, recording: false, reason: null }) });

        const client = await loadClient();
        const status = await client.readCaptureStatus();

        expect(status.available).toBe(true);
        expect(fetchMock).toHaveBeenCalledWith('/api/debug/capture/status', { headers });
    });

    test('posts a heap capture', async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({ name: 'h.heapsnapshot', bytes: 1 }) });

        const client = await loadClient();
        await client.requestHeapSnapshot();

        expect(fetchMock).toHaveBeenCalledWith('/api/debug/capture/heap', { method: 'POST', headers });
    });

    test('posts the trace start and the trace stop', async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({ name: 't.json' }) });

        const client = await loadClient();
        await client.requestTraceStart();
        await client.requestTraceStop();

        expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
            '/api/debug/capture/trace/start',
            '/api/debug/capture/trace/stop',
        ]);
    });

    test('surfaces the server error message', async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'a recording is already running' }) });

        const client = await loadClient();

        await expect(client.requestTraceStart()).rejects.toThrow('a recording is already running');
    });

    test('reports the status code when the body carries no error', async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

        const client = await loadClient();

        await expect(client.requestHeapSnapshot()).rejects.toThrow('renderer capture request failed: 500');
    });

    test('navigates to the artifact url so the browser downloads it', async () => {
        const clicks = [];
        HTMLAnchorElement.prototype.click = function () {
            clicks.push({ href: this.href, download: this.download });
        };

        const client = await loadClient();
        client.downloadArtifact('luker heap 1.heapsnapshot');

        expect(clicks).toHaveLength(1);
        expect(clicks[0].href).toContain('/api/debug/capture/artifact/luker%20heap%201.heapsnapshot');
        expect(clicks[0].download).toBe('luker heap 1.heapsnapshot');
        expect(document.querySelector('a')).toBeNull();
    });
});
