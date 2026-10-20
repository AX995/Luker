/**
 * @jest-environment jsdom
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';

const MENU_DOM = `
    <div id="debug-menu-list">
        <div class="debug-menu-item" data-debug-action="export-bundle"></div>
        <div class="debug-menu-item" data-debug-action="capture-heap" hidden></div>
        <div class="debug-menu-item" data-debug-action="toggle-perf-recording" hidden></div>
    </div>`;

const item = (action) => document.querySelector(`#debug-menu-list [data-debug-action="${action}"]`);

describe('diagnostics menu capture entries', () => {
    let actions;
    let toggles;
    let toastr;
    let client;

    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    beforeEach(() => {
        jest.resetModules();
        document.body.innerHTML = MENU_DOM;
        actions = new Map();
        toggles = [];
        toastr = { success: jest.fn(), error: jest.fn(), warning: jest.fn() };
        client = {
            readCaptureStatus: jest.fn(),
            requestHeapSnapshot: jest.fn(),
            requestTraceStart: jest.fn(),
            requestTraceStop: jest.fn(),
            downloadArtifact: jest.fn(),
        };
        globalThis.toastr = toastr;

        jest.unstable_mockModule('../public/scripts/debug-export.js', () => ({
            registerDebugMenuAction: (action, handler) => actions.set(action, handler),
            setDebugMenuToggleState: (action, checked) => toggles.push([action, checked]),
        }));
        jest.unstable_mockModule('../public/scripts/i18n.js', () => ({
            translate: (text) => text,
        }));
        jest.unstable_mockModule('../public/scripts/renderer-capture-client.js', () => client);
    });

    afterEach(() => {
        delete window.LukerAndroid;
        delete globalThis.LukerDebugCapture;
        document.documentElement.classList.remove('luker-native-client');
        document.getElementById('debug-recording-indicator')?.remove();
    });

    async function loadModule() {
        return await import('../public/scripts/debug-menu-capture.js');
    }

    test('capture entries stay hidden when the bridge cannot capture', async () => {
        window.LukerAndroid = { exportDiagnosticsBundle: () => {} };

        const mod = await loadModule();
        mod.initDebugMenuCapture();

        expect(item('capture-heap').hidden).toBe(true);
        expect(item('toggle-perf-recording').hidden).toBe(true);
        expect(actions.has('capture-heap')).toBe(false);
    });

    test('a heap capture routes to the bridge and reports acceptance', async () => {
        const captureHeapSnapshot = jest.fn(() => true);
        window.LukerAndroid = { captureHeapSnapshot };

        const mod = await loadModule();
        mod.initDebugMenuCapture();

        expect(item('capture-heap').hidden).toBe(false);
        actions.get('capture-heap')();

        expect(captureHeapSnapshot).toHaveBeenCalledTimes(1);
        expect(toastr.success).toHaveBeenCalledTimes(1);
    });

    test('a second capture while one is in flight is refused', async () => {
        const captureHeapSnapshot = jest.fn(() => true);
        window.LukerAndroid = { captureHeapSnapshot };

        const mod = await loadModule();
        mod.initDebugMenuCapture();

        actions.get('capture-heap')();
        actions.get('capture-heap')();

        expect(captureHeapSnapshot).toHaveBeenCalledTimes(1);
        expect(toastr.warning).toHaveBeenCalledTimes(1);
    });

    test('the in-flight guard clears when the capture reports back', async () => {
        const captureHeapSnapshot = jest.fn(() => true);
        window.LukerAndroid = { captureHeapSnapshot };

        const mod = await loadModule();
        mod.initDebugMenuCapture();

        actions.get('capture-heap')();
        window.LukerDebugCapture.onCaptureReady('heap', {});
        actions.get('capture-heap')();

        expect(captureHeapSnapshot).toHaveBeenCalledTimes(2);
    });

    test('the recording entry takes its state from the bridge, not from memory', async () => {
        const isPerformanceTraceRecording = jest.fn(() => true);
        window.LukerAndroid = {
            startPerformanceTrace: jest.fn(),
            stopPerformanceTrace: jest.fn(),
            isPerformanceTraceRecording,
        };

        const mod = await loadModule();
        mod.initDebugMenuCapture();

        expect(isPerformanceTraceRecording).toHaveBeenCalled();
        expect(item('toggle-perf-recording').hidden).toBe(false);
        expect(item('toggle-perf-recording').textContent).toBe('Stop Performance Recording');
        expect(toggles).toContainEqual(['toggle-perf-recording', true]);
    });

    test('starting a recording flips the entry to the stop label', async () => {
        const startPerformanceTrace = jest.fn(() => true);
        window.LukerAndroid = {
            startPerformanceTrace,
            stopPerformanceTrace: jest.fn(() => true),
            isPerformanceTraceRecording: jest.fn(() => false),
        };

        const mod = await loadModule();
        mod.initDebugMenuCapture();

        expect(item('toggle-perf-recording').textContent).toBe('Start Performance Recording');

        actions.get('toggle-perf-recording')();

        expect(startPerformanceTrace).toHaveBeenCalledTimes(1);
        expect(item('toggle-perf-recording').textContent).toBe('Stop Performance Recording');
    });

    test('a native failure surfaces as an error toast carrying the reason', async () => {
        window.LukerAndroid = { captureHeapSnapshot: jest.fn(() => true) };

        const mod = await loadModule();
        mod.initDebugMenuCapture();

        actions.get('capture-heap')();
        window.LukerDebugCapture.onCaptureFailed('heap', 'renderer gone');

        expect(toastr.error).toHaveBeenCalledTimes(1);
        expect(String(toastr.error.mock.calls[0][0])).toContain('renderer gone');
    });

    test('a bridge that throws is reported, not swallowed', async () => {
        window.LukerAndroid = {
            captureHeapSnapshot: jest.fn(() => {
                throw new Error('bridge exploded');
            }),
        };

        const mod = await loadModule();
        mod.initDebugMenuCapture();

        actions.get('capture-heap')();

        expect(toastr.error).toHaveBeenCalledTimes(1);
    });

    test('the capture entries stay hidden when the server cannot capture', async () => {
        client.readCaptureStatus.mockResolvedValue({ available: false, recording: false, reason: 'no socket' });

        const mod = await loadModule();
        mod.initDebugMenuCapture();
        await flush();

        expect(item('capture-heap').hidden).toBe(true);
        expect(item('toggle-perf-recording').hidden).toBe(true);
        expect(actions.has('capture-heap')).toBe(false);
        expect(document.documentElement.classList.contains('luker-native-client')).toBe(false);
    });

    test('the capture entries appear when the server can capture', async () => {
        client.readCaptureStatus.mockResolvedValue({ available: true, recording: false, reason: null });

        const mod = await loadModule();
        mod.initDebugMenuCapture();
        await flush();

        expect(item('capture-heap').hidden).toBe(false);
        expect(item('toggle-perf-recording').hidden).toBe(false);
        expect(document.documentElement.classList.contains('luker-native-client')).toBe(true);
    });

    test('a server capture downloads the artifact the server produced', async () => {
        client.readCaptureStatus.mockResolvedValue({ available: true, recording: false, reason: null });
        client.requestHeapSnapshot.mockResolvedValue({ name: 'luker-heap-1.heapsnapshot', bytes: 12 });

        const mod = await loadModule();
        mod.initDebugMenuCapture();
        await flush();

        actions.get('capture-heap')();
        await flush();

        expect(client.downloadArtifact).toHaveBeenCalledWith('luker-heap-1.heapsnapshot');
        expect(toastr.success).toHaveBeenCalledTimes(1);
    });

    test('a server capture failure surfaces the server message', async () => {
        client.readCaptureStatus.mockResolvedValue({ available: true, recording: false, reason: null });
        client.requestHeapSnapshot.mockRejectedValue(new Error('renderer-capture: no local page target'));

        const mod = await loadModule();
        mod.initDebugMenuCapture();
        await flush();

        actions.get('capture-heap')();
        await flush();

        expect(client.downloadArtifact).not.toHaveBeenCalled();
        expect(String(toastr.error.mock.calls[0][0])).toContain('no local page target');
    });

    test('a second server capture while one is in flight is refused', async () => {
        client.readCaptureStatus.mockResolvedValue({ available: true, recording: false, reason: null });
        client.requestHeapSnapshot.mockReturnValue(new Promise(() => {}));

        const mod = await loadModule();
        mod.initDebugMenuCapture();
        await flush();

        actions.get('capture-heap')();
        actions.get('capture-heap')();

        expect(client.requestHeapSnapshot).toHaveBeenCalledTimes(1);
        expect(toastr.warning).toHaveBeenCalledTimes(1);
    });

    test('starting a server recording flips the entry to the stop label', async () => {
        client.readCaptureStatus.mockResolvedValue({ available: true, recording: false, reason: null });
        client.requestTraceStart.mockResolvedValue({ name: 'luker-trace-1.json' });

        const mod = await loadModule();
        mod.initDebugMenuCapture();
        await flush();

        expect(item('toggle-perf-recording').textContent).toBe('Start Performance Recording');

        actions.get('toggle-perf-recording')();
        await flush();

        expect(client.requestTraceStart).toHaveBeenCalledTimes(1);
        expect(item('toggle-perf-recording').textContent).toBe('Stop Performance Recording');
        expect(document.getElementById('debug-recording-indicator')).not.toBeNull();
    });

    test('stopping a server recording downloads the trace', async () => {
        client.readCaptureStatus.mockResolvedValue({ available: true, recording: true, reason: null });
        client.requestTraceStop.mockResolvedValue({ name: 'luker-trace-2.json', bytes: 34 });

        const mod = await loadModule();
        mod.initDebugMenuCapture();
        await flush();

        expect(item('toggle-perf-recording').textContent).toBe('Stop Performance Recording');

        actions.get('toggle-perf-recording')();
        await flush();

        expect(client.requestTraceStop).toHaveBeenCalledTimes(1);
        expect(client.downloadArtifact).toHaveBeenCalledWith('luker-trace-2.json');
        expect(item('toggle-perf-recording').textContent).toBe('Start Performance Recording');
        expect(document.getElementById('debug-recording-indicator')).toBeNull();
    });

    test('a server recording toggle failure surfaces the server message', async () => {
        client.readCaptureStatus.mockResolvedValue({ available: true, recording: false, reason: null });
        client.requestTraceStart.mockRejectedValue(new Error('renderer-capture: a recording is already running'));

        const mod = await loadModule();
        mod.initDebugMenuCapture();
        await flush();

        actions.get('toggle-perf-recording')();
        await flush();

        expect(String(toastr.error.mock.calls[0][0])).toContain('already running');
        expect(item('toggle-perf-recording').textContent).toBe('Start Performance Recording');
    });

    test('a native client marks the document so web-only entries can hide', async () => {
        window.LukerAndroid = { captureHeapSnapshot: jest.fn(() => true) };

        const mod = await loadModule();
        mod.initDebugMenuCapture();

        expect(document.documentElement.classList.contains('luker-native-client')).toBe(true);
    });

    test('a failed recording-state query is reported and the entry stays hidden', async () => {
        window.LukerAndroid = {
            startPerformanceTrace: jest.fn(),
            stopPerformanceTrace: jest.fn(),
            isPerformanceTraceRecording: jest.fn(() => {
                throw new Error('no state');
            }),
        };

        const mod = await loadModule();
        mod.initDebugMenuCapture();

        expect(item('toggle-perf-recording').hidden).toBe(true);
        expect(toastr.error).toHaveBeenCalledTimes(1);
    });

    test('a recording session keeps a visible indicator until it stops', async () => {
        window.LukerAndroid = {
            startPerformanceTrace: jest.fn(() => true),
            stopPerformanceTrace: jest.fn(() => true),
            isPerformanceTraceRecording: jest.fn(() => true),
        };

        const mod = await loadModule();
        mod.initDebugMenuCapture();

        expect(document.getElementById('debug-recording-indicator')).not.toBeNull();

        actions.get('toggle-perf-recording')();

        expect(document.getElementById('debug-recording-indicator')).toBeNull();
    });
});
