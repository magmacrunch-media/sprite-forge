import { test, eq, ok } from './assert.mjs';

// core/frames.js — the order the frames are in.
//
// Letters rather than frames: what reorder does is a permutation, and 'abcde'
// -> 'acbde' says which one in a way that four nested arrays of '#rrggbb'
// cannot. The editor hands it real frames and neither knows nor cares.

const list = (s) => [...s];
const show = (a) => (a === null ? null : a.join(''));

export default function (SF) {
    const F = SF.frames;

    // ── what `to` means ─────────────────────────────────────────

    // The whole reason this is a core module and not a splice at the call
    // site. `to` is where the frame ENDS UP, so the same target index means
    // the same result whichever direction the frame travelled to get there.
    test('to is the moved frame\'s final index, travelling either way', () => {
        eq(show(F.reorder(list('abcde'), 0, 2)), 'bcade', 'a becomes the third frame');
        eq(show(F.reorder(list('abcde'), 4, 2)), 'abecd', 'e becomes the third frame');
        for (const from of [0, 1, 3, 4])
            eq(F.reorder(list('abcde'), from, 2)[2], 'abcde'[from],
                `whatever started at ${from} is at index 2`);
    });

    test('one step either way swaps with the neighbour', () => {
        eq(show(F.reorder(list('abcde'), 2, 1)), 'acbde', 'left');
        eq(show(F.reorder(list('abcde'), 2, 3)), 'abdce', 'right');
    });

    test('a frame can travel the whole way to either end', () => {
        eq(show(F.reorder(list('abcde'), 4, 0)), 'eabcd', 'last to first');
        eq(show(F.reorder(list('abcde'), 0, 4)), 'bcdea', 'first to last');
    });

    // ── null is "nothing would change" ──────────────────────────

    test('a move that changes nothing is null, not a copy', () => {
        eq(F.reorder(list('abcde'), 2, 2), null, 'the same index');
        eq(F.reorder(list('abcde'), 0, -1), null, 'the first frame, left');
        eq(F.reorder(list('abcde'), 4, 5), null, 'the last frame, right');
        eq(F.reorder(list('a'), 0, 1), null, 'the only frame, anywhere');
    });

    // A drag that runs off the end of the strip is the ordinary case, not an
    // error: the cursor leaves the canvas long before the intent does.
    test('a target past either end lands at that end', () => {
        eq(show(F.reorder(list('abcde'), 2, -9)), 'cabde', 'clamped to first');
        eq(show(F.reorder(list('abcde'), 2, 99)), 'abdec', 'clamped to last');
    });

    test('a from that names no frame is null rather than a guess', () => {
        eq(F.reorder(list('abc'), 3, 0), null, 'past the end');
        eq(F.reorder(list('abc'), -1, 0), null, 'before the start');
        eq(F.reorder([], 0, 0), null, 'an empty list');
        eq(F.reorder(list('abc'), 1.5, 0), null, 'not an index at all');
        eq(F.reorder(list('abc'), 0, null), null, 'nor a destination');
    });

    test('the list it was given is not touched', () => {
        const l = list('abcde');
        F.reorder(l, 0, 4);
        eq(show(l), 'abcde', 'untouched');
    });

    // ── canMove, which is what greys the buttons out ────────────

    test('canMove is false exactly where reorder would be null', () => {
        const l = list('abc');
        ok(!F.canMove(l, 0, -1), 'first cannot go left');
        ok(F.canMove(l, 0, 1), 'first can go right');
        ok(F.canMove(l, 2, -1), 'last can go left');
        ok(!F.canMove(l, 2, 1), 'last cannot go right');
        ok(!F.canMove(list('a'), 0, -1) && !F.canMove(list('a'), 0, 1),
            'a lone frame can go nowhere');
    });

    // ── holds ───────────────────────────────────────────────────
    //
    // A hold is how many ticks of the sprite's fps a frame occupies. The list
    // runs parallel to the frames and the whole risk is that it stops doing
    // so, which is what normalizeHolds is for.

    test('normalizeHolds gives exactly one positive whole number per frame', () => {
        eq(F.normalizeHolds([2, 3, 1], 3), [2, 3, 1], 'already fine');
        eq(F.normalizeHolds(undefined, 3), [1, 1, 1], 'a .forge written before holds existed');
        eq(F.normalizeHolds([2], 3), [2, 1, 1], 'short: the rest are single beats');
        eq(F.normalizeHolds([2, 2, 2, 2, 2], 3), [2, 2, 2], 'long: the extra is dropped');
        eq(F.normalizeHolds([], 0), [], 'no frames, no holds');
    });

    // Every one of these is reachable by hand-editing a .forge, and every one
    // would otherwise put a zero or a NaN into the tick arithmetic, where it
    // becomes an animation that stops or a frame index of NaN.
    test('nonsense holds come back usable rather than propagating', () => {
        eq(F.normalizeHolds([0, -4, 1.7, '3', null, NaN, Infinity], 7),
            [1, 1, 1, 3, 1, 1, 1], 'floor, clamp, and 1 for anything that is not a count');
        eq(F.normalizeHolds([500], 1), [F.MAX_HOLD], 'capped rather than refused');
    });

    test('evenlyHeld is what lets the .forge leave the field out', () => {
        ok(F.evenlyHeld([1, 1, 1]), 'all ones');
        ok(F.evenlyHeld(undefined), 'and nothing at all');
        ok(!F.evenlyHeld([1, 2, 1]), 'one held frame is enough to have to write it');
    });

    test('totalTicks is one pass through the cycle', () => {
        eq(F.totalTicks([1, 1, 1, 1]), 4, 'even');
        eq(F.totalTicks([1, 4, 1]), 6, 'held');
        eq(F.totalTicks([]), 0, 'empty');
    });

    // ── frameAtTick ─────────────────────────────────────────────

    test('an even animation shows one frame per tick', () => {
        const h = [1, 1, 1];
        eq([0, 1, 2].map(t => F.frameAtTick(h, t)), [0, 1, 2], 'one each');
    });

    test('a held frame stays up for its whole count', () => {
        const h = [1, 4, 1];                       // 6 ticks: a, bbbb, c
        eq([0, 1, 2, 3, 4, 5].map(t => F.frameAtTick(h, t)), [0, 1, 1, 1, 1, 2], 'held four');
    });

    test('the cycle wraps, and a counter that runs forever is fine', () => {
        const h = [1, 4, 1];
        eq(F.frameAtTick(h, 6), 0, 'back to the first');
        eq(F.frameAtTick(h, 7), 1, 'and on');
        eq(F.frameAtTick(h, 6 * 1000 + 5), 2, 'a thousand loops later');
        eq(F.frameAtTick(h, -1), 2, 'and backwards, for a scrub');
    });

    test('frameAtTick answers rather than throwing when there is nothing to show', () => {
        eq(F.frameAtTick([], 5), 0, 'no frames');
        eq(F.frameAtTick([0, 0], 3), 0, 'holds that sum to nothing, which normalize prevents');
    });

    // Playback reads the clock rather than stepping itself, so this is what
    // makes play-from-here land on a frame's first beat instead of partway in.
    test('tickOfFrame is where a frame begins', () => {
        const h = [1, 4, 1];
        eq([0, 1, 2].map(i => F.tickOfFrame(h, i)), [0, 1, 5], 'starts');
        for (const i of [0, 1, 2])
            eq(F.frameAtTick(h, F.tickOfFrame(h, i)), i, `tick ${i} round-trips`);
    });

    // ── onion skin ──────────────────────────────────────────────

    const at = (g) => g.map(x => x.index);
    const deltas = (g) => g.map(x => x.delta);

    test('depth 1 is one frame either side, which is what it always was', () => {
        const g = F.ghosts(5, 2, 1);
        eq(at(g), [1, 3], 'the neighbours');
        eq(deltas(g), [-1, 1], 'one behind, one ahead');
        eq(g.map(x => x.alpha), [F.ONION_ALPHA, F.ONION_ALPHA], 'at the old alpha');
    });

    test('depth reaches both ways and fades with distance', () => {
        const g = F.ghosts(9, 4, 3);
        eq(at(g), [3, 5, 2, 6, 1, 7], 'nearest pair first');
        eq(deltas(g), [-1, 1, -2, 2, -3, 3], 'alternating');
        const a = g.map(x => +x.alpha.toFixed(3));
        eq(a, [0.3, 0.3, 0.2, 0.2, 0.1, 0.1], 'the nearest keeps the full alpha');
    });

    // A walk cycle's hardest join is the last frame back to the first, so the
    // ghosts have to wrap or the one place you most need them is the one place
    // they are not.
    test('ghosts wrap around the loop', () => {
        eq(at(F.ghosts(4, 0, 1)), [3, 1], 'from the first frame');
        eq(at(F.ghosts(4, 3, 1)), [2, 0], 'and from the last');
    });

    // Reach far enough on a short loop and the two directions start landing on
    // frames the other already claimed. Each frame gets ghosted once, by the
    // shortest way round.
    test('a frame is never ghosted twice, however deep the reach', () => {
        const g = F.ghosts(4, 0, 4);
        eq(at(g), [3, 1, 2], 'three ghosts for four frames');
        eq(new Set(at(g)).size, 3, 'all distinct');
        eq(deltas(g), [-1, 1, -2], 'frame 2 came the short way, not as -3 or +3');
    });

    test('the frame on the canvas is never among its own ghosts', () => {
        for (const count of [2, 3, 4, 5, 8])
            for (let i = 0; i < count; i++)
                for (const depth of [1, 2, 3, 4]) {
                    const g = F.ghosts(count, i, depth);
                    ok(!at(g).includes(i), `${count} frames, at ${i}, depth ${depth}`);
                    eq(at(g).length, new Set(at(g)).size, 'no repeats');
                    ok(g.length <= count - 1, 'never more ghosts than there are other frames');
                }
    });

    test('a single frame has nothing to ghost, and says so with an empty list', () => {
        eq(F.ghosts(1, 0, 3), [], 'one frame');
        eq(F.ghosts(0, 0, 3), [], 'none at all');
    });

    test('a depth that is not a depth falls back to 1 rather than drawing nothing', () => {
        for (const bad of [0, -3, undefined, null, NaN, 'x'])
            eq(at(F.ghosts(5, 2, bad)), [1, 3], String(bad));
        eq(at(F.ghosts(9, 4, 99)).length, 2 * F.MAX_ONION, 'and too deep is clamped to MAX_ONION');
    });

    test('holds are reordered by the same call the frames are', () => {
        // The editor moves both with one index pair, which is the only reason
        // they cannot come apart.
        const frames = list('abcde'), holds = [1, 2, 3, 4, 5];
        const f = F.reorder(frames, 4, 1), h = F.reorder(holds, 4, 1);
        eq(show(f), 'aebcd', 'frames');
        eq(h, [1, 5, 2, 3, 4], 'and the holds went with them');
    });
}
