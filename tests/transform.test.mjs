import { test, eq } from './assert.mjs';

// core/transform.js — flip and turn.
//
// Letters again, and deliberately a NON-SQUARE grid almost everywhere, because
// square is the case the editor's original rotation got right by accident. A
// suite that only turned squares would have passed against the bug it exists
// to hold shut.

const HEX = (c) => (c === '.' ? null : '#' + c.charCodeAt(0).toString(16).repeat(3));
const grid = (rows) => rows.map(row => [...row].map(HEX));
const show = (g) => g.map(row => row.map(px => {
    if (px === null) return '.';
    return String.fromCharCode(parseInt(px.slice(1, 3), 16));
}).join(''));

export default function (SF) {
    const T = SF.transform;

    // 2 wide, 3 tall — the shape whose rotation the editor could not do.
    const TALL = ['ab', 'cd', 'ef'];

    test('rotate90 turns a tall grid into a wide one', () => {
        eq(show(T.rotate90(grid(TALL))), ['eca', 'fdb'], 'clockwise');
    });

    // The bug, stated as a test. The old code built the result with the
    // dimensions the wrong way round, so it was right only when they matched.
    test('a w x h grid comes back h x w', () => {
        const out = T.rotate90(grid(TALL));
        eq([out.length, out[0].length], [2, 3], '3x2 became 2x3');
        const back = T.rotate90(T.rotate90(grid(TALL)));
        eq([back.length, back[0].length], [3, 2], 'and back again');
    });

    test('four turns are the identity, on a shape that is not square', () => {
        let g = grid(TALL);
        for (let i = 0; i < 4; i++) g = T.rotate90(g);
        eq(show(g), TALL, 'round trip');
    });

    test('two turns are a half turn', () => {
        eq(show(T.rotate90(T.rotate90(grid(TALL)))), ['fe', 'dc', 'ba'], '180');
    });

    test('transparency survives a turn', () => {
        eq(show(T.rotate90(grid(['a.', '.b']))), ['.a', 'b.'], 'nulls kept');
    });

    test('a 1 x n grid turns into an n x 1', () => {
        eq(show(T.rotate90(grid(['abc']))), ['a', 'b', 'c'], 'one row becomes one column');
        eq(show(T.rotate90(grid(['a', 'b', 'c']))), ['cba'], 'and the other way');
    });

    test('an empty grid is empty rather than a crash', () => {
        eq(T.rotate90([]), [], 'nothing to turn');
    });

    // ── the origin ──────────────────────────────────────────────

    // The origin is a POINT, not a pixel: it sits at y === h for a sprite
    // standing on its bottom row, which is one past the last pixel. Turning
    // clockwise sends the top-left corner to the top-right.
    test('the origin follows the corner it sits in', () => {
        const h = 24;                              // a 16x24 DAG
        eq(T.rotateOrigin({ x: 0, y: 0 }, h), { x: 24, y: 0 }, 'top-left goes to top-right');
        eq(T.rotateOrigin({ x: 16, y: 24 }, h), { x: 0, y: 16 }, 'bottom-right goes to bottom-left');
        eq(T.rotateOrigin({ x: 8, y: 24 }, h), { x: 0, y: 8 }, 'the feet end up on the left edge');
    });

    test('four turns put the origin back where it started', () => {
        let o = { x: 8, y: 24 }, w = 16, h = 24;
        for (let i = 0; i < 4; i++) { o = T.rotateOrigin(o, h); [w, h] = [h, w]; }
        eq(o, { x: 8, y: 24 }, 'round trip');
        eq([w, h], [16, 24], 'and so are the dimensions');
    });

    // ── the flips, which moved out of editor.js unchanged ───────

    test('flipH mirrors left to right', () => {
        eq(show(T.flipH(grid(TALL))), ['ba', 'dc', 'fe'], 'rows reversed');
    });

    test('flipV mirrors top to bottom', () => {
        eq(show(T.flipV(grid(TALL))), ['ef', 'cd', 'ab'], 'row order reversed');
    });

    test('a flip cannot change the size, either way', () => {
        for (const f of [T.flipH, T.flipV]) {
            const out = f(grid(TALL));
            eq([out.length, out[0].length], [3, 2], 'still 3x2');
        }
    });

    test('neither a flip nor a turn touches the grid it was given', () => {
        for (const f of [T.flipH, T.flipV, T.rotate90]) {
            const g = grid(TALL);
            f(g);
            eq(show(g), TALL, 'untouched');
        }
    });
}
