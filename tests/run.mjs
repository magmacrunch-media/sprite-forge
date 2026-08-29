#!/usr/bin/env node
// Dependency-free test runner for core/. `node tests/run.mjs`.

import { loadCore, scriptOrder, ORDER, KIT_ORDER } from './harness.mjs';
import { results, test, eq, ok } from './assert.mjs';

const SF = loadCore();
for (const mod of ['color', 'draw', 'sheet', 'templates', 'project'])
    if (!SF[mod]) { console.error(`core/${mod} did not attach to SpriteForge`); process.exit(1); }

// The load order in the page IS the dependency order — sheet.js reads
// SpriteForge.color at IIFE time, store.js reads engines.kinds(). A reordered
// <script> list is a runtime crash in a browser and nowhere else; asserting it
// here makes it a test failure instead.
test('index.html loads kit/ then core/, before ui/', () => {
    const srcs = scriptOrder('index.html');

    // boot.js is deliberately first, ahead of everything, because it exists to
    // report failures in the modules that follow it.
    eq(srcs[0], '../kit/boot.js', 'boot.js loads before anything it might report on');

    const kit = srcs.filter(s => s.includes('/kit/')).map(s => s.split('/').pop());
    eq(kit, ['boot.js', 'bridge-core.js', ...KIT_ORDER], 'kit scripts in index.html');

    const core = srcs.filter(s => s.includes('/core/')).map(s => s.replace('../core/', ''));
    eq(core, ORDER, 'core scripts in index.html');

    const lastKit = srcs.map(s => s.includes('/kit/')).lastIndexOf(true);
    const firstCore = srcs.findIndex(s => s.includes('/core/'));
    ok(lastKit < firstCore, 'every kit module loads before core/');

    const lastCore = srcs.map(s => s.includes('/core/')).lastIndexOf(true);
    ok(srcs.indexOf('editor.js') > lastCore, 'editor.js loads after every core/ module');
});

const suites = ['./project.test.mjs', './color.test.mjs', './draw.test.mjs', './sheet.test.mjs', './templates.test.mjs', './gamemaker.test.mjs', './engines.test.mjs', './targets-store.test.mjs', './palettes.test.mjs', './png-decode.test.mjs', './project-ui.test.mjs', './sprites-ui.test.mjs', './version.test.mjs'];
// Awaited because project-ui.test.mjs drives async Save calls. The sync suites
// return undefined and are unaffected; without it the tally below would print
// before the async one had finished counting.
for (const s of suites) await (await import(s)).default(SF);

console.log(`${results.pass} passed, ${results.fail} failed`);
if (results.fail) {
    console.log('\n' + results.fails.map(f => '  FAIL ' + f).join('\n\n'));
    process.exit(1);
}
