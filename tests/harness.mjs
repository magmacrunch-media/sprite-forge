// Loads core/ into a fake window so the browser IIFEs can be tested in Node.
//
// The loading itself is the kit's (tests/kit/harness.mjs, vendored from
// magma-kit — the same code magma-ops-app runs). What stays here is what is
// this app's: the load ORDER, the namespace, and the canvas shims core/sheet.js
// needs. Evaluating in order also proves the load order in ui/index.html is the
// real dependency order: drop a file and the next one throws here before it
// ever reaches a browser.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHarness } from './kit/harness.mjs';
import { ImageData, canvas, fakeDocument } from './kit/canvas-shim.mjs';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', 'app');

export const ORDER = ['color.js', 'draw.js', 'sheet.js', 'templates.js', 'project.js',
    'targets/gamemaker.js', 'targets/engines.js', 'targets/store.js',
    'ops-themes.js', 'palettes.js'];

// The kit files core/ is allowed to lean on: the pure ones. boot.js and
// bridge-core.js are load-order concerns, not sandbox concerns — one attaches
// window listeners and the other detects Tauri, and a core module that needed
// either would belong in ui/.
export const KIT_ORDER = ['keys.js', 'history.js', 'prefs.js', 'modal.js', 'dom.js'];

// core/sheet.js is the only module that touches browser drawing APIs, and only
// to compose or read back a bitmap. The shims are just enough for that; they
// are not a canvas implementation and are not trying to be.
//
// Re-exported because the suites are no longer the only caller:
// scripts/import-moonlight-drift.mjs reads real PNGs through sheetToFrames and
// needs the same context to hand it. One shim rather than two, so the script
// cannot come to disagree with the tests about what a getImageData returns.
export { ImageData, canvas };

const harness = createHarness({
    appRoot: APP,
    namespace: 'SpriteForge',
    kitFiles: KIT_ORDER,
    coreFiles: ORDER,
    globals: { ImageData, document: fakeDocument() },
});

export function loadCore() { return harness.loadCore(); }

/**
 * The same load, handing back the whole fake window rather than just
 * SpriteForge.
 *
 * ui/ is out of scope for these tests as a rule — it is the DOM and the
 * mutable editor state, and stubbing that is a browser's job. The exception is
 * a ui/ file whose whole job is deciding what to tell the user when core/
 * refuses something: that decision is logic, it has been wrong before, and it
 * is reachable with a handful of stubs. See project-ui.test.mjs.
 */
export function coreSandbox() { return harness.coreSandbox(); }

/** Evaluate a ui/ file into a sandbox from coreSandbox(). */
export function loadUI(sandbox, file) { return harness.loadUI(sandbox, file); }

/** The <script src="..."> paths from a ui/ page, in document order. */
export function scriptOrder(page) { return harness.scriptOrder(page); }
