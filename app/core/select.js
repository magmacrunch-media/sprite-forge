// select.js — a rectangular region of a frame, and what you can do to one.
//
// Pure, like the rest of core/: frames in, new frames out, no DOM and no
// mutation. The editor owns which region is selected and what the mouse is
// doing; everything about what a selection MEANS is here, which is what lets it
// be tested against a grid of characters in Node rather than by dragging.
//
// A frame is rows of '#rrggbb' | null, exactly as core/project.js stores it.
//
// ── Two decisions worth stating, because both could sensibly go the other way
//
// **A clip is pixels, not a rectangle of paint.** stamp() skips the null cells
// in a clip rather than writing them, so lifting a head out of a sprite and
// putting it down somewhere else leaves what was around it alone. The opposite
// — a rect that paints its own transparency — makes every paste a hole-punch
// the size of the marquee, which is almost never what was meant. Delete is how
// you punch a hole, and it says so.
//
// **A move clips, it does not wrap.** core/sheet.js's neighbour in the editor,
// shiftFrame, rotates the whole frame and pixels come back round the other
// side; that is a frame-wide operation and wrapping is its point. Dragging a
// region off the edge loses what goes over, the way dragging anything off a
// table does.

window.SpriteForge = window.SpriteForge || {};
window.SpriteForge.select = (function () {

    /** Is this a usable selection? null and zero-area both answer no, so a
     *  caller never has to check for both. */
    function isEmpty(rect) {
        return !rect || rect.w <= 0 || rect.h <= 0;
    }

    /** A rect trimmed to what actually lies inside a w x h frame, or null if
     *  none of it does. Every other function here takes a clamped rect, and
     *  this is the only place the frame's bounds are consulted. */
    function clamp(rect, w, h) {
        if (isEmpty(rect)) return null;
        const x0 = Math.max(0, rect.x), y0 = Math.max(0, rect.y);
        const x1 = Math.min(w, rect.x + rect.w), y1 = Math.min(h, rect.y + rect.h);
        if (x1 <= x0 || y1 <= y0) return null;
        return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }

    /**
     * The rect covering two corner pixels, both included.
     *
     * Both, because the corners are pixels rather than points: dragging from
     * (3,3) to (3,3) selects the one pixel under the cursor, and a marquee that
     * came back empty from a click on a pixel would be a bug reported as "the
     * select tool does nothing".
     */
    function rectFrom(a, b, w, h) {
        const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
        return clamp({
            x, y,
            w: Math.abs(a.x - b.x) + 1,
            h: Math.abs(a.y - b.y) + 1,
        }, w, h);
    }

    /** The pixels inside a rect, as a frame-shaped array of its own. */
    function extract(frame, rect) {
        if (isEmpty(rect)) return null;
        return Array.from({ length: rect.h }, (_, y) =>
            Array.from({ length: rect.w }, (_, x) => frame[rect.y + y][rect.x + x]));
    }

    /** A copy of the frame with everything inside the rect made transparent. */
    function clearRegion(frame, rect) {
        if (isEmpty(rect)) return frame.map(row => [...row]);
        return frame.map((row, y) => row.map((px, x) =>
            (y >= rect.y && y < rect.y + rect.h && x >= rect.x && x < rect.x + rect.w)
                ? null : px));
    }

    /**
     * A copy of the frame with `clip` put down at (x, y).
     *
     * Transparent cells in the clip leave the frame alone — see the header.
     * Anything that falls outside the frame is dropped, so a clip pasted near
     * an edge, or one wider than the frame it is going into, lands as much of
     * itself as fits rather than being refused.
     */
    function stamp(frame, clip, x, y) {
        const out = frame.map(row => [...row]);
        if (!clip || !clip.length) return out;
        const h = out.length, w = out[0].length;
        for (let cy = 0; cy < clip.length; cy++) {
            const ty = y + cy;
            if (ty < 0 || ty >= h) continue;
            for (let cx = 0; cx < clip[cy].length; cx++) {
                const tx = x + cx;
                if (tx < 0 || tx >= w) continue;
                const px = clip[cy][cx];
                if (px) out[ty][tx] = px;
            }
        }
        return out;
    }

    /**
     * The selected region moved by (dx, dy): lifted, its old place cleared,
     * and put down at the offset.
     *
     * One function rather than the caller composing clearRegion and stamp,
     * because the ORDER is load-bearing and getting it wrong is invisible until
     * the move overlaps its own source — clearing after stamping eats the part
     * of the region that landed back inside the old rect.
     *
     * @returns {{frame, rect}} the new frame and where the selection now is,
     *   or the frame unchanged and the same rect when nothing is selected.
     *   `rect` is the clamped landing place, so a region dragged half off the
     *   edge reports the half that survived.
     */
    function move(frame, rect, dx, dy) {
        if (isEmpty(rect)) return { frame: frame.map(row => [...row]), rect };
        const h = frame.length, w = frame[0].length;
        const clip = extract(frame, rect);
        const lifted = clearRegion(frame, rect);
        const landed = clamp({ x: rect.x + dx, y: rect.y + dy, w: rect.w, h: rect.h }, w, h);
        return { frame: stamp(lifted, clip, rect.x + dx, rect.y + dy), rect: landed };
    }

    return { isEmpty, clamp, rectFrom, extract, clearRegion, stamp, move };
}());
