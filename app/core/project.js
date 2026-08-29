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

    const { nearestHex } = window.SpriteForge.color;

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
     * Every colour the project would have to name, palette first.
     *
     * The pixels unioned with the palette, because neither alone is the whole
     * answer. Harvesting from pixels alone would drop an unused swatch the user
     * deliberately mixed; taking the palette alone would drop a colour that
     * reached the canvas by import or REPLACE and never entered it.
     *
     * Separate from serialize() so the app can ask how many colours a project
     * is carrying without trying to encode it and catching the failure.
     */
    function colorsOf(p) {
        const seen = new Set(p.palette);
        for (const s of p.sprites)
            for (const f of s.frames)
                for (const row of f)
                    for (const px of row) if (px) seen.add(px);
        return [...seen];
    }

    /**
     * The `limit` most useful swatches of a project's palette.
     *
     * The editor has a fixed number of palette slots and a .forge may carry
     * more colours than that: the import script writes up to the key's width.
     * Something has to be left out, and taking the first `limit` would leave
     * the swatches describing the order the file happens to list them in
     * rather than the art. The ones the pixels actually use come first,
     * commonest first, so what is on screen is what you can reach for. Slots
     * left over go to swatches nothing has used yet, in their own order —
     * those are colours somebody mixed on purpose, and there is room.
     *
     * Only the palette is cut. The pixels keep every colour they had; the key
     * holds far more than the palette does, and losing art to a display limit
     * would be the wrong trade entirely.
     */
    function paletteFor(p, limit) {
        const cap = Math.max(1, limit || ALPHABET.length);
        if (p.palette.length <= cap) return [...p.palette];

        const counts = new Map();
        for (const s of p.sprites)
            for (const f of s.frames)
                for (const row of f)
                    for (const px of row) if (px) counts.set(px, (counts.get(px) || 0) + 1);

        // Stable sort, so swatches used equally often stay in palette order.
        const used = p.palette.filter(h => counts.has(h))
            .sort((a, b) => counts.get(b) - counts.get(a));
        const unused = p.palette.filter(h => !counts.has(h));
        return [...used, ...unused].slice(0, cap);
    }

    /**
     * The same project with every colour rewritten through `map`.
     *
     * Palette, slots and pixels together, because a colour that moves has to
     * move everywhere. A swatch left behind would draw a colour nothing else
     * in the project uses, and a slot left behind would recolour nothing.
     *
     * `palette` overrides what the swatches become, for the caller that is
     * replacing them outright rather than moving them.
     */
    function remap(p, map, palette) {
        const at = (hex) => (hex && map[hex]) || hex;
        return {
            palette: palette ? [...palette] : p.palette.map(at),
            slots: p.slots
                ? Object.fromEntries(Object.entries(p.slots).map(([k, v]) => [k, at(v)]))
                : null,
            template: p.template || null,
            sprites: p.sprites.map(s => ({
                ...s,
                origin: { ...s.origin },
                frames: s.frames.map(f => f.map(row => row.map(px => (px ? at(px) : null)))),
            })),
        };
    }

    /**
     * The same project drawn in `palette`, every colour snapped to its nearest
     * entry.
     *
     * A theme used to replace the swatches and leave every pixel where it was,
     * which meant the palette stopped describing the art the moment it was
     * applied, and the project quietly carried both sets of colours. Nearest
     * rather than by index: these themes are arbitrary lists, so swatch 5 and
     * theme colour 5 have nothing to do with each other, while nearest keeps
     * a dark outline dark and the art readable. It also answers for pixels
     * that were never in the palette and for a theme of a different length.
     */
    function retheme(p, palette) {
        const to = [...(palette || [])];
        if (!to.length) return p;
        const map = {};
        for (const hex of colorsOf(p)) map[hex] = nearestHex(hex, to);
        return remap(p, map, to);
    }

    /**
     * The same project using at most `limit` colours, by snapping the ones it
     * drops onto the nearest ones it keeps.
     *
     * The ceiling is real and reachable without doing anything wrong. The
     * palette is shared across the whole project but the pixels are not bound
     * to it: importing a PNG into each of three sprites, or applying a theme
     * between drawing sessions, leaves colours behind in sprites nothing is
     * pointing at any more. Three thirty-two-colour imports is ninety-six, and
     * the key holds eighty-nine.
     *
     * The palette survives whole — those are swatches somebody mixed on
     * purpose, and it is never bigger than the key. What is left of the budget
     * goes to the commonest colours in the pixels, counted across every sprite,
     * so the ones carrying the art outrank a stray pixel. Slots are remapped
     * with everything else: a slot still pointing at a dropped colour would
     * recolour nothing.
     *
     * Nothing is reduced unless it has to be — a project already inside the
     * limit comes back unchanged, by identity.
     */
    function reduce(p, limit) {
        const cap = Math.max(1, limit || ALPHABET.length);
        if (colorsOf(p).length <= cap) return p;

        const counts = new Map();
        for (const s of p.sprites)
            for (const f of s.frames)
                for (const row of f)
                    for (const px of row) if (px) counts.set(px, (counts.get(px) || 0) + 1);

        const kept = new Set(), keep = [];
        const take = (hex) => {
            if (kept.has(hex) || keep.length >= cap) return;
            kept.add(hex); keep.push(hex);
        };
        p.palette.forEach(take);
        const inPixels = [...counts.keys()].filter(h => !kept.has(h));
        inPixels.sort((a, b) => counts.get(b) - counts.get(a));
        inPixels.forEach(take);

        const snap = {};
        for (const hex of inPixels) if (!kept.has(hex)) snap[hex] = nearestHex(hex, keep);
        // The palette is filtered rather than mapped: a swatch that did not fit
        // would otherwise come back as a second copy of its nearest neighbour.
        return remap(p, snap, p.palette.filter(h => kept.has(h)));
    }

    /**
     * Project -> plain object ready for JSON.stringify.
     *
     * Refuses rather than truncates when the colours will not fit. The key is
     * the only thing naming a pixel, so dropping one would blank part of a
     * sprite in a file that reported itself saved. reduce() is the way through,
     * and it is the caller's to offer because it changes the art.
     */
    function serialize(p) {
        const colors = colorsOf(p);
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
        // Checked after the per-sprite pass so a file with both problems
        // reports both. Only the later duplicate is named, so three sprites
        // called "dag" produce two errors rather than three.
        const names = (o.sprites || []).map(s => s && s.name);
        names.forEach((n, i) => {
            if (n && names.indexOf(n) !== i)
                errs.push(`sprite "${n}": a second sprite has this name, and names become filenames on export`);
        });

        return errs;
    }

    /**
     * A name not already taken, by appending a number.
     *
     * Sprite names are not decoration: engines.js turns one into `<name>.png`
     * in a game repo, so two sprites sharing a name would silently overwrite
     * each other on export and the second would win.
     */
    function uniqueName(base, taken) {
        const used = new Set(taken || []);
        const stem = String(base == null ? '' : base).trim() || 'sprite';
        if (!used.has(stem)) return stem;
        let n = 2;
        while (used.has(`${stem}-${n}`)) n++;
        return `${stem}-${n}`;
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

    /**
     * Project -> text, refusing to write anything that could not be read back.
     *
     * validate() runs on the way in via parse(), and it has to run on the way
     * out too or the two directions can disagree: duplicate sprite names were
     * saveable and then unopenable, which turns a save into a way to lose a
     * project rather than keep one.
     */
    function stringify(p) {
        const o = serialize(p);
        const errs = validate(o);
        if (errs.length) throw new Error('cannot save this project:\n  ' + errs.join('\n  '));
        return JSON.stringify(o, null, 1) + '\n';
    }

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

    return { FORMAT, ALPHABET, TRANSPARENT, blank, newSprite, uniqueName, colorsOf, paletteFor, remap, retheme, reduce, serialize, deserialize, stringify, parse, validate };
})();
