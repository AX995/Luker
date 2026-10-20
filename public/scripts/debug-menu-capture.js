/**
 * Client-only entries of the diagnostics menu.
 *
 * Both entries appear only where the native bridge can actually capture, so a
 * browser or an app build without the capture bridge never shows a dead
 * control. The bridge methods return as soon as the request is accepted; the
 * work runs on a native worker thread and reports back through
 * `window.LukerDebugCapture`.
 */
import { registerDebugMenuAction, setDebugMenuToggleState } from './debug-export.js';
import { translate } from './i18n.js';

const HEAP_ACTION = 'capture-heap';
const RECORDING_ACTION = 'toggle-perf-recording';

const START_LABEL = 'Start Performance Recording';
const STOP_LABEL = 'Stop Performance Recording';
const RECORDING_INDICATOR = 'Recording performance';

let heapCaptureInFlight = false;

function getBridge() {
    if (typeof window === 'undefined') {
        return null;
    }
    return window.LukerAndroid ?? window.LukerHarmony ?? null;
}

function getItem(action) {
    return document.querySelector(`#debug-menu-list [data-debug-action="${action}"]`);
}

function setItemVisible(action, visible) {
    const item = getItem(action);
    if (item) {
        item.hidden = !visible;
    }
}

function isRecording() {
    const bridge = getBridge();
    if (!bridge || typeof bridge.isPerformanceTraceRecording !== 'function') {
        return false;
    }
    return !!bridge.isPerformanceTraceRecording();
}

function renderRecordingIndicator(recording) {
    const existing = document.getElementById('debug-recording-indicator');

    if (!recording) {
        if (existing) {
            existing.remove();
        }
        return;
    }

    if (existing) {
        return;
    }

    const indicator = document.createElement('div');
    indicator.id = 'debug-recording-indicator';
    indicator.setAttribute('role', 'status');
    indicator.dataset.i18n = RECORDING_INDICATOR;
    indicator.textContent = translate(RECORDING_INDICATOR);
    document.body.appendChild(indicator);
}

function renderRecordingState(recording) {
    const item = getItem(RECORDING_ACTION);
    const label = recording ? STOP_LABEL : START_LABEL;
    if (item) {
        item.dataset.i18n = label;
        item.textContent = translate(label);
    }
    setDebugMenuToggleState(RECORDING_ACTION, recording);
    renderRecordingIndicator(recording);
}

function captureHeapSnapshot() {
    const bridge = getBridge();
    if (!bridge || typeof bridge.captureHeapSnapshot !== 'function') {
        return;
    }
    if (heapCaptureInFlight) {
        toastr.warning(translate('A capture is already running.'), translate('Diagnostics'));
        return;
    }
    try {
        if (bridge.captureHeapSnapshot() === false) {
            toastr.error(translate('Failed to start the capture.'), translate('Diagnostics'));
            return;
        }
        heapCaptureInFlight = true;
        toastr.success(translate('Capture started. The file is saved when it finishes.'), translate('Diagnostics'));
    } catch (error) {
        console.error('[debug-menu-capture] heap capture failed', error);
        toastr.error(translate('Failed to start the capture.'), translate('Diagnostics'));
    }
}

function togglePerformanceTrace() {
    const bridge = getBridge();
    if (!bridge) {
        return;
    }

    try {
        const recording = isRecording();
        const method = recording ? 'stopPerformanceTrace' : 'startPerformanceTrace';
        if (typeof bridge[method] !== 'function') {
            return;
        }

        if (bridge[method]() === false) {
            toastr.error(translate('Failed to change the recording state.'), translate('Diagnostics'));
            return;
        }
        renderRecordingState(!recording);
        toastr.success(
            recording ? translate('Performance recording stopped.') : translate('Performance recording started.'),
            translate('Diagnostics'),
        );
    } catch (error) {
        console.error('[debug-menu-capture] trace toggle failed', error);
        toastr.error(translate('Failed to change the recording state.'), translate('Diagnostics'));
    }
}

function onCaptureReady(kind) {
    if (kind === 'heap') {
        heapCaptureInFlight = false;
    }
    toastr.success(translate('The capture is ready.'), translate('Diagnostics'));
}

function onCaptureFailed(kind, message) {
    if (kind === 'heap') {
        heapCaptureInFlight = false;
    }
    toastr.error(message || translate('The capture failed.'), translate('Diagnostics'));
}

/**
 * Reveal and wire whichever capture entries the native bridge supports.
 */
export function initDebugMenuCapture() {
    const bridge = getBridge();

    if (bridge) {
        document.documentElement.classList.add('luker-native-client');
    }

    if (!bridge) {
        return;
    }

    if (typeof bridge.captureHeapSnapshot === 'function') {
        setItemVisible(HEAP_ACTION, true);
        registerDebugMenuAction(HEAP_ACTION, captureHeapSnapshot);
    }

    if (typeof bridge.startPerformanceTrace === 'function'
        && typeof bridge.stopPerformanceTrace === 'function'
        && typeof bridge.isPerformanceTraceRecording === 'function') {
        setItemVisible(RECORDING_ACTION, true);
        registerDebugMenuAction(RECORDING_ACTION, togglePerformanceTrace);
        try {
            renderRecordingState(isRecording());
        } catch (error) {
            console.error('[debug-menu-capture] recording state query failed', error);
            toastr.error(translate('Failed to read the recording state.'), translate('Diagnostics'));
            setItemVisible(RECORDING_ACTION, false);
        }
    }

    window.LukerDebugCapture = { onCaptureReady, onCaptureFailed };
}
