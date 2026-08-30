# SPRITE//FORGE

Pixel-art sprite and animation editor, built to draw the sprites that go into
[adenosine](https://github.com/magmacrunchmedia/adenosine) (browser),
[magnolia](https://github.com/magmacrunchmedia/magnolia) (Wii),
[texastoast](https://github.com/magmacrunchmedia/texastoast) (Python) and
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
- [x] Tauri shell and the Open / Save / Save As panel - 3.3 MB binary
- [x] Windows installers - per-user NSIS (1.2 MB) and MSI (1.8 MB)
- [x] Multi-sprite projects over one shared palette
- [x] A targets panel - export lands in a game repo, all four engines
- [x] Reduced web build synced to magmacrunch.com
- [x] macOS build — one universal `.dmg`, Apple Silicon and Intel

## Two builds, one codebase

The same `app/` directory is both the page on magmacrunch.com and the desktop
bundle. Which half you get is decided at load: with no Tauri behind it there is
no filesystem, and [`app/core/tier.js`](app/core/tier.js) turns that one
boolean into the table below.

| | LITE (web) | FULL (desktop) |
|---|---|---|
| Tools, palette, shade ramps, REPLACE | yes | yes |
| Frames, onion skin, animation preview | yes | yes |
| Character templates with named slots | yes | yes |
| Multi-sprite projects over one palette | yes | yes |
| Colour themes | yes | yes |
| Transform, origin, canvas resize, undo | yes | yes |
| PNG sheet import and export | yes | yes |
| `.forge` project files — New / Open / Save / Save As | — | yes |
| TARGETS — export straight into a game repo | — | yes |
| The menu bar | — | yes |

The three desktop-only rows each need a filesystem or a window. That is the
only reason a row is allowed there: LITE is a strict upgrade on what the web
tool could already do, never the desktop build made to look better by taking
something away from it.

## Installing it

Grab an installer from
[releases](https://github.com/magmacrunchmedia/sprite-forge/releases) — Windows
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
| `app/core/` | pure logic — colour and shade ramps, shape rasterisation, the sheet codec, the .forge format, export planners |
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

## Licence

[PolyForm Noncommercial 1.0.0](LICENSE) — SPDX `PolyForm-Noncommercial-1.0.0`.

Free for personal, hobby, educational and research use. Commercial use needs a
licence from magmacrunch media LLC; get in touch.

This sits with the games rather than with the engines. adenosine and magnolia
are Apache because they exist to be built on; an editor is a product, and
Apache would hand anyone the right to sell a re-skin of it.
