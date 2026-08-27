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

Under construction. The editor works and installs as a desktop app; what is
missing is the multi-sprite and export-target work above the drawing surface.

- [x] Editor: tools, palette, shade ramps, frames, onion skin, animation preview
- [x] Character templates with named, recolourable slots
- [x] Colour themes - 41 vendored from magma//ops, plus your own
- [x] PNG sheet import and export
- [x] `core/` extracted from the DOM layer, so a desktop build can share it
- [x] `.forge` project files — readable, diffable, round-trip tested
- [x] Export planners for GameMaker, adenosine, magnolia and texastoast
- [x] Tauri shell and the Open / Save / Save As panel - 3.3 MB binary
- [x] Windows installers - per-user NSIS (1.2 MB) and MSI (1.8 MB)
- [ ] Multi-sprite projects over one shared palette
- [x] A targets panel - export lands in a game repo, all four engines
- [ ] Reduced web build synced to magmacrunch.com

## Running it

No build step. Serve the repo root and open `/ui/`:

```bash
npx serve app -l 3300
```

Then <http://localhost:3300/ui/>. It is a desktop-sized tool and says so below
about 900px. Run the tests with `npm test` — no dependencies, plain node.

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
Mac.

## Layout

| | |
|---|---|
| `app/core/` | pure logic — colour and shade ramps, shape rasterisation, the sheet codec, the .forge format, export planners |
| `app/ui/` | the DOM layer: canvas, widgets, editor state |
| `app/shell/`, `app/fonts/` | vendored app shell from magmacrunch.com |
| `desktop/` | the Tauri shell |
| `tests/` | node tests for `app/core/` |
| `scripts/` | re-vendor the magma//ops colour themes |

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
