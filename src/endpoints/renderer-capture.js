/**
 * On-demand capture of the renderer behind the webview.
 *
 * Admin-only: a heap snapshot carries the whole page's JavaScript state, so a
 * secondary account must not be able to trigger one.
 */
import { statSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import {
    captureDir,
    captureHeapSnapshot,
    isTraceRecording,
    probeCapture,
    removeArtifact,
    startTrace,
    stopTrace,
} from '../renderer-capture/index.js';

/**
 * @param {{ isAdmin: (request: import('express').Request) => boolean }} options
 */
export function createRendererCaptureRouter({ isAdmin }) {
    if (typeof isAdmin !== 'function') {
        throw new Error('renderer-capture: an isAdmin predicate is required');
    }

    const router = express.Router();

    router.use((request, response, next) => {
        if (!isAdmin(request)) {
            response.status(403).json({ error: 'admin only' });
            return;
        }
        next();
    });

    router.get('/status', async (_request, response) => {
        const probe = await probeCapture();
        response.json({ ...probe, recording: isTraceRecording() });
    });

    router.post('/heap', async (_request, response) => {
        try {
            response.json(await captureHeapSnapshot());
        } catch (error) {
            response.status(500).json({ error: error.message });
        }
    });

    router.post('/trace/start', async (_request, response) => {
        if (isTraceRecording()) {
            response.status(409).json({ error: 'a recording is already running' });
            return;
        }

        try {
            response.json(await startTrace());
        } catch (error) {
            response.status(500).json({ error: error.message });
        }
    });

    router.post('/trace/stop', async (_request, response) => {
        if (!isTraceRecording()) {
            response.status(409).json({ error: 'no recording is running' });
            return;
        }

        try {
            response.json(await stopTrace());
        } catch (error) {
            response.status(500).json({ error: error.message });
        }
    });

    router.get('/artifact/:name', (request, response) => {
        const { name } = request.params;
        const directory = path.resolve(captureDir());
        const file = path.resolve(directory, name);

        // The name has to land directly inside the capture directory. Anything
        // that resolves to a parent, to the directory itself, or to a nested
        // path is not an artifact this route serves.
        if (path.dirname(file) !== directory) {
            response.status(400).json({ error: 'invalid artifact name' });
            return;
        }

        let stat = null;
        try {
            stat = statSync(file);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }

        // A directory is not a capture artifact, and handing one to the
        // downloader would leave the cleanup below removing a directory.
        if (!stat || !stat.isFile()) {
            response.status(404).json({ error: 'artifact not found' });
            return;
        }

        response.download(file, name, (error) => {
            removeArtifact(name);
            if (error && !response.headersSent) {
                response.status(500).json({ error: error.message });
            }
        });
    });

    return router;
}
