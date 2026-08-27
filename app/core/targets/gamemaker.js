// gamemaker.js — plan the writes that put a sprite into a GameMaker project.
//
// A port of transatlantic_colleague/tools/import_sprite_sheet.py. That script
// stays in its own repo as the app-free, reproducible importer; this exists so
// the editor can do the same thing directly, and the two are kept honest by
// running `python tools/import_sprite_sheet.py --check` after an export here
// and expecting "up to date".
//
// GameMaker wants something quite different on disk from a sheet:
//
//     sprites/<spr>/<frame-guid>.png                      <- the frame
//     sprites/<spr>/layers/<frame-guid>/<layer-guid>.png  <- an identical copy
//
// BOTH must exist and match. A missing layers/ copy is the classic cause of a
// sprite that looks correct on disk and renders blank in the IDE.
//
// Pure: takes the .yy text and the frames, returns a plan. It never encodes a
// PNG or touches a filesystem — writes name a frame index and the shell encodes
// it, which is what keeps this testable without a canvas and identical between
// the desktop build and the web demo.

window.SpriteForge = window.SpriteForge || {};
window.SpriteForge.targets = window.SpriteForge.targets || {};
window.SpriteForge.targets.gamemaker = (function () {

    // GUIDs are read out of the existing .yy, never invented, so a sprite slot
    // keeps its identity and nothing has to be re-registered in the .yyp.
    const FRAME_GUID_RE = /\{"\$GMSpriteFrame":"v1","%Name":"([0-9a-fA-F-]{36})"/g;
    const LAYER_GUID_RE = /\{"\$GMImageLayer":"","%Name":"([0-9a-fA-F-]{36})"/g;

    function readGuids(yyText, spriteName) {
        const frames = [...yyText.matchAll(FRAME_GUID_RE)].map(m => m[1]);
        const layers = [...yyText.matchAll(LAYER_GUID_RE)].map(m => m[1]);
        if (!frames.length)
            throw new Error(`${spriteName}: no frames found in .yy`);
        if (layers.length !== 1)
            throw new Error(`${spriteName}: expected exactly 1 image layer, found ${layers.length}`);
        return { frameGuids: frames, layerGuid: layers[0] };
    }

    /**
     * Rewrites the size/origin/bbox fields, touching nothing else.
     *
     * Deliberately a line-level edit rather than JSON.parse/stringify:
     * GameMaker writes JSON with trailing commas (,} and ,]) that a round trip
     * will not reproduce, so a parse-and-rewrite reformats the entire file and
     * buries the real change in a few hundred lines of noise.
     *
     * Returns the new text, or null if nothing changed.
     */
    function patchYy(yyText, { w, h, originX, originY }) {
        // bboxMode 0 = auto: GameMaker recomputes the box from the pixels.
        const fields = {
            width: w, height: h,
            bboxMode: 0,
            bbox_left: 0, bbox_top: 0,
            bbox_right: w - 1, bbox_bottom: h - 1,
            xorigin: originX, yorigin: originY,
        };
        let text = yyText;
        for (const [key, value] of Object.entries(fields)) {
            // Anchored at line start so "width" cannot match "backdropWidth".
            //
            // String.raw, not a plain template literal: in a template literal
            // \s and \d are non-escapes that collapse to bare "s" and "d", so
            // the pattern silently becomes ..."width":s*-?d+, and matches
            // nothing. It fails by changing the file not at all, which looks
            // exactly like "already up to date".
            const re = new RegExp(
                String.raw`^([ \t]*)"` + key + String.raw`":\s*-?\d+,`, 'gm');
            text = text.replace(re, `$1"${key}":${value},`);
        }
        return text === yyText ? null : text;
    }

    /**
     * Plans every write for one sprite.
     *
     * @param yyText   contents of sprites/<spr>/<spr>.yy
     * @param spriteName  e.g. "spr_player_walk_down"
     * @param frames   array of pixel grids, the editor's own representation
     * @param w, h     frame size
     * @param originX, originY
     * @returns {{ yy: {path,text}|null, writes: Array<{path,frame}>, warnings: string[] }}
     */
    function plan({ yyText, spriteName, frames, w, h, originX, originY }) {
        const { frameGuids, layerGuid } = readGuids(yyText, spriteName);
        const warnings = [];

        // Refuse rather than guess: dropping or padding frames silently is how
        // a walk cycle ends up one frame short in the game and nowhere else.
        if (frameGuids.length !== frames.length)
            throw new Error(
                `${spriteName}: .yy declares ${frameGuids.length} frames, ` +
                `the sprite has ${frames.length}. Fix one of them rather than ` +
                `dropping frames silently.`);

        frames.forEach((f, i) => {
            if (f.length !== h || f.some(row => row.length !== w))
                throw new Error(`${spriteName}: frame ${i} is not ${w}x${h}`);
        });

        if (originX < 0 || originX > w || originY < 0 || originY > h)
            warnings.push(
                `${spriteName}: origin (${originX},${originY}) is outside the ${w}x${h} frame`);

        const dir = `sprites/${spriteName}`;
        const writes = [];
        frameGuids.forEach((guid, i) => {
            writes.push({ path: `${dir}/${guid}.png`, frame: i });
            writes.push({ path: `${dir}/layers/${guid}/${layerGuid}.png`, frame: i });
        });

        const patched = patchYy(yyText, { w, h, originX, originY });
        return {
            yy: patched ? { path: `${dir}/${spriteName}.yy`, text: patched } : null,
            writes,
            warnings,
        };
    }

    /**
     * Which sprite folders a GameMaker project holds, from its .yyp text.
     * Used to populate the target picker rather than making the user type names.
     */
    function spriteNames(yypText) {
        return [...yypText.matchAll(/"path":"sprites\/([^/]+)\/\1\.yy"/g)]
            .map(m => m[1])
            .filter((v, i, a) => a.indexOf(v) === i)
            .sort();
    }

    return { plan, patchYy, readGuids, spriteNames };
})();
