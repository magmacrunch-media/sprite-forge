#!/usr/bin/env node
// vendor-ops-themes.mjs — regenerate app/core/ops-themes.js from MAGMA//OPS.
//
//   node scripts/vendor-ops-themes.mjs [path-to-magmacrunch-ops]
//
// The themes are authored in magmacrunch-ops/dashboard/static/theme.js, where
// they are CSS variable sets for the ops dashboard and the website sections.
// A sprite palette is the same thing with the variable names thrown away, so
// they come across as flat colour lists.
//
// Vendored rather than fetched, for the reason the shell is vendored: this app
// ships as a desktop binary with no network and no build step, so anything it
// needs at runtime has to already be inside it. Re-run this when the ops themes
// change; the generated file is data only, and the logic that reads it lives in
// core/palettes.js and is not touched here.
//
// theme.js is a plain array literal in a repo we own, so it is read by
// evaluating that literal. It is not parsed as JSON because it is JavaScript —
// unquoted keys, single quotes — and not imported because the file is a browser
// IIFE that expects a DOM.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const OPS = resolve(process.argv[2] || join(REPO, '..', 'magmacrunch-ops'));
const SOURCE = join(OPS, 'dashboard', 'static', 'theme.js');
const OUT = join(REPO, 'app', 'core', 'ops-themes.js');

const src = readFileSync(SOURCE, 'utf8');
const at = src.indexOf('var DEFAULT_THEMES');
if (at < 0) throw new Error(`${SOURCE}: no DEFAULT_THEMES array`);
const literal = src.slice(src.indexOf('[', at), src.indexOf('];', at) + 1);

// eslint-disable-next-line no-eval
const themes = eval(literal);

const slug = (name) => name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const seen = new Set();
const kept = [];
let dropped = 0;

for (const t of themes) {
    // Six of the arcade entries carry only nav colours and an empty palette.
    // They are themes for a page, not a set of colours to draw with.
    if (!t.palette || !t.palette.length) { dropped++; continue; }

    // Within one theme the same hex can appear under two variable names. As a
    // set of swatches that is one colour, and a duplicate swatch is a wasted
    // one out of thirty-two.
    const colors = [];
    const inTheme = new Set();
    for (const c of t.palette) {
        const hex = String(c.value).trim().toLowerCase();
        if (!/^#[0-9a-f]{6}$/.test(hex) || inTheme.has(hex)) continue;
        inTheme.add(hex);
        colors.push(hex);
    }
    if (!colors.length) { dropped++; continue; }

    let id = slug(t.name);
    while (seen.has(id)) id = id + '-2';
    seen.add(id);

    kept.push({ id, name: t.name, section: t.section, colors });
}

kept.sort((a, b) => a.section.localeCompare(b.section) || a.name.localeCompare(b.name));

const rows = kept.map(t =>
    `    { id: ${JSON.stringify(t.id)}, name: ${JSON.stringify(t.name)}, ` +
    `section: ${JSON.stringify(t.section)},\n` +
    `      colors: ${JSON.stringify(t.colors)} },`).join('\n');

const out = `// ops-themes.js — colour themes vendored from MAGMA//OPS.
//
// GENERATED. Do not edit by hand: run
//
//     node scripts/vendor-ops-themes.mjs [path-to-magmacrunch-ops]
//
// Source: magmacrunch-ops/dashboard/static/theme.js, where these are CSS
// variable sets for the ops dashboard and the website sections. Here the
// variable names are dropped and what is left is a list of colours to draw
// with. Themes with an empty palette are not carried across, and a hex that
// appears twice in one theme is carried once.
//
// Data only. The logic that loads one into the editor is core/palettes.js.

window.SpriteForge = window.SpriteForge || {};
window.SpriteForge.opsThemes = [
${rows}
];
`;

writeFileSync(OUT, out, 'utf8');
console.log(`${kept.length} themes -> app/core/ops-themes.js (${dropped} without colours skipped)`);
