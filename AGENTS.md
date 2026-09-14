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
→ `select` → `frames` → `transform` → `sheet` → `mesh` → `templates` →
`editor`. `select.js`, `frames.js` and `transform.js` all depend on nothing, and
are grouped after `draw.js` because the four of them are what a tool does to a
drawing: plot shapes, lift a region, order the list, turn the grid. `mesh.js` is grouped beside `sheet.js` because
the two are the pixels-to-bitmap pair and deal in the same `ImageData`; it depends on no
other core module, so its place is a grouping and not a sequence. `tier.js` is first in `core/` because it
reads `SpriteForge.fs`, which `ui/bridge.js` decides in `<head>`, and it holds
that answer for everything below. `sheet.js` and `project.js` both read
`SpriteForge.color` at IIFE time; `project.js` also reads `SpriteForge.frames`
for the holds helpers, which is why `frames.js` sits above it. `editor.js` binds
every core export at its top — **directly**, not through a `() =>` accessor. That
form is for the two ui/ modules that load after it, and borrowing it for a core
module cost a crash: `select`, `frames` and `transform` were reached that way for
a while, and one use of `frames` runs while `editor.js` is still being evaluated,
which put the arrow in its own temporal dead zone. `npm test` cannot see it —
the suite loads `core/`, not `editor.js` — so it was a blank page in a browser
and nothing else.

`platform.js` is first in `ui/`, because `menu.js` calls its `applyLabels()`
before handing the menu markup to the kit — the other way round and a Mac build
shows Ctrl chords that were already read.

After `editor.js` come `sprites-ui.js`, `mesh-ui.js`, `project-ui.js`, `targets-ui.js`,
`help-ui.js` and `menu.js`, in that order. mesh-ui only has to be after editor.js, which
calls it; it publishes `SpriteForge.meshUI` and `renderAnim()` looks that up at call time,
so the preview simply does not draw until the module exists rather than erroring.
sprites-ui seeds itself from the blank sprite the
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

`projects` is the sharpest case, and its boundary is worth stating: it means a
**path-backed** project — Save to the file you opened, Save As, the doc name,
the dirty marker. It does **not** mean the `.forge` file. Getting your work out
as a file and picking one back up are a download and a file input, which need
neither a disk nor a window, so they are untiered and LITE has them, wired to
the same `encodeCurrent()` and `adoptFromText()` the desktop build uses. Before
that split, a refresh in the browser lost everything, which was the one place
LITE was not a strict upgrade on the page it replaced. `Ctrl+S` downloads there;
`project:save-as` is the only shortcut still gated, because it asks for a path.
`tests/project-ui.test.mjs` pins that both tiers refuse the same projects — if
LITE ever grows its own encode, one of those breaks.

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

## The selection is pixels, and it is not a layer

`core/select.js` is the geometry and `ui/editor.js` is the mouse. Four decisions
are worth knowing before changing either, because each could sensibly have gone
the other way and three of them are invisible until they are wrong.

**A clip is pixels, not a rectangle of paint.** `stamp()` skips the transparent
cells of a clip, so pasting a head leaves what was around it alone. The
alternative makes every paste a hole-punch the size of the marquee. `Del` is how
you punch a hole, and it says so on the Reference card.

**A move clips; it does not wrap.** The arrow keys with no selection still
rotate the whole frame — that is `shiftFrame`, it predates this, and wrapping is
the point of it. Dragging a region off the edge loses what goes over. Same keys,
different meaning, and the dashed rectangle on the canvas is what tells them
apart.

**The pixels leave the frame once per drag, not once per mousemove.** On
mousedown the region is lifted into `dragClip` and the frame beneath is kept as
`dragBase`; nothing is committed until mouseup. Committing each step would clamp
the region against the edge at every position, so dragging out past the boundary
and back would eat it a column at a time — and it would look like a rendering
bug rather than a lost column.

**Picking another tool drops the marquee.** There are no layers, so nothing
clips a pencil stroke to a selection; an outline still drawn while the pencil
ignores it is a promise the editor does not keep. The *clipboard* is not
dropped — it outlives the selection, the frame and the sprite, which is what
makes it worth having over a duplicate button.

That last one is why the tool buttons now go through `setTool()` instead of
carrying their own copy of its two lines. The copy was harmless for as long as
picking a tool meant nothing but an assignment. The moment it acquired a
consequence, the button and the keyboard shortcut disagreed, and only the
keyboard was right.

`kit/keys.js` fires Ctrl chords through typing on purpose — Ctrl+Z in a field is
unambiguous. Four of these are the exception, and `editor.js` stands them down
itself rather than the kit growing a flag: `Ctrl+C` with the caret in the EXPORT
OUTPUT box is a person copying that snippet, and answering it with a pixel copy
would take the textarea's own clipboard away from them. The guard returns
*before* `preventDefault`, or a suppressed `Ctrl+V` would be a paste that never
arrives.

## Frame order, and the buttons that admit what they cannot do

`core/frames.js` is one function and a predicate, and it is a core module
anyway, because `reorder`'s `to` is the kind of index that is wrong for a week
before anybody notices. **`to` is where the moved frame ends up in the returned
list** — not a gap between frames, and not an index into the list before the
removal. Those two differ from this one by one, in opposite directions
depending on which way the frame travels. Dropping a frame on the third slot
makes it the third frame, whichever slot it came from, and that is the reading
a person can check by eye.

A move that would change nothing returns **null**, the same shape
`targets/gamemaker.js`'s `patchYy` uses and for the same reason: "would this do
anything?" gets one answer, and no undo entry is pushed for a move that did not
happen.

`frameIndex` follows the frame, not the position. You were editing that drawing
before the move and you are editing it after — any other reading makes dragging
a frame across the strip feel like shuffling what is under a fixed pointer.

**The frame buttons now grey themselves out, and five of them did not before.**
ADD and DUP at the 64-frame ceiling, DEL on the last remaining frame, and both
nav arrows at the ends were all live buttons with an early `return` behind
them. A press that does nothing and says nothing is the worst of the three
available answers. `updateFrameButtons()` is called from `updateFrameLabel()`
rather than from the seven places that change the list, because that is already
the one function all seven end in — a button state remembered at each call site
is one that gets forgotten at the eighth.

The sheet strip selects on **mousedown** now rather than click, because it also
drags. A plain click does exactly what it always did, one event earlier. Both
`mouseup` and `mouseleave` settle the drag where it stands rather than
abandoning it: the strip is 32 pixels tall at 2x, the cursor leaves it
constantly, and a drag that only counted when it ended inside would feel broken
on exactly the moves people make.

The drop indicator is drawn as a dark stroke under a rose dashed one, the same
two-stroke treatment as the canvas marquee and for the same reason. `#ff3d6e`
is the app's own accent and it is in the vendored themes, so a single rose line
over rose art is invisible — and the frame somebody is dragging is as likely to
be that colour as any other. It was a single line first, and sampling the strip
mid-drag over a solid `#ff3d6e` sprite returned exactly one colour.

## Rotation was square-only by accident, and it is a sprite-level operation

`core/transform.js` holds the three whole-frame operations. The flips moved out
of `ui/editor.js` unchanged and are one line each; rotation is why the file
exists.

**The old rotation built its result with the dimensions the wrong way round.**
It produced a correctly rotated grid *at the original width and height*, so it
could only ever be right when those were equal — and it was shipped behind
`if (frameW !== frameH) return;` on a live button that said nothing when
pressed. That reads like a design decision and was not one. The sizes it
refused include **16×24, this app's own DAG template**, so the shape the editor
is built around was the shape it could not turn.

`rotate90` returns `h × w` for a `w × h` grid. That swap is the entire fix; the
per-pixel formula was right all along.

**Rotation turns every frame, and that is a change from what R used to do.** A
turn swaps width and height, and the frames of a sprite all share those, so
past the square case a per-frame rotation is not a thing that can exist. R
meaning "this frame" at 32×32 and "the sprite" at 16×24 would be worse than one
meaning, so it is one meaning. The flips stay per-frame: they cannot change a
size, so nothing forces them to agree.

`rotateOrigin` is separate from the pixel formula and is not it with the
offsets removed. The origin is a **point**, not a pixel — it sits at `y === h`
for a sprite standing on its bottom row, one past the last pixel — so a
clockwise turn sends `(0, 0)` to `(h, 0)`, the top-right. It takes the height
the frame had *before* the turn; passing the new one mirrors the result on a
non-square frame and is exactly right on a square one, which is the second way
a suite that only turned squares would have missed the bug.

The selection is dropped on a turn, like every other path that changes the
frame under it: the marquee is measured in the old orientation.

## A hold is a count of beats, and it stops at the .forge

`core/frames.js` owns holds alongside the frame order, because a hold is a fact
about the sequence rather than about a frame's pixels.

**Ticks, not milliseconds.** The sprite already has an `fps`; a hold reads as
"stay up for four beats", which is how sprite animation is authored. Changing
the frame rate then rescales the whole cycle evenly instead of only the frames
nobody held, and integers keep the `.forge` diffable — which is the entire
reason that file is JSON of single characters rather than a blob.

**It does not reach any engine, and neither does `fps`.** None of the five
export targets takes a frame rate: adenosine, magnolia and texastoast each get a
sheet and a load call, GameMaker has its own playback speed in the `.yy`, and
Godot gets C# source. The PNG sheet is pixels and nothing else. So timing lives
on the authoring document and the delivery carries none of it — that is not this
being half-finished, it is where `fps` has always sat.

**The field is optional and additive; `format` stays `sprite-forge/1`.** It is
written only when some frame is held for more than one beat, so a project that
does not use them grows nothing and its diff stays clean. The cost of not
bumping the format is the honest one: a build that predates holds still opens
these files, ignores the field, and drops it on the next save. Bumping instead
would have locked those builds out of every file to protect one field.

`normalizeHolds` is the one door in. A `.forge` from before holds existed
carries none, a hand-edited one can carry anything, and the editor's own list
could in principle fall out of step with the frames — so missing, short, long,
fractional, negative and not-a-number all come back as a usable list rather than
each caller checking. `validate` still *names* a wrong holds list in a file,
because a hand-edited one a frame short is a typo worth reporting rather than
silently rounding off.

The parallel list is the risk, and it is handled in two places on purpose. The
four paths that change the frame count — add, duplicate, delete, reorder — each
move the holds with the frames, which is the only way a hold stays attached to
the frame it belongs to; reorder does it with the same index pair, so the two
cannot come apart. `updateFrameLabel` is the net under that for the fifth path
somebody adds later: a length mismatch there would be an index into `undefined`
in the tick arithmetic, and one entry too few is a frame whose timing quietly
becomes 1 rather than a crash anybody notices.

Playback counts ticks and asks `frameAtTick` which frame that is, rather than
stepping an index itself. Nothing drifts, a rate change lands where the tick
says, and pressing play on a held frame starts on its first beat via
`tickOfFrame` instead of partway through it.

## The onion skin reaches both ways, and says which way is which

`core/frames.js`'s `ghosts()` answers which frames to draw around the current
one and how solid each should be; `ui/editor.js` paints them. It sits with the
frame order and the holds because it is the same kind of question — a fact about
the sequence, not about anyone's pixels.

**Both directions.** Onion skinning is as much about the pose you are heading
for as the one you came from. That is also what forces the tints: at depth 1 a
single grey ghost is unambiguous, and at depth 2 in two directions it is not.
The ghosts carry the app's own accent pair — rose `#ff3d6e` behind, cyan
`#00f5ff` ahead — laid *over* the art at 0.55 rather than replacing it, so a
ghost still shows where the eye was while the cast says which way it is going. A
silhouette would give the direction and lose the detail, and the detail is most
of why you are looking.

**It wraps.** The frame before the first is the last, which is exactly the join
a walk cycle lives or dies on.

**A frame is never ghosted twice, and never over itself.** Reach far enough on a
short loop and the two directions start landing on frames the other has already
claimed — on four frames, three steps back is one step forward. Each frame is
taken once, by the shortest way round, at that distance's alpha. Without it a
frame is drawn twice at two alphas and reads as more solid than its neighbours
for no reason on screen; and past `count - 1` the current frame is ghosted over
itself, which reads as the art being wrong rather than the setting being high.

The nearest ghost keeps `ONION_ALPHA` (0.3) at every depth, which is the value
the single-frame version used, so depth 1 looks exactly as onion skin always
did. The alpha falls off linearly from there.

`ghosts()` returns nearest-first because that is the order it reads in; the
renderer walks it backwards so the closest ghost is painted last and lands on
top. The tint is applied through one scratch canvas redrawn per ghost rather
than a second cache keyed by frame and tint — eight blits of at most 128×128 is
nothing beside the two full-frame loops `render()` already runs, and a cache
there would be a second thing to invalidate everywhere `frameCache` is cleared.

The depth button is disabled while the ghosts are off, for the reason the frame
buttons are: a live control that changes nothing you can see is the same lie.

## The Godot target writes source, not an image

`core/targets/godot.js` is the odd one out and meant to be. The other four hand
over a PNG — adenosine, magnolia and texastoast read a uniform-grid sheet, and
GameMaker takes the frames apart. This one emits **C# source** that rebuilds the
texture at runtime, because a `.forge` frame is already rows of characters
indexing a colour key and that transliterates straight into C#.

Three things that buys a Godot project, and they are the reason not to "fix" it
into writing a PNG:

- **No `.import` file.** Godot generates one the first time it sees an image, in
  the editor. Source is compiled with everything else, so a fresh clone runs
  without opening the editor first.
- A recolour stays a one-line diff, the same as it is in the `.forge`.
- A game whose rule is that nothing loads from disk keeps it. very-long-boards
  says exactly that about its procedural textures; this is what let its
  character art land without making an exception of itself.

**One frame.** A texture is one image and there is no sheet here to slice. More
frames export the first and warn; an animation wants a sheet target and
`AnimatedTexture` at the other end.

The decoder (`ForgeArt.cs`) is emitted alongside the art, once per export rather
than once per sprite. A project that got the art and not the decoder does not
compile, and sending someone to find the other file is a worse failure than
rewriting one they already have — it is byte-identical every time.

`store.js` lists `godot` beside `gamemaker` rather than taking it from
`engines.kinds()`, because neither takes a sheet. `tests/targets-store.test.mjs`
asserts the exact set of five, so a sixth is a deliberate edit to a test.

The generated art carries only a short doc comment. Anything worth saying about
a *particular* piece of art — why Carl's face is a tint map, why the deck
material needs `Uv1Offset` — belongs in the consuming repo's own copy or the
code that uses it, because a generator cannot know it and a re-export would
throw it away.

## The UV layouts in core/mesh.js are copied, not invented

`core/mesh.js` exists because a texture is the one sprite the canvas cannot show you. A face
drawn in the middle of a 64×32 image lands on the **back** of a sphere, because an engine's
sphere unwrap puts `u = 0` on `+Z`. No zoom level hints at it, and the mistake survives all
the way into the game. `ui/mesh-ui.js` is the window onto it, in the dock beside the
animation preview, in both tiers — a preview needs no filesystem, so it earns no tier row.

**Every layout here is some engine's own formula, and each one is checked against a render
from that engine before it ships.** The two present were verified against Godot 4.7.1 by
texturing its own `SphereMesh` and `CylinderMesh` with a calibration image — red ramping
with u, green ramping with v, blue flagging the top half — and reading the pixels back:

- **sphere** — `v = 0` is the top pole, `u = 0` lies on `+Z`, and the seam column is
  duplicated at `u = 1`. A 2:1 image is the only aspect that wraps unstretched.
- **cylinder** — the side is the **top half** of the image only; the two end caps are packed
  into the bottom half. Half the canvas never appears on the side. The caps are deliberately
  not drawn: a limb is never seen end-on, and a guessed cap would be a confident lie about
  half the image.

A plausible-looking wrong layout is worse than no preview, because it is wrong in exactly
the place someone went looking for the truth. If you add a shape, calibrate it the same way
rather than reasoning it out — an earlier pass predicted a lighting crease down a face at 8
segments from flat-shaded reasoning, and the engine renders no such thing, because Godot
gives `SphereMesh` smooth vertex normals. **That is why `render()` shades from interpolated
vertex normals and uses the face normal only for back-face culling.**

The offset control is a **view** offset and rewrites no pixels. The fix for a misplaced face
belongs in the material (`uv1_offset`) or in TRANSFORM's wrapping shift; baking it into the
preview would make the export disagree with the canvas. It reads in texels so the number can
be typed into either — 32 on a 64-wide sphere map is `uv1_offset = 0.5`.

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

## An export into a folder that is gone SUCCEEDS

That is the reason `targets-ui.js` asks the disk before each of its three
exports. `magma_kit::fs::write_in_root` calls `create_dir_all` on the parent, so
a root that has been moved or deleted is rebuilt out of nothing, the sheet lands
in it, and the panel reports every file it wrote. Nothing is wrong with the
sprite, the plan or the write — the export is simply into a directory no game
reads, and there is no error anywhere to notice.

It is not hypothetical, and it is not the user's mistake either. Every target is
a folder chosen from a dialog, so it existed when it was added; what makes one
stop existing is the **repo moving**. This desk's own `targets.json` still named
`C:/magma/dev/moonlight-drift/wii`, from before the games moved under
`magmacrunch/games/`, and three of the five export kinds would have quietly
served it.

So `stillThere()` refuses, and names the path rather than saying "could not
export" — the path is the news, and a generic message sends you looking at the
sprite. `checkRoots()` is the advance warning that marks the row rose; it is
only a mark, and the export re-asks, which is why a target on a drive that was
unplugged and is back needs no reload and why the button stays enabled on a
marked row. `tests/targets-ui.test.mjs` pins all three refusals, and it is the
second ui/ file with tests for the same reason `project-ui.js` was the first:
what to do when something will not work is logic, not DOM.

GameMaker was the near-miss that makes the case. It reads the `.yyp` before it
plans, so a missing root already failed there — with "could not read the
project", which is the wrong sentence about the right problem.

## A sibling repo is in one of two places

Two files reach outside this repo for a real fixture, and each tries the flat
sibling first and then the grouped location:

| | |
|---|---|
| `tests/gamemaker.test.mjs` | `../transatlantic_colleague`, then `../../games/transatlantic_colleague` |
| `scripts/import-moonlight-drift.mjs` | `../moonlight-drift`, then `../../games/moonlight-drift` |

A bare clone gets the first; this tree has the second, because the apps and the
games are separate directories under `magmacrunch/`. Both are overridable —
`SPRITE_FORGE_TC` and `--drift`. The same pattern as the magnolia games' Wii
Makefiles and texas-holdem-lava-dome's `js_oracle.mjs`, and for the same reason.

Each had only the flat path, written when the tree was flat, and **the two
failed differently in a way worth knowing apart.** The script threw its own
"is --drift pointing at a moonlight-drift checkout?" at a checkout that was
right there — loud, and wrong about the cause. The test suite printed a skip,
which is indistinguishable from the hermetic pass it is *supposed* to give a
machine with no copy of the game, so five oracle tests — the ones that hold the
GameMaker port to the output of the Python script it was ported from — sat dead
from the reorganisation until 2026-09-13 and the tally never dropped. The skip
now names every path it looked at, for exactly that reason.

`tests/gamemaker.test.mjs` also resolved from `process.cwd()` rather than from
its own location, which is a second way to the same silence: `node
tests/run.mjs` from anywhere but the repo root skipped. Everything else under
`tests/` uses `import.meta.url`; so does this now.

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

tauri-action drives the build as `npm run tauri build`, so `desktop/package.json`
needs a `tauri` script even though `build` already exists and says the same
thing. Deleting it as redundant is a red release and a green local build, which
is the worst combination; the file says so next to the script.

`npm run check` has to stay hermetic for the same reason. It is the release
gate, and anything it reaches for outside the repo passes here and fails on a
runner — `tests/gamemaker.test.mjs` did exactly that, failing rather than
skipping when transatlantic_colleague was not beside the checkout. Test a
change to the suite against `git archive HEAD` in an empty directory, not
against this desk.

Both halves of that, though: hermetic **and** actually running here. The fix for
the failure was a skip, and the skip then covered for a stale path for weeks —
see "A sibling repo is in one of two places" above. The empty directory should
report the skip; this desk should report 284 and no skip line at all.

The workflow checks out `magmacrunch-media/magma-kit` as a named sibling,
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
