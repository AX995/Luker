// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 FunnyCups (https://github.com/funnycups)

/**
 * Pure helpers rendering the extraction request from its template.
 *
 * The extraction prompt is one editable template carrying the fixed text and
 * two markers. `{{nodes}}` receives the active types' rules, `{{edges}}`
 * receives the edge rules; each block carries its own program-generated
 * heading, so a block with no content leaves nothing behind, heading included.
 * The template's fixed text holds the role statement, the scope isolation, the
 * output contract, the prohibition list and the thought block.
 *
 * Lives outside main.js so unit tests can import without dragging the whole
 * SillyTavern script.js / lib.js runtime in.
 */

import {
    DEFAULT_EXTRACT_EDGE_RULES,
    DEFAULT_EXTRACT_TEMPLATE,
} from './default-prompts.js';

export const NODES_BLOCK_MARKER = '{{nodes}}';
export const EDGES_BLOCK_MARKER = '{{edges}}';

/**
 * Render the extraction template, replacing each marker it carries with its
 * block. Splitting on the marker rather than matching a regular expression
 * keeps metacharacters in the template text literal. An empty block replaces
 * its marker with nothing, and a marker the template does not carry inserts
 * nothing.
 *
 * @param {string} template
 * @param {{ nodesBlock?: string, edgesBlock?: string }} [blocks]
 * @returns {string}
 */
export function renderExtractionTemplate(template, { nodesBlock = '', edgesBlock = '' } = {}) {
    return String(template ?? '')
        .split(NODES_BLOCK_MARKER).join(String(nodesBlock ?? ''))
        .split(EDGES_BLOCK_MARKER).join(String(edgesBlock ?? ''));
}

/**
 * Resolve the template settings into the template text and the edge rules.
 * Each slot falls back to its code constant when empty, so a user who never
 * edited it picks up later constant changes without touching settings.
 *
 * @param {{ extractTemplate?: string, extractEdgeRules?: string }} settings
 * @returns {{ template: string, edgeRules: string }}
 */
export function resolveExtractionTemplate(settings = {}) {
    return {
        template: settings?.extractTemplate || DEFAULT_EXTRACT_TEMPLATE,
        edgeRules: settings?.extractEdgeRules || DEFAULT_EXTRACT_EDGE_RULES,
    };
}
