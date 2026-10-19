// A real HTTP stand-in for the release host the updater queries. It answers
// the two routes the delivery path touches — the "latest release" lookup and
// the asset download — so a desktop e2e run can drive the update flow without a
// live network. This mocks an external service, not the code under test: the
// backend still fetches over real sockets and the shell still downloads the
// bytes.
//
// Asset `url` values may be absolute or root-relative; a relative one is
// resolved against the stub's own origin, so a run can name the download
// route without knowing the port before the stub starts.

import http from 'node:http';

/**
 * @param {object} [options]
 * @param {string} [options.tag]  Release tag the lookup reports.
 * @param {Array<{ name: string, url: string, size?: number }>} [options.assets]
 * @param {string} [options.assetBody]  Bytes every asset download returns.
 * @param {number} [options.assetStatus]  Status for asset downloads; 200 by default.
 * @param {number} [options.releaseStatus]  Status for the release lookup; 200 by default.
 * @returns {Promise<{ baseURL: string, requests: Array<{ method: string, path: string }>, setAssetStatus: (status: number) => void, stop: () => Promise<void> }>}
 */
export async function startReleaseStub({
    tag = '9.9.9',
    assets = [],
    assetBody = '<bytes>',
    assetStatus = 200,
    releaseStatus = 200,
} = {}) {
    const requests = [];
    let currentAssetStatus = assetStatus;
    let origin = '';

    const server = http.createServer((request, response) => {
        const url = new URL(request.url, 'http://127.0.0.1');
        requests.push({ method: request.method, path: url.pathname });

        if (/^\/repos\/[^/]+\/[^/]+\/releases\/latest$/.test(url.pathname)) {
            if (releaseStatus !== 200) {
                response.writeHead(releaseStatus, { 'content-type': 'application/json' });
                response.end(JSON.stringify({ message: 'release lookup failed' }));
                return;
            }
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(JSON.stringify({
                tag_name: tag,
                name: `Luker ${tag}`,
                html_url: `${origin}/releases/tag/${tag}`,
                published_at: '2026-01-01T00:00:00Z',
                assets: assets.map(asset => ({
                    name: asset.name,
                    size: asset.size ?? 0,
                    browser_download_url: /^https?:/i.test(asset.url) ? asset.url : `${origin}${asset.url}`,
                })),
            }));
            return;
        }

        if (url.pathname.startsWith('/download/')) {
            if (currentAssetStatus !== 200) {
                response.writeHead(currentAssetStatus, { 'content-type': 'text/plain' });
                response.end('asset download failed');
                return;
            }
            response.writeHead(200, {
                'content-type': 'application/octet-stream',
                'content-length': Buffer.byteLength(assetBody),
            });
            response.end(assetBody);
            return;
        }

        response.writeHead(404, { 'content-type': 'text/plain' });
        response.end('not found');
    });

    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    origin = `http://127.0.0.1:${server.address().port}`;

    return {
        baseURL: origin,
        requests,
        setAssetStatus(status) {
            currentAssetStatus = status;
        },
        stop: () => new Promise((resolve) => server.close(() => resolve())),
    };
}
