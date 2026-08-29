// The version lives in five places with no build step to reconcile them (see
// AGENTS.md). This is the kit's suite, which makes the drift a test failure
// instead of a shipped contradiction — an installer whose filename disagrees
// with the version the app reports.

import { versionSuite } from './kit/versions.mjs';
import { test, eq, ok } from './assert.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export default function () {
    // markup: 'must-match' rather than 'none' — this app has a web build too,
    // and a browser has no binary to ask, so index.html carries the version.
    // That is the copy AGENTS.md warns rots (the desktop build hides the
    // footer, and it sat at v1.0 through everything up to 0.2.0). Now a bump
    // that forgets it fails here instead of shipping.
    versionSuite({ root: ROOT, markup: 'must-match' })(test, eq, ok);
}
