// project.js — the .forge file: a whole project in, a whole project out.
//
// JSON, and deliberately diffable, because these files get checked into game
// repos next to the art they produce. Frames are rows of single characters
// indexing a shared key, the same encoding core/templates.js uses and for the
// same stated reason: a recolour should be a one-line diff, not a rewritten
// blob, and a reviewer should be able to see the sprite in the file.
//
// The key is shared across every sprite in the project rather than per-sprite,
// so a character's eight facings cannot drift onto different palettes.
//
// Pure: no DOM, no filesystem, no canvas. The shell reads and writes the bytes.

window.SpriteForge = window.SpriteForge || {};
window.SpriteForge.project = (function () {

    const FORMAT = 'sprite-forge/1';

    // '.' is reserved for transparent. Quote and backslash are excluded so a
    // row never needs escaping inside JSON, which would defeat the point of a
    // readable diff.
    const ALPHABET =
        'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+-*/#$%&@!?<>[]{}()~^=_,;:|';
    const TRANSPARENT = '.';

    /** A project with one empty sprite, for File > New. */
    function blank(w, h, palette) {
        return {
            palette: [...palette],
            slots: null,
            template: null,
            sprites: [newSprite('sprite', w, h, palette)],
        };
    }

    function newSprite(name, w, h) {
        return {
            name,
            w, h,
            origin: { x: 0, y: 0 },
            fps: 8,
            frames: [Array.from({ length: h }, () => Array(w).fill(null))],
        };
    }

    /**
     * Project -> plain object ready for JSON.stringify.
     *
     * The key is built from the colours actually present in the pixels, unioned
     * with the palette. Harvesting from pixels alone would drop an unused
     * swatch the user deliberately mixed; taking the palette alone would drop a
     * colour that reached the canvas by import or REPLACE and never entered it.
     */
    function serialize(p) {
        const seen = new Set(p.palette);
        for (const s of p.sprites)
            for (const f of s.frames)
                for (const row of f)
                    for (const px of row) if (px) seen.add(px);

        const colors = [...seen];
        if (colors.length > ALPHABET.length)
            throw new Error(
                `project uses ${colors.length} colours; the .forge key holds ${ALPHABET.length}`);

        const key = {}, charOf = {};
        colors.forEach((hex, i) => { key[ALPHABET[i]] = hex; charOf[hex] = ALPHABET[i]; });

        return {
            format: FORMAT,
            palette: [...p.palette],
            slots: p.slots ? { ...p.slots } : null,
            template: p.template || null,
            key,
            sprites: p.sprites.map(s => ({
                name: s.name,
                w: s.w, h: s.h,
                origin: [s.origin.x, s.origin.y],
                fps: s.fps,
                frames: s.frames.map(f =>
                    f.map(row => row.map(px => (px ? charOf[px] : TRANSPARENT)).join(''))),
            })),
        };
    }

    /**
     * Returns a list of problems; empty means the object is a well-formed
     * project. Every message names the sprite and, where it applies, the frame
     * and row — a hand-edited .forge should say which line is wrong rather than
     * throwing somewhere downstream.
     */
    function validate(o) {
        const errs = [];
        if (!o || typeof o !== 'object') return ['not an object'];
        if (o.format !== FORMAT) errs.push(`format is ${JSON.stringify(o.format)}, expected "${FORMAT}"`);
        if (!Array.isArray(o.sprites) || !o.sprites.length) errs.push('no sprites');
        if (o.key && typeof o.key !== 'object') errs.push('key is not an object');

        const key = o.key || {};
        for (const [ch, hex] of Object.entries(key)) {
            if (ch.length !== 1) errs.push(`key ${JSON.stringify(ch)} is not a single character`);
            if (ch === TRANSPARENT) errs.push(`key uses "${TRANSPARENT}", which is reserved for transparent`);
            if (!/^#[0-9a-fA-F]{6}$/.test(hex)) errs.push(`key '${ch}' is ${JSON.stringify(hex)}, not a #rrggbb colour`);
        }

        (o.sprites || []).forEach((s, si) => {
            const at = s && s.name ? `sprite "${s.name}"` : `sprite ${si}`;
            if (!s || typeof s !== 'object') { errs.push(`${at}: not an object`); return; }
            if (!Number.isInteger(s.w) || s.w < 1) errs.push(`${at}: w is ${JSON.stringify(s.w)}`);
            if (!Number.isInteger(s.h) || s.h < 1) errs.push(`${at}: h is ${JSON.stringify(s.h)}`);
            if (!Array.isArray(s.origin) || s.origin.length !== 2)
                errs.push(`${at}: origin is ${JSON.stringify(s.origin)}, expected [x, y]`);
            if (!Array.isArray(s.frames) || !s.frames.length) { errs.push(`${at}: no frames`); return; }

            s.frames.forEach((f, fi) => {
                if (!Array.isArray(f)) { errs.push(`${at} frame ${fi}: not an array of rows`); return; }
                if (f.length !== s.h) errs.push(`${at} frame ${fi}: ${f.length} rows, expected ${s.h}`);
                f.forEach((row, y) => {
                    if (typeof row !== 'string') { errs.push(`${at} frame ${fi} row ${y}: not a string`); return; }
                    if (row.length !== s.w)
                        errs.push(`${at} frame ${fi} row ${y}: ${row.length} chars, expected ${s.w}`);
                    for (const ch of row)
                        if (ch !== TRANSPARENT && !(ch in key))
                            errs.push(`${at} frame ${fi} row ${y}: unknown key '${ch}'`);
                });
            });
        });
        return errs;
    }

    /** Plain object -> project. Throws with every problem listed, not just the first. */
    function deserialize(o) {
        const errs = validate(o);
        if (errs.length) throw new Error('not a valid .forge file:\n  ' + errs.join('\n  '));
        const key = o.key || {};
        return {
            palette: [...(o.palette || [])],
            slots: o.slots ? { ...o.slots } : null,
            template: o.template || null,
            sprites: o.sprites.map(s => ({
                name: s.name,
                w: s.w, h: s.h,
                origin: { x: s.origin[0], y: s.origin[1] },
                fps: s.fps || 8,
                frames: s.frames.map(f => f.map(row => [...row].map(ch => key[ch] || null))),
            })),
        };
    }

    function stringify(p) { return JSON.stringify(serialize(p), null, 1) + '\n'; }

    /**
     * Text -> project. Branches on `format` so an old file opens rather than
     * crashing; there is one version today and the branch costs one `if`.
     */
    function parse(text) {
        let o;
        try { o = JSON.parse(text); }
        catch (e) { throw new Error('not JSON: ' + e.message); }
        if (o && o.format && o.format !== FORMAT)
            throw new Error(`this file is ${JSON.stringify(o.format)}; this build reads "${FORMAT}"`);
        return deserialize(o);
    }

    return { FORMAT, ALPHABET, TRANSPARENT, blank, newSprite, serialize, deserialize, stringify, parse, validate };
})();
