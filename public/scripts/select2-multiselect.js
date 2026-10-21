/**
 * Shared helpers for the multi-select bulk delete UI on Select2 lists.
 *
 * This module is deliberately dependency-free: it is imported by
 * `select2-actionable-single.js`, `world-info.js`, `preset-manager.js` and the
 * connection manager, and it must stay importable under the repository's node
 * Jest environment. That rules out `./i18n.js` (touches `localStorage` and
 * `MutationObserver` at module load) and `./utils.js` (pulls in `../lib.js`,
 * `../script.js` and `./world-info.js`).
 */

/**
 * Escapes the five HTML-significant characters so a user-supplied name can be
 * interpolated into an HTML string without breaking out of it.
 * @param {unknown} value Value to escape
 * @returns {string} Escaped string, or an empty string for null/undefined
 */
export function escapeHtmlText(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Builds the confirm-dialog body that lists the names about to be deleted.
 * `Popup.show.confirm` renders its text through `innerHTML`, so every name is
 * escaped here.
 * @param {string[]} names Names to list
 * @returns {string} HTML body with one escaped name per line
 */
export function buildBulkDeleteConfirmBody(names) {
    return (Array.isArray(names) ? names : [])
        .map((name) => `· ${escapeHtmlText(name)}`)
        .join('<br>');
}

/**
 * Creates the selection set backing a dropdown's batch mode. Values are
 * compared as strings so a numeric option value and its string form match.
 * @returns {{
 *   has: (value: string) => boolean,
 *   toggle: (value: string) => boolean,
 *   add: (values: Iterable<string>) => void,
 *   remove: (values: Iterable<string>) => void,
 *   clear: () => void,
 *   values: () => string[],
 *   size: () => number,
 * }} The selection set
 */
export function createSelectionState() {
    /** @type {Set<string>} */
    const selected = new Set();

    return {
        has: (value) => selected.has(String(value)),
        toggle: (value) => {
            const key = String(value);
            if (selected.has(key)) {
                selected.delete(key);
                return false;
            }
            selected.add(key);
            return true;
        },
        add: (values) => {
            for (const value of values) {
                selected.add(String(value));
            }
        },
        remove: (values) => {
            for (const value of values) {
                selected.delete(String(value));
            }
        },
        clear: () => {
            selected.clear();
        },
        values: () => [...selected],
        size: () => selected.size,
    };
}
