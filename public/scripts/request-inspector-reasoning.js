/**
 * Pure helpers for the Request Inspector's reasoning blocks.
 *
 * Split out of `request-inspector.js` so the wire-shape → item and item →
 * HTML mappings can be unit-tested under the node test environment (same
 * approach as `request-inspector-tools.js`). DOM-free: escaping and
 * search-highlighting are plain string operations, and the i18n tag function
 * is passed in by the rendering layer.
 */

import { joinReasoningDetailsText } from './util/reasoning-details.js';

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Escape HTML then highlight substring matches of `query` (case-insensitive)
 * by wrapping them in <mark class="ri-hl">.
 */
function highlightHtml(text, query) {
    const safe = escapeHtml(text);
    const q = (query || '').trim();
    if (!q) return safe;
    const safeQ = escapeHtml(q);
    if (!safeQ) return safe;
    const re = new RegExp(escapeRegex(safeQ), 'gi');
    return safe.replace(re, m => `<mark class="ri-hl">${m}</mark>`);
}

/**
 * Collect reasoning artifacts (thinking blocks, encrypted signatures, plain
 * reasoning text) attached to a message across every provider dialect Luker
 * touches. Returns a flat ordered list so the UI can render each item with a
 * dedicated block style, replacing the raw-JSON fallback for opaque payloads.
 *
 * Supported inputs:
 *   - Claude request side: assistant `content` array containing
 *     `{type:'thinking',thinking,signature}` / `{type:'redacted_thinking',data}`
 *   - Server-normalized OpenAI-shape: `message.reasoning_content` /
 *     `message.reasoning` (plain text) and `message.reasoning_blocks`
 *     (Anthropic-native array) and `message.reasoning_details` (OpenRouter
 *     opaque encrypted array). Top-level `message.signature` is captured too.
 *
 * Dual-channel messages carry the same thinking as both a plain string and a
 * `reasoning_details` array; the string is dropped when the details already
 * carry it, so the UI never shows the same reasoning twice.
 */
export function extractMessageReasoning(msg) {
    const items = [];
    if (msg && typeof msg === 'object') {
        if (typeof msg.reasoning_content === 'string' && msg.reasoning_content) {
            items.push({ kind: 'text', text: msg.reasoning_content, source: 'reasoning_content' });
        }
        if (typeof msg.reasoning === 'string' && msg.reasoning) {
            items.push({ kind: 'text', text: msg.reasoning, source: 'reasoning' });
        }
        if (Array.isArray(msg.reasoning_blocks)) {
            for (const b of msg.reasoning_blocks) {
                if (b?.type === 'thinking') {
                    items.push({ kind: 'thinking', text: b.thinking || '', signature: b.signature || '', source: 'reasoning_blocks' });
                } else if (b?.type === 'redacted_thinking') {
                    items.push({ kind: 'redacted_thinking', data: b.data || '', source: 'reasoning_blocks' });
                }
            }
        }
        if (Array.isArray(msg.reasoning_details) && msg.reasoning_details.length) {
            items.push({ kind: 'details', details: msg.reasoning_details, source: 'reasoning_details' });
        }
        if (typeof msg.signature === 'string' && msg.signature) {
            items.push({ kind: 'signature', signature: msg.signature, source: 'signature' });
        }
        if (Array.isArray(msg.content)) {
            for (const p of msg.content) {
                if (p?.type === 'thinking') {
                    items.push({ kind: 'thinking', text: p.thinking || '', signature: p.signature || '', source: 'content_block' });
                } else if (p?.type === 'redacted_thinking') {
                    items.push({ kind: 'redacted_thinking', data: p.data || '', source: 'content_block' });
                }
            }
        }
    }
    if (Array.isArray(msg?.reasoning_details) && msg.reasoning_details.length) {
        const covered = joinReasoningDetailsText(msg.reasoning_details);
        if (covered) {
            return items.filter(it => !(it.kind === 'text' && it.text === covered));
        }
    }
    return items;
}

/**
 * Render a single reasoning artifact into the Inspector's styled block.
 * Kept consistent with tool_call rendering: badge header + monospace body,
 * folded inside a <details> so long payloads don't dominate the panel.
 * @param {object} item
 * @param {string} q search query for highlighting
 * @param {(parts: TemplateStringsArray, ...values: unknown[]) => string} t i18n tag
 */
export function renderReasoningItem(item, q, t) {
    if (!item) return '';
    const kind = String(item.kind || '');
    let badge = t`Reasoning`;
    let bodyHtml = '';
    let extraMeta = '';

    if (kind === 'thinking') {
        badge = t`Thinking`;
        const textPart = item.text
            ? `<pre class="ri-reasoning-body">${highlightHtml(item.text, q)}</pre>`
            : `<div class="ri-reasoning-empty">${escapeHtml(t`(empty thinking body)`)}</div>`;
        const sigPart = item.signature
            ? `<div class="ri-reasoning-sig-row"><span class="ri-reasoning-sig-label">${escapeHtml(t`Signature`)}</span><code class="ri-reasoning-sig">${escapeHtml(item.signature)}</code></div>`
            : '';
        bodyHtml = textPart + sigPart;
    } else if (kind === 'redacted_thinking') {
        badge = t`Redacted Thinking`;
        bodyHtml = `<div class="ri-reasoning-sig-row"><span class="ri-reasoning-sig-label">${escapeHtml(t`Data`)}</span><code class="ri-reasoning-sig">${escapeHtml(item.data || '')}</code></div>`;
    } else if (kind === 'text') {
        badge = t`Reasoning`;
        if (item.source === 'reasoning_content') extraMeta = 'reasoning_content';
        else if (item.source === 'reasoning') extraMeta = 'reasoning';
        bodyHtml = `<pre class="ri-reasoning-body">${highlightHtml(item.text || '', q)}</pre>`;
    } else if (kind === 'details') {
        badge = t`Reasoning Details`;
        const entryCount = item.details?.length || 0;
        extraMeta = `${entryCount} ${entryCount === 1 ? t`entry` : t`entries`}`;
        const rows = [];
        for (const d of (item.details || [])) {
            const type = d?.type || '?';
            const id = d?.id ? `<span class="ri-tool-call-id" title="${escapeHtml(d.id)}">${escapeHtml(d.id)}</span>` : '';
            const format = d?.format ? `<span class="ri-reasoning-detail-format">${escapeHtml(d.format)}</span>` : '';
            const text = typeof d?.text === 'string' ? d.text : '';
            const summary = typeof d?.summary === 'string' ? d.summary : '';
            const body = text || summary;
            const bodyRow = body ? `<pre class="ri-reasoning-body">${highlightHtml(body, q)}</pre>` : '';
            const signature = typeof d?.signature === 'string' ? d.signature : '';
            const sigRow = signature
                ? `<div class="ri-reasoning-sig-row"><span class="ri-reasoning-sig-label">${escapeHtml(t`Signature`)}</span><code class="ri-reasoning-sig">${escapeHtml(signature)}</code></div>`
                : '';
            const data = typeof d?.data === 'string' ? d.data : '';
            const dataRow = data ? `<code class="ri-reasoning-sig">${escapeHtml(data)}</code>` : '';
            rows.push(`
 <div class="ri-reasoning-detail-row">
 <div class="ri-reasoning-detail-header">
 <span class="ri-reasoning-detail-type">${escapeHtml(type)}</span>
 ${format}
 ${id}
 </div>
 ${bodyRow}
 ${sigRow}
 ${dataRow}
 </div>`);
        }
        bodyHtml = rows.join('\n') || `<div class="ri-reasoning-empty">${escapeHtml(t`(no entries)`)}</div>`;
    } else if (kind === 'signature') {
        badge = t`Signature`;
        bodyHtml = `<div class="ri-reasoning-sig-row"><code class="ri-reasoning-sig">${escapeHtml(item.signature || '')}</code></div>`;
    } else {
        badge = kind;
        bodyHtml = `<pre class="ri-reasoning-body">${escapeHtml(JSON.stringify(item, null, 2))}</pre>`;
    }

    const sourceLabel = item.source ? `<span class="ri-reasoning-source">${escapeHtml(item.source)}</span>` : '';
    const metaLabel = extraMeta ? `<span class="ri-reasoning-meta">${escapeHtml(extraMeta)}</span>` : '';
    return `
 <details class="ri-reasoning" open>
 <summary class="ri-reasoning-header">
 <span class="ri-reasoning-badge">${escapeHtml(badge)}</span>
 ${sourceLabel}
 ${metaLabel}
 </summary>
 <div class="ri-reasoning-body-wrap">${bodyHtml}</div>
 </details>`;
}

export function renderReasoningItems(items, q, t) {
    if (!Array.isArray(items) || !items.length) return '';
    return items.map(it => renderReasoningItem(it, q, t)).join('\n');
}
