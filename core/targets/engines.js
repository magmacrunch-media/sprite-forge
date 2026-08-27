// engines.js — the three sheet-consuming targets: adenosine, magnolia, texastoast.
//
// All three read the same uniform-grid PNG (see core/sheet.js), so none of them
// needs the per-frame surgery GameMaker does. What differs is only where the
// file goes and what the call to load it looks like — so they share one planner
// and differ by a small descriptor.
//
// The load snippet matters more than it looks. The origin is NOT stored in the
// PNG; it travels with the load call. A sheet exported without its origin
// written down somewhere is a sprite whose feet are in the wrong place, and the
// snippet is where that number survives the trip out of the editor.
//
// Pure, like the rest of core/: returns a plan of {path, frames|frame} writes
// plus the snippet. The shell encodes and writes.

window.SpriteForge = window.SpriteForge || {};
window.SpriteForge.targets = window.SpriteForge.targets || {};
window.SpriteForge.targets.engines = (function () {

    const ENGINES = {
        adenosine: {
            label: 'adenosine (browser)',
            // A game's own assets directory; adenosine has no prescribed layout,
            // so this is the convention the arcade games already use.
            dir: 'assets/sprites',
            snippet: ({ file, w, h, ox, oy }) =>
                `loadSpriteSheet('${file}', { frameWidth: ${w}, frameHeight: ${h}, ` +
                `originX: ${ox}, originY: ${oy} });`,
        },
        magnolia: {
            label: 'magnolia (Wii)',
            // magnolia embeds a game's sprites/ via bin2s at build time.
            dir: 'sprites',
            snippet: ({ file, ox, oy }) =>
                `sprite_load(&s, "${file}", ${ox}, ${oy});`,
        },
        texastoast: {
            label: 'texastoast (Python)',
            dir: 'assets/sprites',
            // SpriteSheet takes no origin — it slices only. The origin is the
            // caller's to apply at draw time, so it is carried in a comment
            // rather than silently dropped.
            snippet: ({ file, w, h, ox, oy }) =>
                `SpriteSheet('${file}', ${w}, ${h})   # origin (${ox}, ${oy}) — apply at draw time`,
        },
    };

    function kinds() {
        return Object.entries(ENGINES).map(([id, e]) => ({ id, label: e.label }));
    }

    /**
     * Plans the write for one sprite as a single sheet PNG.
     *
     * @param kind   'adenosine' | 'magnolia' | 'texastoast'
     * @param name   sprite name, used as the filename stem
     * @param frames pixel grids
     * @param w, h   frame size
     * @param originX, originY
     * @param cols   optional column count; default is one row
     * @param dir    optional override for the destination directory
     * @returns {{ writes: Array<{path, frames, w, h, cols}>, snippet: string, warnings: string[] }}
     */
    function plan({ kind, name, frames, w, h, originX, originY, cols, dir }) {
        const engine = ENGINES[kind];
        if (!engine) throw new Error(`unknown engine target "${kind}"`);
        if (!frames || !frames.length) throw new Error(`${name}: no frames`);

        frames.forEach((f, i) => {
            if (f.length !== h || f.some(row => row.length !== w))
                throw new Error(`${name}: frame ${i} is not ${w}x${h}`);
        });

        const warnings = [];
        if (originX < 0 || originX > w || originY < 0 || originY > h)
            warnings.push(`${name}: origin (${originX},${originY}) is outside the ${w}x${h} frame`);

        const file = `${name}.png`;
        const path = `${dir || engine.dir}/${file}`;
        return {
            writes: [{ path, frames, w, h, cols: cols || frames.length }],
            snippet: engine.snippet({ file, w, h, ox: originX, oy: originY }),
            warnings,
        };
    }

    /** Every sprite in a project, planned for one engine. */
    function planProject({ kind, project, cols, dir }) {
        const writes = [], snippets = [], warnings = [];
        for (const s of project.sprites) {
            const p = plan({
                kind, name: s.name, frames: s.frames, w: s.w, h: s.h,
                originX: s.origin.x, originY: s.origin.y, cols, dir,
            });
            writes.push(...p.writes);
            snippets.push(p.snippet);
            warnings.push(...p.warnings);
        }
        return { writes, snippet: snippets.join('\n'), warnings };
    }

    return { kinds, plan, planProject, ENGINES };
})();
