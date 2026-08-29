#!/usr/bin/env node
// Dependency-free test runner for core/. `node tests/run.mjs`.

import { loadCore } from './harness.mjs';
import { results } from './assert.mjs';

const SF = loadCore();
for (const mod of ['color', 'draw', 'sheet', 'templates', 'project'])
    if (!SF[mod]) { console.error(`core/${mod} did not attach to SpriteForge`); process.exit(1); }

const suites = ['./project.test.mjs', './color.test.mjs', './draw.test.mjs', './sheet.test.mjs', './templates.test.mjs', './gamemaker.test.mjs', './engines.test.mjs', './targets-store.test.mjs', './palettes.test.mjs', './project-ui.test.mjs'];
// Awaited because project-ui.test.mjs drives async Save calls. The sync suites
// return undefined and are unaffected; without it the tally below would print
// before the async one had finished counting.
for (const s of suites) await (await import(s)).default(SF);

console.log(`${results.pass} passed, ${results.fail} failed`);
if (results.fail) {
    console.log('\n' + results.fails.map(f => '  FAIL ' + f).join('\n\n'));
    process.exit(1);
}
