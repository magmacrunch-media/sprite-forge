#!/usr/bin/env node
// vendor-ops-themes.mjs — regenerate app/core/ops-themes.js from MAGMA//OPS.
//
//   node scripts/vendor-ops-themes.mjs [path-to-magmacrunch-ops]
//
// The themes are authored in magmacrunch-ops, where they are CSS variable sets
// for the ops dashboard and the website sections. A sprite palette is the same
// thing with the variable names thrown away, so they come across as flat
// colour lists.
//
// Vendored rather than fetched, for the reason the shell is vendored: this app
// ships as a desktop binary with no network and no build step, so anything it
// needs at runtime has to already be inside it. Re-run this when the ops themes
// change; the generated file is data only, and the logic that reads it lives in
// core/palettes.js and is not touched here.
//
// Two layouts, because the split is happening over there and not here. The
// themes are moving out to themes/palettes.json; until that lands they are
// still inline in dashboard/static/theme.js, as a plain array literal inside a
// browser IIFE — which is why that path is read by slicing the literal out and
// evaluating it, JSON.parse having no chance against unquoted keys and single
// quotes. The .json needs none of that. This prefers the new path and falls
// back, so the same command works either side of the move, and whichever it
// used is named in the file it writes. Delete the fallback once ops has
// split — it is the only thing keeping the eval alive.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const OPS = resolve(process.argv[2] || join(REPO, '..', 'magmacrunch-ops'));
const SPLIT = join(OPS, 'themes', 'palettes.json');
const INLINE = join(OPS, 'dashboard', 'static', 'theme.js');
const OUT = join(REPO, 'app', 'core', 'ops-themes.js');

/** The file, or null if it is simply not there. Anything else still throws. */
function readIfPresent(path) {
    try { return readFileSync(path, 'utf8'); }
    catch (e) {
        if (e.code === 'ENOENT') return null;
        throw new Error(`${path}: ${e.message}`);
    }
}

/** The themes, and the path they came from, from whichever layout is present. */
function load() {
    const json = readIfPresent(SPLIT);
    if (json !== null) {
        try { return { themes: JSON.parse(json), from: SPLIT, rel: 'themes/palettes.json' }; }
        catch (e) { throw new Error(`${SPLIT}: ${e.message}`); }
    }

    const js = readIfPresent(INLINE);
    if (js === null)
        throw new Error(`no themes in ${OPS}: looked for themes/palettes.json and `
            + 'dashboard/static/theme.js');

    const at = js.indexOf('var DEFAULT_THEMES');
    if (at < 0) throw new Error(`${INLINE}: no DEFAULT_THEMES array`);
    const literal = js.slice(js.indexOf('[', at), js.indexOf('];', at) + 1);
    // eslint-disable-next-line no-eval
    return { themes: eval(literal), from: INLINE, rel: 'dashboard/static/theme.js' };
}

const { themes, from, rel } = load();

// An empty vendoring is the quiet failure this script can cause: it would
// write a valid ops-themes.js with no themes in it, and the editor would come
// up with an empty palette list rather than an error.
if (!Array.isArray(themes) || !themes.length) {
    throw new Error(`${from}: expected a non-empty array of themes`);
}

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
// Source: magmacrunch-ops/${rel}, where these are CSS
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
console.log(`${kept.length} themes from ${rel} -> app/core/ops-themes.js `
    + `(${dropped} without colours skipped)`);
