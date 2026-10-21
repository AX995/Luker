// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 FunnyCups (https://github.com/funnycups)

/**
 * Pure helpers controlling per-type extraction cadence and prompt assembly.
 *
 * Lives outside main.js so unit tests can import without dragging the whole
 * SillyTavern script.js / lib.js runtime in. main.js re-exports the
 * symbols for the public API surface.
 */

import { DEFAULT_PER_TYPE_INSTRUCTIONS as _DEFAULT_PER_TYPE_INSTRUCTIONS } from './default-prompts.js';

export const DEFAULT_PER_TYPE_INSTRUCTIONS = _DEFAULT_PER_TYPE_INSTRUCTIONS;

export function computeActiveExtractionTypes(schema, currentSeq) {
    const active = new Set();
    const seq = Math.max(0, Math.floor(Number.isFinite(Number(currentSeq)) ? Number(currentSeq) : 0));
    for (const entry of Array.isArray(schema) ? schema : []) {
        const typeId = String(entry?.id || '').trim().toLowerCase();
        if (!typeId) continue;
        if (entry?.forceUpdate) {
            active.add(typeId);
            continue;
        }
        const everyN = Math.max(1, Math.floor(Number(entry?.extractEveryN ?? 1)) || 1);
        if (seq % everyN === 0) {
            active.add(typeId);
        }
    }
    return active;
}

export const NODES_BLOCK_HEADING = '节点决策';
export const EDGES_BLOCK_HEADING = '边决策';

/**
 * Build the text the template's node marker receives: the heading, a blank
 * line, then one sub-block per active type in schema order. A sub-block is the
 * type's `extractionInstructions` under a program-generated sub-heading line
 * carrying the type id. A type that is not active, or whose instructions are
 * blank, contributes nothing; no sub-block at all yields an empty string.
 *
 * @param {Array<{ id?: string, extractionInstructions?: string }>} schema
 * @param {Set<string>} activeTypes
 * @returns {string}
 */
export function buildExtractionNodesBlock(schema, activeTypes) {
    const sections = [];
    const activeSet = activeTypes instanceof Set ? activeTypes : new Set();
    for (const entry of Array.isArray(schema) ? schema : []) {
        const typeId = String(entry?.id || '').trim().toLowerCase();
        if (!typeId || !activeSet.has(typeId)) continue;
        const instructions = String(entry?.extractionInstructions || '').trim();
        if (!instructions) continue;
        sections.push(`[${typeId}]\n${instructions}`);
    }
    if (sections.length === 0) return '';
    return `${NODES_BLOCK_HEADING}\n\n${sections.join('\n\n')}`;
}

/**
 * Build the text the template's edge marker receives: the heading, a blank
 * line, then the rules. Blank rules yield an empty string, heading included.
 *
 * @param {string} edgeRules
 * @returns {string}
 */
export function buildExtractionEdgesBlock(edgeRules) {
    const rules = String(edgeRules ?? '').trim();
    if (!rules) return '';
    return `${EDGES_BLOCK_HEADING}\n\n${rules}`;
}

/**
 * Build the `<round_nodes>` section naming the nodes this round created or
 * updated. The projected graph_data may not carry them — hierarchical types
 * fold their leaves and crawl mode hands over a bounded slice — so the edge
 * decision needs them listed here to use as link endpoints.
 *
 * A side that is not a non-empty array contributes an empty list; when both
 * sides are empty the section is an empty string, tags included.
 *
 * @param {{ created?: object[], updated?: object[] }|null|undefined} roundNodes
 * @returns {string}
 */
export function buildRoundNodesSection(roundNodes) {
    const created = Array.isArray(roundNodes?.created) ? roundNodes.created : [];
    const updated = Array.isArray(roundNodes?.updated) ? roundNodes.updated : [];
    if (created.length === 0 && updated.length === 0) return '';
    return [
        '  <input_guide>round_nodes lists the nodes created or updated in this batch; their ids are valid endpoints for links.</input_guide>',
        '  <round_nodes>',
        `    ${JSON.stringify({ created, updated })}`,
        '  </round_nodes>',
    ].join('\n');
}
