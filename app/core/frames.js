// frames.js — the frame LIST: what order the frames are in.
//
// Not what is in a frame. Flipping, rotating and shifting are single-frame
// pixel work and live with the canvas in ui/editor.js; core/sheet.js turns the
// list into a sheet and back. What is here is the sequence itself, which is the
// part with edges worth testing: an index that has to travel with the frame it
// names, and a handful of positions that mean "no change" rather than an error.
//
// Pure, like the rest of core/: a list in, a new list out, no mutation.

window.SpriteForge = window.SpriteForge || {};
window.SpriteForge.frames = (function () {

    /**
     * The list with the item at `from` moved to `to`.
     *
     * `to` is where the moved frame ENDS UP in the returned list — not a gap
     * between frames, and not an index into the list before the removal. Those
     * are the two other things it could mean, they differ by one in opposite
     * directions depending on which way the frame travels, and picking the one
     * a caller can check by eye is worth more than picking the one that makes
     * the arithmetic shorter. Dropping a frame on the third slot makes it the
     * third frame, whichever slot it came from.
     *
     * @returns a new array, or **null** when the move changes nothing — the
     *   same index, or one either end could not reach. Null rather than a copy
     *   so that "would this do anything?" has one answer and the caller cannot
     *   push an undo entry for a move that did not happen. Same shape as
     *   targets/gamemaker.js's patchYy, and for the same reason.
     */
    function reorder(list, from, to) {
        const n = list.length;
        if (!Number.isInteger(from) || !Number.isInteger(to)) return null;
        if (from < 0 || from >= n) return null;
        const dest = Math.max(0, Math.min(n - 1, to));
        if (dest === from) return null;
        const out = [...list];
        out.splice(dest, 0, out.splice(from, 1)[0]);
        return out;
    }

    /**
     * Can the frame at `index` move by `delta`?
     *
     * The buttons ask this to grey themselves out. It is deliberately a
     * separate question from reorder's null: a disabled button is the answer
     * given BEFORE the click, and an editor that lets you press a thing that
     * cannot work has already wasted the press.
     */
    function canMove(list, index, delta) {
        return reorder(list, index, index + delta) !== null;
    }

    return { reorder, canMove };
}());
