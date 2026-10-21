/**
 * Clones a value through a JSON round-trip so the result matches what the
 * server receives on the wire.
 *
 * `JSON.stringify` collapses sparse-array slots to `null` and removes
 * `undefined` object fields. `structuredClone` preserves both, which makes a
 * frontend snapshot diverge from the server's stored copy and causes the next
 * JSON Patch test to fail.
 *
 * Functions and symbols are dropped. Values JSON cannot represent (cycles,
 * bigints) throw. Every persistence endpoint stores JSON, so such values are
 * invalid on the server as well; callers must surface the error instead of
 * rewriting the payload.
 *
 * @param {*} value
 * @returns {*}
 */
export function cloneAsJsonWire(value) {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? undefined : JSON.parse(serialized);
}
