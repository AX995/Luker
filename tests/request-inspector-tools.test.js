// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from '@jest/globals';
import {
    normalizeWireTools,
    describeToolChoice,
    buildToolParamRows,
    countToolParams,
} from '../public/scripts/request-inspector-tools.js';

describe('normalizeWireTools: provider dialects', () => {
    test('OpenAI tools[].function shape', () => {
        const wr = {
            tools: [{
                type: 'function',
                function: {
                    name: 'get_weather',
                    description: 'Get the weather',
                    parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
                },
            }],
        };
        expect(normalizeWireTools(wr)).toEqual({
            tools: [{
                name: 'get_weather',
                description: 'Get the weather',
                parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
            }],
            toolChoice: null,
        });
    });

    test('Claude tools[].input_schema shape', () => {
        const wr = {
            tools: [{
                name: 'read_file',
                description: 'Read a file',
                input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
            }],
        };
        expect(normalizeWireTools(wr)).toEqual({
            tools: [{
                name: 'read_file',
                description: 'Read a file',
                parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
            }],
            toolChoice: null,
        });
    });

    test('Gemini functionDeclarations plus non-function custom tools', () => {
        const wr = {
            tools: [
                { functionDeclarations: [
                    { name: 'lookup', description: 'Look up', parameters: { type: 'OBJECT', properties: { q: { type: 'STRING' } } } },
                    { name: 'bare' },
                ] },
                { googleSearch: {} },
            ],
        };
        expect(normalizeWireTools(wr)).toEqual({
            tools: [
                { name: 'lookup', description: 'Look up', parameters: { type: 'OBJECT', properties: { q: { type: 'STRING' } } } },
                { name: 'bare', description: '', parameters: null },
                { name: 'googleSearch', description: '', parameters: null },
            ],
            toolChoice: null,
        });
    });

    test('OpenAI Responses flat tools shape', () => {
        const wr = {
            tools: [{
                type: 'function',
                name: 'web_search',
                description: 'Search the web',
                parameters: { type: 'object', properties: { q: { type: 'string' } } },
            }],
        };
        expect(normalizeWireTools(wr)).toEqual({
            tools: [{
                name: 'web_search',
                description: 'Search the web',
                parameters: { type: 'object', properties: { q: { type: 'string' } } },
            }],
            toolChoice: null,
        });
    });

    test('legacy functions[] shape', () => {
        const wr = {
            functions: [{ name: 'legacy', description: 'Old style', parameters: { type: 'object', properties: { a: { type: 'string' } } } }],
        };
        expect(normalizeWireTools(wr)).toEqual({
            tools: [{ name: 'legacy', description: 'Old style', parameters: { type: 'object', properties: { a: { type: 'string' } } } }],
            toolChoice: null,
        });
    });

    test('no tools present', () => {
        expect(normalizeWireTools({ messages: [] })).toEqual({ tools: [], toolChoice: null });
        expect(normalizeWireTools(null)).toEqual({ tools: [], toolChoice: null });
    });

    test('tool_choice is surfaced raw', () => {
        expect(normalizeWireTools({ tools: [], tool_choice: 'auto' }).toolChoice).toBe('auto');
        expect(normalizeWireTools({ tools: [], toolChoice: 'none' }).toolChoice).toBe('none');
    });
});

describe('describeToolChoice', () => {
    test('string values pass through', () => {
        expect(describeToolChoice('auto')).toBe('auto');
        expect(describeToolChoice('required')).toBe('required');
    });

    test('OpenAI object form names the function', () => {
        expect(describeToolChoice({ type: 'function', function: { name: 'get_weather' } })).toBe('function: get_weather');
    });

    test('Claude object forms', () => {
        expect(describeToolChoice({ type: 'auto' })).toBe('auto');
        expect(describeToolChoice({ type: 'any' })).toBe('any');
        expect(describeToolChoice({ type: 'tool', name: 'read_file' })).toBe('tool: read_file');
    });

    test('null and undefined produce null', () => {
        expect(describeToolChoice(null)).toBeNull();
        expect(describeToolChoice(undefined)).toBeNull();
    });
});

describe('buildToolParamRows', () => {
    test('flattens top-level params and marks required', () => {
        const rows = buildToolParamRows({
            type: 'object',
            properties: {
                path: { type: 'string', description: 'File path' },
                offset: { type: 'integer' },
            },
            required: ['path'],
        });
        expect(rows).toEqual([
            { name: 'path', type: 'string', required: true, description: 'File path', depth: 0 },
            { name: 'offset', type: 'integer', required: false, description: '', depth: 0 },
        ]);
    });

    test('recurses into nested object properties', () => {
        const rows = buildToolParamRows({
            type: 'object',
            properties: {
                opts: { type: 'object', properties: { deep: { type: 'integer', description: 'Deep' } } },
            },
        });
        expect(rows).toEqual([
            { name: 'opts', type: 'object', required: false, description: '', depth: 0 },
            { name: 'deep', type: 'integer', required: false, description: 'Deep', depth: 1 },
        ]);
    });

    test('recurses into array-of-object items', () => {
        const rows = buildToolParamRows({
            type: 'object',
            properties: {
                items: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' } } } },
            },
        });
        expect(rows).toEqual([
            { name: 'items', type: 'array', required: false, description: '', depth: 0 },
            { name: 'id', type: 'string', required: false, description: '', depth: 1 },
        ]);
    });

    test('normalizes uppercase provider types and array types', () => {
        const rows = buildToolParamRows({
            type: 'OBJECT',
            properties: {
                q: { type: 'STRING' },
                mode: { type: ['string', 'null'] },
                list: { type: 'ARRAY', items: { type: 'STRING' } },
            },
        });
        expect(rows.map(r => r.type)).toEqual(['string', 'string | null', 'array']);
    });

    test('missing or empty schema yields no rows', () => {
        expect(buildToolParamRows(null)).toEqual([]);
        expect(buildToolParamRows({})).toEqual([]);
        expect(buildToolParamRows({ type: 'object' })).toEqual([]);
    });
});

describe('countToolParams', () => {
    test('counts top-level properties', () => {
        expect(countToolParams({ type: 'object', properties: { a: {}, b: {}, c: {} } })).toBe(3);
    });

    test('zero when absent', () => {
        expect(countToolParams(null)).toBe(0);
        expect(countToolParams({ type: 'object' })).toBe(0);
    });
});
