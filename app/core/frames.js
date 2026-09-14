// frames.js — the frame LIST: what order the frames are in, and how long each
// one stays up.
//
// Not what is IN a frame — that is core/transform.js and core/draw.js. What is
// here is the sequence, which is the part with edges worth testing: an index
// that has to travel with the frame it names, a handful of positions that mean
// "no change" rather than an error, and a parallel list that must not be
// allowed to drift out of step with the frames it describes.
//
// ── Holds
//
// A hold is how many ticks of the sprite's `fps` a frame occupies. All 1s is an
// even animation at that rate; [1, 1, 4, 1] leaves the third frame up four
// times as long. **Ticks rather than milliseconds**, for three reasons: the fps
// is already the sprite's and a hold reads as "stay up for four beats", which
// is how sprite animation is actually authored; changing the fps then rescales
// the whole cycle evenly rather than only the frames nobody held; and integers
// keep the .forge diffable, which is the whole reason that file is JSON of
// single characters rather than a blob.
//
// A hold never leaves the editor. Neither does `fps` — none of the five export
// targets take a frame rate, they each set playback at their own end, and the
// PNG sheet is pixels and nothing else. That is not this being half-finished:
// the .forge is the authoring document and the sheet is the delivery, and
// timing has always lived on the first.
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

    /** The most ticks one frame may be held for. Two digits, because the input
     *  in the FRAMES panel is two digits wide, and 99 ticks is twelve seconds
     *  at the default 8fps — well past any pose worth calling a frame. */
    const MAX_HOLD = 99;

    /**
     * A holds list that is safe to index: exactly `count` entries, every one a
     * whole number from 1 to MAX_HOLD.
     *
     * Everything else here assumes that, and there are three ways it can fail
     * to be true — a .forge written before holds existed carries none, a
     * hand-edited one can carry anything, and the editor's own list could in
     * principle fall out of step with the frames. Rather than each caller
     * checking, this is the one door: missing, short, long, fractional,
     * negative and not-a-number all come back as a usable list.
     */
    function normalizeHolds(holds, count) {
        const src = Array.isArray(holds) ? holds : [];
        return Array.from({ length: Math.max(0, count) }, (_, i) => {
            const n = Math.floor(Number(src[i]));
            return Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_HOLD) : 1;
        });
    }

    /** True when every frame is held for exactly one tick — an even animation,
     *  and the case the .forge leaves the field out for entirely. */
    function evenlyHeld(holds) {
        return !holds || holds.every(n => n === 1);
    }

    /** How many ticks one pass through the animation takes. */
    function totalTicks(holds) {
        return holds.reduce((a, b) => a + b, 0);
    }

    /**
     * Which frame is on screen `tick` ticks into the cycle.
     *
     * Takes the tick rather than being stepped, so playback has no state of its
     * own to drift: the timer counts up, this answers, and a frame rate change
     * or a scrub lands on the same frame the tick says it should. `tick` is
     * wrapped here rather than by the caller, so a counter that runs forever is
     * the ordinary way to use it.
     *
     * @returns the frame index, or 0 for an empty list.
     */
    function frameAtTick(holds, tick) {
        const total = totalTicks(holds);
        if (!holds.length || total <= 0) return 0;
        let t = Math.floor(tick) % total;
        if (t < 0) t += total;
        for (let i = 0; i < holds.length; i++) {
            if (t < holds[i]) return i;
            t -= holds[i];
        }
        return holds.length - 1;      // unreachable while total is the sum
    }

    /** The first tick of a frame, so play-from-here starts on its first beat
     *  rather than partway through it. */
    function tickOfFrame(holds, index) {
        let t = 0;
        for (let i = 0; i < index && i < holds.length; i++) t += holds[i];
        return t;
    }

    /** How deep the onion skin may go in each direction. Four back and four
     *  forward is already eight ghosts; past that the canvas is soup and the
     *  control is a number nobody moves twice. */
    const MAX_ONION = 4;

    /** The alpha the nearest ghost is drawn at — the value the single-frame
     *  onion skin used before it had a depth, so depth 1 looks exactly as it
     *  always did. */
    const ONION_ALPHA = 0.3;

    /**
     * Which frames to ghost around `index`, and how solid each one should be.
     *
     * Both directions: onion skinning is as much about the pose you are heading
     * for as the one you came from, and the editor tints them apart rather than
     * leaving you to guess which grey is which.
     *
     * Wraps, because these animations loop — the frame before the first IS the
     * last, and lining the two up is exactly the join a walk cycle lives or
     * dies on.
     *
     * @param count how many frames the sprite has
     * @param index the frame on the canvas, which is never among the ghosts
     * @param depth how many to reach in each direction, clamped to MAX_ONION
     * @returns [{ index, delta, alpha }], **nearest first**, `delta` negative
     *   for the frames behind. Empty when there is nothing to ghost. Nearest
     *   first because that is the order it reads in; a caller painting them
     *   wants the reverse, so the closest ghost ends up on top.
     */
    function ghosts(count, index, depth) {
        const d = Math.max(1, Math.min(MAX_ONION, Math.floor(depth) || 1));
        if (!Number.isInteger(count) || count < 2) return [];
        // A ghost is any frame but the one on screen, so a 3-frame sprite has
        // at most 2 of them however deep the control is wound. Without this a
        // depth of 4 on a 3-frame sprite draws the current frame over itself,
        // twice, at two different alphas — which reads as the art being wrong
        // rather than the setting being too high.
        const reach = Math.min(d, count - 1);
        const out = [];
        // Once per frame, at the alpha of the SHORTEST way round to it. Reach
        // far enough on a short loop and the two directions start landing on
        // frames the other has already claimed — on four frames, three steps
        // back is one step forward. Without this they are ghosted twice, at two
        // different alphas, which is a frame that looks more solid than its
        // neighbours for no reason on screen.
        const seen = new Set([index]);
        for (let dist = 1; dist <= reach; dist++) {
            const alpha = ONION_ALPHA * (reach - dist + 1) / reach;
            for (const delta of [-dist, dist]) {
                const at = ((index + delta) % count + count) % count;
                if (seen.has(at)) continue;
                seen.add(at);
                out.push({ index: at, delta, alpha });
            }
        }
        return out;
    }

    return {
        reorder, canMove,
        MAX_HOLD, normalizeHolds, evenlyHeld, totalTicks, frameAtTick, tickOfFrame,
        MAX_ONION, ONION_ALPHA, ghosts,
    };
}());
