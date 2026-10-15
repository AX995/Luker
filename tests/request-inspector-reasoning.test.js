// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from '@jest/globals';
import {
    extractMessageReasoning,
    renderReasoningItem,
} from '../public/scripts/request-inspector-reasoning.js';

// Minimal i18n tag stand-in: joins the template parts, interpolating values.
const t = (parts, ...values) => parts.reduce((acc, s, i) => acc + s + (i < values.length ? String(values[i]) : ''), '');

describe('extractMessageReasoning: duplicate-channel suppression', () => {
    test('drops the plain reasoning string when reasoning_details carry the same text', () => {
        const items = extractMessageReasoning({
            reasoning: 'dup',
            reasoning_details: [
                { type: 'reasoning.text', text: 'du' },
                { type: 'reasoning.text', text: 'p' },
            ],
        });
        expect(items).toEqual([
            {
                kind: 'details',
                details: [
                    { type: 'reasoning.text', text: 'du' },
                    { type: 'reasoning.text', text: 'p' },
                ],
                source: 'reasoning_details',
            },
        ]);
    });

    test('keeps the reasoning string when details carry different text', () => {
        const items = extractMessageReasoning({
            reasoning: 'other',
            reasoning_details: [{ type: 'reasoning.text', text: 'dup' }],
        });
        expect(items).toEqual([
            { kind: 'text', text: 'other', source: 'reasoning' },
            { kind: 'details', details: [{ type: 'reasoning.text', text: 'dup' }], source: 'reasoning_details' },
        ]);
    });

    test('keeps the reasoning string when details have no readable text', () => {
        const items = extractMessageReasoning({
            reasoning_content: 'plain',
            reasoning_details: [{ type: 'reasoning.encrypted', id: 'rs_1', data: 'blob' }],
        });
        expect(items).toEqual([
            { kind: 'text', text: 'plain', source: 'reasoning_content' },
            { kind: 'details', details: [{ type: 'reasoning.encrypted', id: 'rs_1', data: 'blob' }], source: 'reasoning_details' },
        ]);
    });

    test('reasoning string without details stays untouched', () => {
        expect(extractMessageReasoning({ reasoning: 'solo' })).toEqual([
            { kind: 'text', text: 'solo', source: 'reasoning' },
        ]);
    });
});

describe('renderReasoningItem: details entry bodies', () => {
    const item = (details) => ({ kind: 'details', details, source: 'reasoning_details' });

    test('renders the text body of reasoning.text entries', () => {
        const html = renderReasoningItem(
            item([{ type: 'reasoning.text', text: 'Let me think.', format: 'anthropic-claude-v1', index: 0 }]),
            '',
            t,
        );
        expect(html).toContain('Let me think.');
        expect(html).toContain('ri-reasoning-body');
        expect(html).toContain('reasoning.text');
        expect(html).toContain('anthropic-claude-v1');
    });

    test('renders the summary body of reasoning.summary entries', () => {
        const html = renderReasoningItem(
            item([{ type: 'reasoning.summary', summary: 'condensed thought', format: 'openai-responses-v1' }]),
            '',
            t,
        );
        expect(html).toContain('condensed thought');
    });

    test('renders the signature of entries that carry one', () => {
        const html = renderReasoningItem(
            item([{ type: 'reasoning.text', text: 'x', signature: 'sig-abc' }]),
            '',
            t,
        );
        expect(html).toContain('sig-abc');
        expect(html).toContain('ri-reasoning-sig-row');
    });

    test('renders encrypted data payloads and their id chip', () => {
        const html = renderReasoningItem(
            item([{ type: 'reasoning.encrypted', id: 'rs_1', data: 'gAAAA-blob' }]),
            '',
            t,
        );
        expect(html).toContain('gAAAA-blob');
        expect(html).toContain('rs_1');
    });

    test('escapes body content', () => {
        const html = renderReasoningItem(
            item([{ type: 'reasoning.text', text: '<b>&"x"' }]),
            '',
            t,
        );
        expect(html).toContain('&lt;b&gt;&amp;');
        expect(html).not.toContain('<b>');
    });
});
