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
  fonts/        self-hosted faces the shell asks for, and their OFL licences
desktop/        the Tauri shell
tests/          node tests for core/, plus project-ui's save-error messages
scripts/        development-time tools; never loaded by the app
.github/        the two-platform release build
```

`scripts/` runs in Node against `core/`, which is what `core/` having no DOM buys.
`tests/harness.mjs` is how: it evaluates the classic scripts against a stub window
and exports the fake canvas alongside `loadCore`, so a script that needs to read
pixels gets the same `getImageData` the suites do rather than a second shim that
can drift from it. `scripts/png-decode.mjs` is the other half — Node has no image
decoding, and the browser build never needs it because `new Image()` already does
that job.

**app/ exists because it is tauri.conf.json's `frontendDist`, and Tauri embeds
that directory whole.** Pointing it at the repo root put `.git`, `node_modules`,
`tests/` and `desktop/src-tauri/target/` into the asset bundle — and the build
failed outright when it reached the build lock it was itself holding. Anything
added beside `app/` stays out of the binary; anything added inside it ships.

`core/` never reaches back into `ui/`. That is the whole point of the split:
the same `core/` serves the desktop build, the web demo, and the export
targets, none of which share a DOM.

Load order matters and is fixed in `ui/index.html` — `tier` → `color` → `draw`
→ `sheet` → `templates` → `editor`. `tier.js` is first in `core/` because it
reads `SpriteForge.fs`, which `ui/bridge.js` decides in `<head>`, and it holds
that answer for everything below. `sheet.js` and `project.js` both read
`SpriteForge.color` at IIFE time, and `editor.js` binds every core export at
its top.

`platform.js` is first in `ui/`, because `menu.js` calls its `applyLabels()`
before handing the menu markup to the kit — the other way round and a Mac build
shows Ctrl chords that were already read.

After `editor.js` come `sprites-ui.js`, `project-ui.js`, `targets-ui.js`,
`help-ui.js` and `menu.js`, in that order. sprites-ui seeds itself from the blank sprite the
editor has already built, so it must come after it; project-ui asks sprites-ui
for the whole list when saving; targets-ui reads the current project from
project-ui; help-ui.js owns the two HELP modals and depends on
none of them; menu.js dispatches to all of them and implements nothing itself,
so it loads last.

Two calls run against that order, both because a colour change is the
project's business and not one sprite's. Applying a theme asks project-ui.js,
which owns the dialogs, and falls back to swapping the swatches alone when
there is no answer. REPLACE and a slot recolour ask sprites-ui.js to rewrite
the sprites that are not on the canvas, and to hand back a copy of the list
for the undo entry — which is why those entries, alone among them, carry every
sprite. Both are read at call time and never captured: neither module exists
yet when editor.js is evaluated.

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

## Two tiers, one codebase

`app/` is both the page on magmacrunch.com and the desktop bundle. Which one a
visitor gets is decided at load, by three gates stacked on purpose:

1. `kit/bridge-core.js` looks for `window.__TAURI_INTERNALS__` — never a user
   agent — and, finding it, adds `desktop` to `<html>` and exposes
   `MagmaKit.tauri`.
2. `ui/bridge.js` turns that into `SpriteForge.fs`. In a browser it returns
   early and `fs` stays undefined. **Its absence IS the feature switch.**
3. `core/tier.js` turns that one boolean into a capability table, so the POLICY
   lives in one place instead of being an accident of which call site happened
   to check for a filesystem first.

Three capabilities are `full`: `projects`, `targets`, `menubar`. Everything
absent from the table is in both tiers — it lists exceptions, so adding a
feature does not mean remembering to add a row.

**A capability only earns a `full` when it is genuinely new work needing a
filesystem or a window**, never as a way to make the desktop build look better
by taking something away from the web one. `tests/tier.test.mjs` asserts that
decision rather than the mechanism, including the exact set of three, so a
fourth is a deliberate edit to a test.

The CSS gate stays alongside the tier gate, and both are wanted: `style.css`
hides `.menubar` and `.doc-name` until `bridge.js` sets `html.desktop`, which
stops a flash, while the tier stops the code running. That second half is not
cosmetic — `menu.js`'s `app:quit` calls `fs().quit()`, which used to be
unreachable only because CSS hid the button. It is now unreachable because in
LITE the bar is never wired at all.

`ui/platform.js` is deliberately outside the gate. It relabels Ctrl chords as
Mac glyphs, and a Mac in a browser is the ordinary case for the Reference card.

## The workspace is height-constrained, and stays that way

`#canvas-panel` is a three-row grid — toolbar, `#canvas-stage`, `#dock` — and the
stage is the only row that gives. Add a fourth sibling and you are back to the
layout this replaced, where the canvas was a sibling of the previews and pushed
them off the bottom of the screen: a 128×128 sprite at the default 16× is a
2048px canvas, which left 1893px of the column unreachable and the preview about
1700px below the fold. Anything new belongs in the dock or the sidebar.

Zoom fits on the way in. `sizeCanvas()` shrinks to the largest `ZOOM_STEPS` entry
that fits, once per sprite size and **only downward** — growing to fit would
fight anyone who has zoomed in, and zooming in past the window is how you draw a
pixel. `setZoom` deliberately does not refit, so manual zoom survives.

The sidebar is an accordion: one `details[data-section]` open at a time, because
the sections total ~1400px and the column is 600–950px. Do not ship a section
with `open` in the markup. The palette is the exception and is not a section at
all — it is a `.side-block` above them, always visible, because every tool has a
single-key shortcut and a swatch has none, so it is the one panel that cannot
afford to be the thing you just closed. Keep it small; that is why THEME &
REPLACE is its own section rather than living under it.

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

## The version lives in five places, and three lockfiles

No build step means no single source for it, so a bump is five edits:

```
package.json                        the repo
desktop/package.json                the shell's package
desktop/src-tauri/tauri.conf.json   the installer and the Apps list
desktop/src-tauri/Cargo.toml        the crate
app/ui/index.html                   the footer, which only the web build shows
```

The footer is the one that rots, because the desktop build hides it — it sat at
"v1.0" through everything up to 0.2.0. It is now also the only copy in that
file: the Credits modal reads `#app-version` out of it rather than printing a
sixth, and the desktop build overwrites it from `app_version` (Cargo.toml, via
`CARGO_PKG_VERSION`).

You no longer have to remember to check it. `tests/version.test.mjs` holds
`tauri.conf.json` and the footer to Cargo.toml, so a bump that forgets either
fails `npm test`. The two package.json files are deliberately NOT asserted —
they are build tooling, nothing publishes them, and wiring them in would be
fixing a consistency nobody depends on.

Three lockfiles carry it as well — `desktop/src-tauri/Cargo.lock`,
`package-lock.json` and `desktop/package-lock.json`. All three are generated
and all three are tracked, so **regenerate them, never hand-edit them**:

```
cd desktop/src-tauri && cargo check --locked
npm install --package-lock-only
npm install --package-lock-only --prefix desktop
```

`--locked` is the useful half of the first one: it refuses to rewrite the
lockfile, so a stale version fails the command instead of being quietly
papered over on the next build.

## The shared kit

`app/kit/` and `tests/kit/` are **vendored** from the `magma-kit` sibling
checkout and are GENERATED — see `app/kit/KIT.md` for the version and hashes.
Never edit them here:

```
npm run sync-kit     re-vendor
npm run check:kit    verify nothing has drifted
```

The kit owns the crash-reporting boot script, the Tauri bridge substrate, the
keyboard resolver, the undo/redo stack, the prefs helper, the `<dialog>`
idioms, and the test harness — all of which used to exist here and in
magma-ops-app as forks of each other. It also owns the Rust behind the file
commands, the log file and the close guard (`magma-kit = { path = ... }` in
`desktop/src-tauri/Cargo.toml`, so the sibling checkout has to be present to
build).

What stays here is what is actually this app's: the load ORDER, the namespace,
the canvas shims `core/sheet.js` needs, the bindings TABLE, and what an undo
state IS. If a kit file ever needs app-specific content, the design is wrong —
move the content here and pass it in.

`@tauri-apps/cli` is pinned EXACTLY, to the same version magma-ops-app pins,
because `kit/bridge-core.js` subscribes to events through `transformCallback`,
a Tauri internal, and both apps now ride the one copy of that code.

## One keyboard table

`core/keybindings.js` holds every shortcut. `editor.js`, `project-ui.js` and
`help-ui.js` each resolve through the kit and pass the list of actions they
handle, so none can swallow another's key (Ctrl+O is Open; bare `o` is the
origin tool). Do not add a fifth `keydown` listener that parses keys itself —
that is how the old ones came to disagree about what counts as typing. menu.js
keeps its Escape-to-close, which is a dismissal rather than a shortcut.

A menu item that prints a shortcut must answer to it; `tests/keybindings.test.mjs`
asserts every shortcut the menu bar prints actually resolves.

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

## Importing a game's existing art

`node scripts/import-moonlight-drift.mjs` turns moonlight-drift's 48 pre-rendered
Wii PNGs into 24 `.forge` projects, named and origin-stamped so Export drops them
back on the files they came from. Nothing about it is Moonlight Drift's alone —
any game whose art predates this editor meets the same two walls:

- **No partial alpha.** `core/sheet.js` is on-or-off, so an antialiased render
  loses its soft edges coming in. On that roster it costs 3% of one character and
  98% of another, who is a deliberately translucent ghost. The script hardens the
  image at a cutoff you pass rather than pretending the default suits everyone.
- **89 colours.** That is `core/project.js`'s `ALPHABET`, one character per colour,
  and 15 of those 24 characters have more. Colours have to be reduced to import at
  all, so the script does it by pixel count and snaps the rest to the nearest.

The editor's own File > Import hits the second wall too, and later: it imports
fine and then cannot save.

## Vendored shell

`shell/` is a byte copy of magmacrunch.com's `ware/shell/` — **except**
`shell/fonts.css`, which is swapped. That upstream file carries the shell's only
filesystem assumption (`../../fonts/`, true only two levels below the website
root) and its own header invites a bundled desktop build to replace it. Nothing
else in `shell/` is path-dependent; keep the rest byte-identical so an upstream
fix can be re-vendored without a merge.

## The website copy

`scripts/sync-web.mjs` is the ONLY writer of `website/ware/sprite-forge/`. It
is a byte copy with two transforms, and it has no build step to hide behind:

- **The page moves up one level.** `app/ui/index.html` sits two below `app/`;
  `ware/sprite-forge/index.html` sits one below `ware/`. So `../kit/` and
  `../core/` are rewritten to `kit/` and `core/`, and `../shell/` and
  `../utilities/` are left **alone** — at the new depth they already point at
  the website's own `ware/shell/` and `ware/utilities/`. That is exactly why
  `shell/fonts.css` is the one file not sent (see below).
- **The stamps are the website's rule.** `?v=` is the first 8 hex of the file's
  SHA-256 over content with CRLF normalised to LF, and
  `website/scripts/check-cache-busters.mjs` fails that repo's CI if a stamp and
  its file disagree. `digest()` is that rule verbatim; do not improve it
  independently.
- **Bytes go through untouched.** Both repos leave line endings to
  `core.autocrlf` — see `.gitattributes`, which names this script. Normalising
  on write would show every synced file as modified while `git diff` showed
  nothing, burying the one file that actually changed.
- **It prunes what it did not write**, which is how the old pre-split monolith
  (`js/app.js`, `js/templates.js`, `css/style.css`) left. Run `npm run
  check:web` first; it lists every write and delete without doing any of them.

`plan()` refuses to run if `index.html` loads something the manifest does not
copy, so adding a `ui/` file and forgetting the sync fails here rather than as
a MISSING asset in the website's CI, one repo away from the cause.

`check:web` stays out of `npm run check` for the same reason `check:kit` does:
it needs a sibling checkout that may not be there.

## Releases

`.github/workflows/release.yml` builds on `macos-latest` and `windows-latest`
and attaches the bundles to a GitHub release on a `v*` tag; `workflow_dispatch`
builds the same thing without publishing.

It exists because a macOS bundle **cannot be cross-compiled** — Tauri links
against the system WebKit — and a GitHub runner is the only route to one from a
Windows desk. Once macOS has to come through there, Windows comes too, so both
halves of a release are built the same way. macOS is `--target
universal-apple-darwin`: one `.dmg` that cannot be the wrong download.

The workflow checks out `magmacrunchmedia/magma-kit` as a named sibling,
because `desktop/src-tauri/Cargo.toml` declares
`magma-kit = { path = "../../../magma-kit/crate" }` and cargo cannot resolve it
otherwise. A pre-flight step fails with a sentence rather than inside cargo's
resolver.

Nothing is signed or notarized. That is a deliberate cost, documented in the
README next to the SmartScreen and Gatekeeper workarounds; adding it later
means Apple Developer credentials in repo secrets and nothing else.

`tauri.conf.json` still lists `appimage` and `deb` alongside `msi`, `nsis` and
`dmg`. There is no Linux runner, and Tauri silently skips targets that do not
apply to the host, so they cost nothing and are left as the standing intent.

## Git

Commit and push as magmacrunchmedia. No AI attribution trailers, ever.

<!-- Update this file in the same commit as any change to layout, load order, or the sheet format. -->
