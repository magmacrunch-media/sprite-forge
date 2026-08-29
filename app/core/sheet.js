// sheet.js — the uniform-grid PNG sheet: frames in, frames out.
//
// THE FORMAT IS A SHARED CONTRACT, NOT THIS APP'S TO CHANGE. Uniform grid of
// frameWidth x frameHeight cells, counted left-to-right then top-to-bottom; the
// origin travels with the load call and is never stored in the PNG. All four
// consumers assume it — adenosine (TS), magnolia (C/Wii), texastoast (Python)
// and the GameMaker importer. Canonical spec: adenosine/packages/rpg/API.md,
// the sprites.ts section; adenosine/AGENTS.md marks it "do not change
// unilaterally". Changing anything here is a four-repo change.
//
// Depends on a CanvasRenderingContext2D for encoding only. The frame <-> pixel
// conversions either side of that are pure, which is what lets the .forge
// loader and the export targets use them without a canvas.

window.SpriteForge = window.SpriteForge || {};
window.SpriteForge.sheet = (function () {

    const { hexToRgb, nearestHex } = window.SpriteForge.color;

    /** One frame grid -> ImageData. Opaque or fully transparent, never between. */
    function frameToImageData(f, w, h) {
        const img = new ImageData(w, h);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const c = f[y][x];
                if (!c) continue;
                const [r, g, b] = hexToRgb(c), i = (y * w + x) * 4;
                img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
            }
        }
        return img;
    }

    /**
     * Lays frames out on a grid `cols` wide and returns the composed canvas.
     * cols defaults to every frame on one row, which is what the editor has
     * always exported and what the checked-in sheets in the game repos are.
     */
    function framesToSheet(frames, w, h, cols) {
        const n = frames.length;
        const c = Math.max(1, Math.min(cols || n, n));
        const rows = Math.ceil(n / c);
        const canvas = document.createElement('canvas');
        canvas.width = w * c;
        canvas.height = h * rows;
        const ctx = canvas.getContext('2d');
        frames.forEach((f, i) => {
            ctx.putImageData(frameToImageData(f, w, h), (i % c) * w, Math.floor(i / c) * h);
        });
        return canvas;
    }

    /**
     * Slices a decoded image into frames, left-to-right then top-to-bottom.
     *
     * Returns { frames, palette, colors, truncated } — palette is the distinct
     * colours ordered by how many pixels use them, so the commonest colour
     * lands in swatch 0, and `colors` is how many distinct colours the image
     * held before maxSwatches was applied. `truncated` reports that the image
     * was not evenly divisible and trailing pixels were dropped, rather than
     * failing: a sheet with a stray row of guide pixels is still worth
     * importing.
     *
     * maxSwatches reduces the pixels as well as the palette: the colours that
     * do not make the cut are snapped to the nearest one that did, so every
     * pixel returned is a palette entry. It cannot only truncate the palette.
     * project.js builds the .forge key from the pixels unioned with the
     * palette, so truncating the palette alone left the pixels holding every
     * colour of the original: a full-colour PNG imported cleanly and then
     * could not be saved at all, because the key holds 89 colours.
     *
     * Pixels below 50% alpha become transparent and partial alpha is dropped —
     * the grids this editor works in have no intermediate alpha at all.
     */
    function sheetToFrames(ctx, imgW, imgH, w, h, maxFrames, maxSwatches) {
        const cols = Math.floor(imgW / w), rowsN = Math.floor(imgH / h);
        if (!cols || !rowsN) return null;

        const frames = [], counts = {};
        const cap = maxFrames || Infinity;
        for (let row = 0; row < rowsN && frames.length < cap; row++) {
            for (let col = 0; col < cols && frames.length < cap; col++) {
                const d = ctx.getImageData(col * w, row * h, w, h).data;
                frames.push(Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => {
                    const i = (y * w + x) * 4;
                    if (d[i + 3] < 128) return null;
                    const hex = '#' + [d[i], d[i + 1], d[i + 2]]
                        .map(v => v.toString(16).padStart(2, '0')).join('');
                    counts[hex] = (counts[hex] || 0) + 1;
                    return hex;
                })));
            }
        }

        const ordered = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
        const palette = ordered.slice(0, maxSwatches || Infinity);

        // Only the dropped colours get an entry; a kept colour falls through to
        // itself, and that identity matters because the palette, the slot
        // machinery and the .forge key all compare hexes with ===.
        const snap = {};
        for (const hex of ordered.slice(palette.length)) snap[hex] = nearestHex(hex, palette);
        const reduced = Object.keys(snap).length
            ? frames.map(f => f.map(row => row.map(px => (px ? snap[px] || px : null))))
            : frames;

        return {
            frames: reduced,
            palette,
            colors: ordered.length,
            truncated: !!((imgW % w) || (imgH % h)),
        };
    }

    return { frameToImageData, framesToSheet, sheetToFrames };
})();
