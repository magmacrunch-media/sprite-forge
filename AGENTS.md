# SPRITE//FORGE

Pixel-art sprite and animation editor. Runs as a downloadable desktop app
(Tauri) and, in a reduced form, as a page on magmacrunch.com. Vanilla JS,
no build step, no framework. PolyForm Noncommercial 1.0.0 — this is a product,
not an engine, so it sits with the games rather than with adenosine/magnolia.

## AI Attribution

**No AI attribution.** Do not append `Co-Authored-By: Claude …`, "Generated with …",
or any similar trailer to commit messages, PR bodies, or release notes. If your
tooling adds such a line by default, remove it before committing.

This extends to what the app writes: no generator trailer in an exported
`.forge` file, a patched `.yy`, or any PNG comment chunk.

## Layout

```
app/            everything the shipped app loads, and nothing else
  core/         pure logic — no DOM, no Tauri, no filesystem
  ui/           the DOM layer: canvas, widgets, mutable editor state
  shell/        vendored from magmacrunch.com's ware/shell (see below)
  fonts/        self-hosted faces the shell asks for
desktop/        the Tauri shell
tests/          node tests for core/
```

**app/ exists because it is tauri.conf.json's `frontendDist`, and Tauri embeds
that directory whole.** Pointing it at the repo root put `.git`, `node_modules`,
`tests/` and `desktop/src-tauri/target/` into the asset bundle — and the build
failed outright when it reached the build lock it was itself holding. Anything
added beside `app/` stays out of the binary; anything added inside it ships.

`core/` never reaches back into `ui/`. That is the whole point of the split:
the same `core/` serves the desktop build, the web demo, and the export
targets, none of which share a DOM.

Load order matters and is fixed in `ui/index.html` — `color` → `draw` →
`sheet` → `templates` → `editor`. `sheet.js` reads `SpriteForge.color` at IIFE
time, and `editor.js` binds every core export at its top.

## Not ES modules, deliberately

Everything is a classic script attaching to `window.SpriteForge`. The website is
buildless and busts caches by stamping `?v=<hash>` onto `<script src>` tags
(its `scripts/sync-adenosine.mjs`). An `import` specifier inside a `.js` file is
invisible to that stamper, so an ES-module `core/` would sit behind stale caches
with no way to force a refresh. Do not convert.

## The sprite sheet format is not ours to change

Uniform grid PNG: `frameWidth` × `frameHeight` cells, counted left-to-right then
top-to-bottom. The origin travels with the load call and is **never** stored in
the PNG.

Four consumers assume it — adenosine (TS), magnolia (C/Wii), texastoast (Python)
and the GameMaker importer. Canonical spec lives in `adenosine/packages/rpg/API.md`,
the `sprites.ts` section; `adenosine/AGENTS.md` marks it "do not change
unilaterally". Changing `core/sheet.js`'s format is a four-repo change.

## Vendored shell

`shell/` is a byte copy of magmacrunch.com's `ware/shell/` — **except**
`shell/fonts.css`, which is swapped. That upstream file carries the shell's only
filesystem assumption (`../../fonts/`, true only two levels below the website
root) and its own header invites a bundled desktop build to replace it. Nothing
else in `shell/` is path-dependent; keep the rest byte-identical so an upstream
fix can be re-vendored without a merge.

## Git

Commit and push as magmacrunchmedia. No AI attribution trailers, ever.

<!-- Update this file in the same commit as any change to layout, load order, or the sheet format. -->
