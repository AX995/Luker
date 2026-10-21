import { describe, test, expect } from '@jest/globals';

import { buildRoundNodesSection } from '../../public/scripts/extensions/memory-graph/extraction-schedule.js';

describe('buildRoundNodesSection', () => {
    test('no nodes yields no section', () => {
        expect(buildRoundNodesSection({ created: [], updated: [] })).toBe('');
        expect(buildRoundNodesSection({})).toBe('');
        expect(buildRoundNodesSection(null)).toBe('');
        expect(buildRoundNodesSection(undefined)).toBe('');
        expect(buildRoundNodesSection({ created: 'n_1', updated: 3 })).toBe('');
    });

    test('created precede updated and both carry their rows', () => {
        const out = buildRoundNodesSection({
            created: [{ id: 'n_9', type: 'event', title: 'Ambush' }],
            updated: [{ id: 'n_3', type: 'character_sheet', title: 'Eileen' }],
        });
        expect(out).toContain('<round_nodes>');
        expect(out).toContain('</round_nodes>');
        expect(out).toContain('"created"');
        expect(out).toContain('"updated"');
        expect(out.indexOf('n_9')).toBeLessThan(out.indexOf('n_3'));
    });

    test('one side empty still emits that side as an empty list', () => {
        const out = buildRoundNodesSection({ created: [{ id: 'n_1' }], updated: [] });
        expect(out).toContain('"created"');
        expect(out).toContain('"updated":[]');
    });

    test('the payload line matches the graph_data section line shape', () => {
        const out = buildRoundNodesSection({ created: [{ id: 'n_1' }], updated: [] });
        const lines = out.split('\n');
        const openIndex = lines.indexOf('  <round_nodes>');
        expect(openIndex).toBeGreaterThanOrEqual(0);
        expect(lines[openIndex + 1]).toBe(`    ${JSON.stringify({ created: [{ id: 'n_1' }], updated: [] })}`);
        expect(lines[openIndex + 2]).toBe('  </round_nodes>');
        expect(out.indexOf('<input_guide>')).toBeLessThan(out.indexOf('<round_nodes>'));
    });
});
