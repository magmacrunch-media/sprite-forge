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

Under construction. The editor works; the desktop shell around it does not exist
yet.

- [x] Editor: tools, palette, shade ramps, frames, onion skin, animation preview
- [x] Character templates with named, recolourable slots
- [x] PNG sheet import and export
- [x] `core/` extracted from the DOM layer, so a desktop build can share it
- [ ] Tauri shell: Open / Save / Save As
- [ ] `.forge` project files
- [ ] Multi-sprite projects over one shared palette
- [ ] Export targets that write into a game repo
- [ ] Reduced web build synced to magmacrunch.com

## Running it

No build step. Serve the repo root and open `/ui/`:

```bash
npx serve . -l 3300
```

Then <http://localhost:3300/ui/>. It is a desktop-sized tool and says so below
about 900px.

## Layout

| | |
|---|---|
| `core/` | pure logic — colour and shade ramps, shape rasterisation, the sheet codec, templates |
| `ui/` | the DOM layer: canvas, widgets, editor state |
| `shell/`, `fonts/` | vendored app shell from magmacrunch.com |

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
