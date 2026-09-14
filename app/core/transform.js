// transform.js — the whole-frame geometry: flip it, turn it.
//
// A grid here is frames[i] from the editor, grid[y][x] = '#rrggbb' | null, the
// same shape core/draw.js plots into and core/select.js lifts out of. Nothing
// here knows about a canvas, a tool or an undo stack.
//
// The flips came out of ui/editor.js unchanged and are one line each; they are
// here because leaving them inline while rotation lived in core/ would have
// split three operations of one kind across two layers. Rotation is the reason
// the file exists.
//
// ── Why rotation earned a module and a test, and the flips did not
//
// A flip cannot change a frame's size, so the only way to get one wrong is to
// flip the wrong axis, which is visible the first time anybody looks. Rotation
// swaps width and height, and the editor's original was **square-only** — not
// as a design decision but because it built the result with the two the wrong
// way round, so it produced a correctly rotated grid at the original
// dimensions and could only be right when those were equal. It was guarded
// with `if (frameW !== frameH) return;` and shipped as a limitation, which is
// how a 16x24 sprite — the size of this app's own DAG template — came to be
// one that could not be turned.

window.SpriteForge = window.SpriteForge || {};
window.SpriteForge.transform = (function () {

    /** Mirrored left to right. */
    function flipH(grid) {
        return grid.map(row => [...row].reverse());
    }

    /** Mirrored top to bottom. */
    function flipV(grid) {
        return [...grid].reverse().map(row => [...row]);
    }

    /**
     * Turned 90° clockwise.
     *
     * A w x h grid comes back h x w: the rows of the result are as many as the
     * columns of the input. That swap is the whole correctness story — the
     * per-pixel formula below was right all along.
     */
    function rotate90(grid) {
        const h = grid.length;
        if (!h) return [];
        const w = grid[0].length;
        return Array.from({ length: w }, (_, y) =>
            Array.from({ length: h }, (_, x) => grid[h - 1 - x][y]));
    }

    /**
     * Where a point on the grid ends up after rotate90.
     *
     * The origin is a point rather than a pixel — it may sit on the far edge,
     * at x === w or y === h, which is what "the feet" means for a sprite whose
     * feet are on the bottom row. So this is not the pixel formula with the
     * offsets removed: turning clockwise sends the top-left corner (0, 0) to
     * the top-RIGHT, which in the rotated frame is (h, 0).
     *
     * @param h the height of the grid BEFORE the rotation, which becomes its
     *   width after. Passing the new one silently mirrors the result on a
     *   non-square frame and is exactly right on a square one, so a test that
     *   only ever turns squares would not catch it.
     */
    function rotateOrigin(origin, h) {
        return { x: h - origin.y, y: origin.x };
    }

    return { flipH, flipV, rotate90, rotateOrigin };
}());
