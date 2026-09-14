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
}
