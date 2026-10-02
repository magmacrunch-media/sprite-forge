# SPRITE//FORGE

Pixel-art sprite and animation editor, built to draw the sprites that go into
[adenosine](https://github.com/magmacrunch-media/adenosine) (browser),
[magnolia](https://github.com/magmacrunch-media/magnolia) (Wii),
[texastoast](https://github.com/magmacrunch-media/texastoast) (Python) and
GameMaker.

Draw a frame, flip through an animation, recolour a character by the *name* of
the part rather than by hunting hexes, and export a uniform-grid PNG sheet all
four engines read.

## Status

The editor works, installs as a desktop app on Windows and macOS, and runs
reduced in a browser at
[magmacrunch.com/ware/sprite-forge](https://magmacrunch.com/ware/sprite-forge/).

- [x] Editor: tools, palette, shade ramps, frames, onion skin, animation preview
- [x] Character templates with named, recolourable slots
- [x] Colour themes - 41 vendored from magma//ops, plus your own
- [x] PNG sheet import and export
- [x] `core/` extracted from the DOM layer, so a desktop build can share it
- [x] `.forge` project files — readable, diffable, round-trip tested
- [x] Export planners for GameMaker, adenosine, magnolia and texastoast
- [x] Godot target - writes C# source rather than a PNG, so nothing needs importing
- [x] Tauri shell and the Open / Save / Save As panel - 3.3 MB binary
- [x] Windows installers - per-user NSIS (1.2 MB) and MSI (1.8 MB)
- [x] Multi-sprite projects over one shared palette
- [x] A targets panel - export lands in a game repo, all five targets
- [x] Reduced web build synced to magmacrunch.com
- [x] macOS build — one universal `.dmg`, Apple Silicon and Intel
- [x] Surface preview — the frame wrapped onto a sphere, cylinder or billboard
- [x] `.forge` save and open in the browser build, so a refresh stops costing you the work
- [x] Rectangular selection — move, cut, copy, paste, and a clipboard that
      follows you between sprites
- [x] Frame reordering — two buttons, `Shift`+`[` / `]`, or drag a frame in the
      sheet strip
- [x] Rotation at any frame size — turns the sprite, the dimensions and the
      origin together, so a 16×24 is no longer a sprite that cannot be turned
- [x] Per-frame hold — keep one pose up for several beats, marked on the sheet
      strip and carried in the `.forge`
- [x] Onion skin with depth — up to four frames each way, tinted rose behind and
      cyan ahead, wrapping round the loop

## Three tiers, one codebase

The same `app/` directory is the page on magmacrunch.com, the desktop bundle
and the installable PWA. Which of it you get is decided at load, by what kind
of filesystem is behind the page, and
[`app/core/tier.js`](app/core/tier.js) turns that into the table below.

| Tier | Behind it | Where |
|---|---|---|
| LITE | nothing | a plain tab, and any browser without the File System Access API, iOS Safari included |
| DISK | [`app/ui/fsa.js`](app/ui/fsa.js), real files through picked handles | the installable PWA, and any Chromium tab |
| FULL | Tauri, a path-keyed filesystem and a window | the desktop build |

DISK exists because `projects` was never really about Rust. Saving back to the
file you opened needs a handle you can keep, which a browser has had since the
File System Access API; what it still has not got is a directory it can hold
across sessions plus a per-machine config file, which is TARGETS, or a window,
which is the menu bar. So one row moved and two did not.

| | LITE | DISK | FULL |
|---|---|---|---|
| Tools, palette, shade ramps, REPLACE | yes | yes | yes |
| Frames, onion skin, animation preview | yes | yes | yes |
| Surface preview — sphere, cylinder, billboard | yes | yes | yes |
| Character templates with named slots | yes | yes | yes |
| Multi-sprite projects over one palette | yes | yes | yes |
| Colour themes | yes | yes | yes |
| Transform, origin, canvas resize, undo | yes | yes | yes |
| PNG sheet import and export | yes | yes | yes |
| `.forge` project files — save one out, open one back | yes | yes | yes |
| New / Open / Save / Save As against a path, and the dirty marker | — | yes | yes |
| TARGETS — export straight into a game repo | — | — | yes |
| The menu bar | — | — | yes |

A row earns its tier by needing something that tier has. That is the only
reason a row is allowed above LITE: every tier is a strict upgrade on the one
below, never a lower build made worse so a higher one looks better.

Note where the `.forge` line falls. Saving a project out and opening one back
are a download and a file picker — no disk, no window — so even LITE has them,
and a refresh no longer costs you the work. What needs a real file is saving to
*the path you opened*, which is the row below it, and that is the row DISK
exists to serve.

### The PWA runs at DISK

So an installed PWA has New, Open, Save and Save As against a real file, and
the dirty marker that goes with them. The sidebar's SAVE and OPEN buttons and
the Ctrl+S / Ctrl+O / Ctrl+N shortcuts are wired in every tier and dispatch by
capability, so none of that needed new UI; the File menu is still FULL only,
because the menu bar is.

What the browser cannot give back is the path. The API hands out handles and
never discloses a location, so the doc name shows the file's name and its
tooltip cannot show more. The first save of a session asks where, and every
save after it is silent, which is the API's rule rather than a choice.

### Assembling the PWA

```
npm run pwa          # assemble into pwa/dist
npm run check:pwa    # validate coverage, write nothing
npm run serve:pwa    # preview it on localhost:3301
```

[`scripts/package-pwa.mjs`](scripts/package-pwa.mjs) assembles a standalone,
installable copy into `pwa/dist` (gitignored). It is a third assembler beside
`sync-web.mjs` rather than a flag on it, because the two resolve the shared
parts in opposite directions: the website build leaves `../shell/` and
`../fonts/` alone so they land on the website's own copies, and this one
carries both and rewrites the paths down a level. That makes the PWA much
closer to the Tauri bundle than to the website page.

Served from its own origin, deliberately, so a Store listing's uptime does not
depend on the machine serving magmacrunch.com. Every path in
[`pwa/manifest.json`](pwa/manifest.json) is relative, so the same bundle works
from any origin and from a local preview.

Two things are generated rather than kept by hand, and both are in `pwa/sw.js`
as tokens that `package-pwa.mjs` substitutes: the precache list, derived from
the tree that actually shipped, and the cache name, a digest of those files'
contents. A changed build therefore gets a new cache with nothing bumped by
hand. The worker does not call `skipWaiting`, because taking over a page that
holds unsaved frames is worse than a cache that is one session stale.

The build refuses rather than warns. A `<script>` added to `index.html` and not
to the copy list is a bundle that 404s in a window with no devtools open, so
coverage is checked at assembly time and again in the suite.

## Installing it

Grab an installer from
[releases](https://github.com/magmacrunch-media/sprite-forge/releases) — Windows
x64, and one macOS `.dmg` that runs natively on both Apple Silicon and Intel.
Every release lists SHA-256 checksums.

The bundles are **not code-signed**, so both systems will object the first time:

- **Windows** — SmartScreen says *"Windows protected your PC"* and hides the
  button. **More info → Run anyway.**
- **macOS** — Gatekeeper is blunter, and on Apple Silicon it usually claims the
  app *"is damaged and can't be opened"*, which is not true and is simply what
  an unsigned quarantined bundle looks like. Drag it to Applications, then
  either open **System Settings → Privacy & Security** and click **Open
  Anyway**, or clear the quarantine flag directly:

  ```bash
  xattr -dr com.apple.quarantine "/Applications/SPRITE FORGE.app"
  ```

  The quotes matter — the bundle name has a space in it.

Releases are built by GitHub Actions on both platforms — see
[`.github/workflows/release.yml`](.github/workflows/release.yml), which has to
check out magma-kit alongside this repo for the same reason you do.

## Running it

No build step. Serve the repo root and open `/ui/`:

```bash
npx serve app -l 3300
```

Then <http://localhost:3300/ui/>. It is a desktop-sized tool and says so below
about 900px. Run the tests with `npm test` — no dependencies, plain node.

That is the LITE build. To publish it:

```bash
npm run check:web
```

`check:web` reports what a sync would change; `npm run sync-web` does it,
copying into `../website/ware/sprite-forge/` (pass another path if your
website checkout is elsewhere). Commit the result in the website repo —
GitHub Pages serves that tree directly.

### The desktop build

Needs a Rust toolchain and, on Windows, the MSVC linker. WebView2 ships with
Windows 11, so there is nothing else to install.

```bash
winget install -e --id Rustlang.Rustup
```

Then the C++ toolchain. With Visual Studio already installed, add the two
components to it from an **elevated** shell — the installer refuses `--quiet`
otherwise, and exits 0 having done nothing:

```bash
& "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\setup.exe" modify --installPath "C:\Program Files\Microsoft Visual Studio\18\Community" --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --add Microsoft.VisualStudio.Component.Windows11SDK.26100 --quiet --norestart
```

Note `Microsoft.VisualStudio.Workload.VCTools` belongs to the standalone Build
Tools product and is **not** in Visual Studio Community's product graph —
asking for it also exits 0 and does nothing. Without Visual Studio, install
`Microsoft.VisualStudio.2022.BuildTools` with the `VCTools` workload instead.

Then:

```bash
cd desktop && npm install && npm run dev
```

Tauri cannot cross-compile: a `.msi` must be built on Windows and a `.dmg` on a
Mac. That is the whole reason `.github/workflows/release.yml` exists — a GitHub
runner is the only route to a Mac bundle from a Windows desk, and once macOS
has to come through there it is worth building Windows there too, so both
halves of a release come from the same place.

magma-kit must be checked out as a sibling directory: the Rust crate is a path
dependency at `../../../magma-kit/crate`, and `npm run check:kit` needs it too.

## Layout

| | |
|---|---|
| `app/core/` | pure logic — colour and shade ramps, shape rasterisation, the sheet codec, the .forge format, the UV layouts and their renderer, export planners |
| `app/ui/` | the DOM layer: canvas, widgets, editor state |
| `app/shell/`, `app/fonts/` | vendored app shell from magmacrunch.com |
| `desktop/` | the Tauri shell |
| `tests/` | node tests for `app/core/` |
| `scripts/` | re-vendor the magma//ops colour themes; sync the LITE build to the website |
| `.github/` | the two-platform release build |

Everything the shipped app loads lives under `app/`, because that directory is
Tauri's `frontendDist` and gets embedded whole.

`core/` has no DOM, no filesystem and no engine dependencies, which is what lets
the desktop build, the web demo and the export targets share it. See
[AGENTS.md](AGENTS.md) for load order and the rules that are load-bearing.

## The sheet format

Uniform grid: `frameWidth` × `frameHeight` cells, left-to-right then
top-to-bottom. The origin is passed at load time and never stored in the PNG.

```c
sprite_load(&s, "spr_player_walk_down.png", 8, 24);          // magnolia
```
```python
SpriteSheet('spr_player_walk_down.png', 16, 24)              # texastoast
```
```ts
loadSpriteSheet(src, { frameWidth: 16, frameHeight: 24, originX: 8, originY: 24 })
```

This is a shared contract across four repos, specified in adenosine's
`packages/rpg/API.md`. It is not this repo's to change unilaterally.

## Support This Project

If you find sprite-forge useful, consider supporting its development:

[![Sponsor](https://img.shields.io/badge/%E2%9D%A4_Sponsor-pink)](https://github.com/sponsors/magmacrunch-media)
[![PayPal](https://img.shields.io/badge/Donate-PayPal-blue)](https://www.paypal.biz/magmacrunchmedia)

## Licence

[PolyForm Noncommercial 1.0.0](LICENSE) — SPDX `PolyForm-Noncommercial-1.0.0`.

Free for personal, hobby, educational and research use. Commercial use needs a
licence from magmacrunch media LLC; get in touch.

This sits with the games rather than with the engines. adenosine and magnolia
are Apache because they exist to be built on; an editor is a product, and
Apache would hand anyone the right to sell a re-skin of it.
