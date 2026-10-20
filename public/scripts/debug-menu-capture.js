/**
 * Client-only entries of the diagnostics menu.
 *
 * Both entries appear only where a capture can actually run, so a browser or
 * an app build without a capture path never shows a dead control. Two backends
 * exist: the Android bridge, whose methods return as soon as the request is
 * accepted and report back through `window.LukerDebugCapture`, and the
 * server-side endpoints that the HarmonyOS build drives over same-origin HTTP.
 */
import { registerDebugMenuAction, setDebugMenuToggleState } from './debug-export.js';
import { translate } from './i18n.js';
import { downloadArtifact, readCaptureStatus, requestHeapSnapshot, requestTraceStart, requestTraceStop } from './renderer-capture-client.js';

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
    return window.LukerAndroid ?? null;
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

function captureHeapSnapshotOnServer() {
    if (heapCaptureInFlight) {
        toastr.warning(translate('A capture is already running.'), translate('Diagnostics'));
        return;
    }

    heapCaptureInFlight = true;
    requestHeapSnapshot()
        .then((result) => {
            downloadArtifact(result.name);
            toastr.success(translate('The capture is ready.'), translate('Diagnostics'));
        })
        .catch((error) => {
            console.error('[debug-menu-capture] heap capture failed', error);
            toastr.error(error.message, translate('Diagnostics'));
        })
        .finally(() => {
            heapCaptureInFlight = false;
        });
}

function togglePerformanceTraceOnServer() {
    // The server owns the session, so read the current state instead of
    // trusting the label the page last rendered.
    readCaptureStatus()
        .then((status) => {
            const recording = !!status.recording;
            const request = recording ? requestTraceStop() : requestTraceStart();
            return request.then((result) => ({ recording, result }));
        })
        .then(({ recording, result }) => {
            renderRecordingState(!recording);
            if (recording) {
                downloadArtifact(result.name);
            }
            toastr.success(
                recording ? translate('Performance recording stopped.') : translate('Performance recording started.'),
                translate('Diagnostics'),
            );
        })
        .catch((error) => {
            console.error('[debug-menu-capture] trace toggle failed', error);
            toastr.error(error.message, translate('Diagnostics'));
        });
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

function initBridgeCapture(bridge) {
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

function initServerCapture() {
    readCaptureStatus()
        .then((status) => {
            if (!status.available) {
                console.debug('[debug-menu-capture] renderer capture unavailable', status.reason);
                return;
            }

            document.documentElement.classList.add('luker-native-client');
            setItemVisible(HEAP_ACTION, true);
            registerDebugMenuAction(HEAP_ACTION, captureHeapSnapshotOnServer);
            setItemVisible(RECORDING_ACTION, true);
            registerDebugMenuAction(RECORDING_ACTION, togglePerformanceTraceOnServer);
            renderRecordingState(!!status.recording);
        })
        .catch((error) => {
            console.error('[debug-menu-capture] renderer capture probe failed', error);
        });
}

/**
 * Reveal and wire whichever capture entries this build supports.
 */
export function initDebugMenuCapture() {
    const bridge = getBridge();

    if (bridge) {
        document.documentElement.classList.add('luker-native-client');
        initBridgeCapture(bridge);
        return;
    }

    initServerCapture();
}
