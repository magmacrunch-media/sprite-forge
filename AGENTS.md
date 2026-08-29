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
tests/          node tests for core/, plus project-ui's save-error messages
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
`sheet` → `templates` → `editor`. `sheet.js` and `project.js` both read
`SpriteForge.color` at IIFE time, and `editor.js` binds every core export at
its top.

After `editor.js` come `sprites-ui.js`, `project-ui.js`, `targets-ui.js` and
`menu.js`, in that order. sprites-ui seeds itself from the blank sprite the
editor has already built, so it must come after it; project-ui asks sprites-ui
for the whole list when saving; targets-ui reads the current project from
project-ui; menu.js dispatches to all of them and implements nothing itself, so
it loads last.

The one call that runs against that order is the theme dropdown: it lives in
editor.js, but applying a theme recolours every sprite, so it asks
project-ui.js to do it and falls back to swapping the swatches alone when
there is no answer. Read at call time, never captured — project-ui.js does
not exist yet when editor.js is evaluated.

The sprite being edited lives in the editor and nowhere else — the editor is
the only thing that knows about a stroke half finished on the canvas. The rest
of the project's sprites live in sprites-ui as plain data, which is why every
path that touches that list syncs the editor back into it first. Switching
clears the undo history on purpose: the stack holds states of the sprite being
left, and replaying one into the sprite you switched to would paste another
sprite's frames over yours. `revision()` is a counter that only ever goes up,
because with a list the undo depth is no longer a property of the project. `png.js` goes before
`editor.js`, which encodes the sheet it exports.

`bridge.js` is the other exception: it loads from the `<head>`, ahead of all of them.
It is what detects Tauri, and it marks `<html class="desktop">` so CSS can drop
the website chrome before the body paints rather than flashing it on every
launch. That mark cannot come from an inline script — the desktop CSP is
`default-src 'self'` with no `script-src`, so inline is blocked. It touches no
DOM tree and no core export, so running first costs nothing.

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

## The version lives in five places

No build step means no single source for it, so a bump is five edits:

```
package.json                        the repo
desktop/package.json                the shell's package
desktop/src-tauri/tauri.conf.json   the installer and the Apps list
desktop/src-tauri/Cargo.toml        the crate
app/ui/index.html                   the footer, which only the web build shows
```

The footer is the one that rots, because the desktop build hides it — it sat at
"v1.0" through everything up to 0.2.0. Check it.

## Vendored colour themes

`core/ops-themes.js` is **generated** — `node scripts/vendor-ops-themes.mjs
[path-to-magmacrunch-ops]` — from magmacrunch-ops's
`dashboard/static/theme.js`, where the same data drives the ops dashboard's CSS
variables. Do not hand-edit it; re-run the script. Themes with an empty palette
are dropped and a hex repeated inside one theme is carried once.

Vendored rather than fetched for the reason the shell is: the desktop build has
no network and no build step, so what it needs at runtime has to be inside the
binary. The logic that reads the data is `core/palettes.js`, which is written
by hand and is not regenerated.

A theme is only the set of swatches you draw *from*. It never rewrites placed
pixels — that is REPLACE and the template slots.

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
