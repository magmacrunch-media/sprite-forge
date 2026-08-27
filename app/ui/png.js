// png.js — a composed canvas as PNG bytes.
//
// Small and separate because two callers need it and neither should own it:
// the export panel writes one sheet through the Save dialog, and the targets
// panel writes one per sprite straight into a game repo.
//
// core/sheet.js is the wrong home even though it is the file that composes the
// canvas. It is tested in Node against a hand-written context shim (see
// tests/harness.mjs), and that shim has no toBlob — putting an encoder there
// would mean either shimming a real PNG encoder or leaving the module's newest
// function untested. Here it sits in ui/, where a browser is a given.

window.SpriteForge = window.SpriteForge || {};
window.SpriteForge.png = {
    /**
     * @param canvas a canvas from core/sheet.js's framesToSheet
     * @returns {Promise<Uint8Array>} the encoded PNG
     */
    bytes(canvas) {
        return new Promise((resolve, reject) => canvas.toBlob(
            blob => blob
                // .catch matters: without it a rejected arrayBuffer left this
                // promise pending forever, and every caller awaits it — the
                // export would hang with no toast and no error.
                ? blob.arrayBuffer().then(a => resolve(new Uint8Array(a)), reject)
                : reject(new Error('could not encode PNG')),
            'image/png'));
    },
};
