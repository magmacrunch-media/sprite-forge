import { test, eq, ok } from './assert.mjs';

// core/select.js — the rectangular selection, tested as a grid of characters.
//
// A frame here is written as strings, one per row, and read back the same way,
// because what these functions do is shape-shaped: which cells moved, which
// survived a clip, which were left alone by a transparent one. Comparing two
// pictures says that; comparing two arrays of '#rrggbb' says it in a way
// nobody can check by eye.

const HEX = { r: '#ff0000', g: '#00ff00', b: '#0000ff', '.': null };
const CHAR = { '#ff0000': 'r', '#00ff00': 'g', '#0000ff': 'b' };

/** ['rg.', '..b'] -> rows of '#rrggbb' | null */
const grid = (rows) => rows.map(row => [...row].map(c => HEX[c]));
/** and back, so a failure prints a picture */
const show = (frame) => frame.map(row => row.map(px => px ? CHAR[px] : '.').join(''));

export default function (SF) {
    const S = SF.select;

    // ── rectFrom ────────────────────────────────────────────────

    test('a rect covers both corner pixels, dragged from any corner', () => {
        const want = { x: 1, y: 1, w: 3, h: 2 };
        eq(S.rectFrom({ x: 1, y: 1 }, { x: 3, y: 2 }, 8, 8), want, 'down-right');
        eq(S.rectFrom({ x: 3, y: 2 }, { x: 1, y: 1 }, 8, 8), want, 'up-left');
        eq(S.rectFrom({ x: 3, y: 1 }, { x: 1, y: 2 }, 8, 8), want, 'down-left');
        eq(S.rectFrom({ x: 1, y: 2 }, { x: 3, y: 1 }, 8, 8), want, 'up-right');
    });

    // Both corners included is what makes this true, and it is the case that
    // would be reported as "the select tool does nothing".
    test('a click without a drag selects the one pixel under it', () => {
        eq(S.rectFrom({ x: 4, y: 4 }, { x: 4, y: 4 }, 8, 8), { x: 4, y: 4, w: 1, h: 1 }, 'one pixel');
    });

    test('a drag that leaves the frame keeps the part that did not', () => {
        eq(S.rectFrom({ x: 6, y: 6 }, { x: 40, y: 40 }, 8, 8), { x: 6, y: 6, w: 2, h: 2 }, 'trimmed');
        eq(S.rectFrom({ x: -9, y: -9 }, { x: 1, y: 0 }, 8, 8), { x: 0, y: 0, w: 2, h: 1 }, 'trimmed at 0');
    });

    // ── clamp and isEmpty ───────────────────────────────────────

    test('nothing selected has one spelling, whichever way it arrived', () => {
        ok(S.isEmpty(null), 'null');
        ok(S.isEmpty({ x: 0, y: 0, w: 0, h: 4 }), 'no width');
        ok(S.isEmpty({ x: 0, y: 0, w: 4, h: 0 }), 'no height');
        ok(!S.isEmpty({ x: 0, y: 0, w: 1, h: 1 }), 'one pixel is a selection');
        eq(S.clamp({ x: 20, y: 20, w: 4, h: 4 }, 8, 8), null, 'wholly outside clamps to null');
        eq(S.clamp(null, 8, 8), null, 'null stays null');
    });

    // ── extract ─────────────────────────────────────────────────

    test('extract takes the rect and nothing around it', () => {
        const f = grid([
            'rrrr',
            'rggr',
            'rggr',
            'rrrr',
        ]);
        eq(show(S.extract(f, { x: 1, y: 1, w: 2, h: 2 })), ['gg', 'gg'], 'the middle');
        eq(S.extract(f, null), null, 'nothing selected extracts nothing');
    });

    // ── clearRegion ─────────────────────────────────────────────

    test('clearRegion empties the rect and leaves a copy, not the original', () => {
        const f = grid([
            'rrrr',
            'rggr',
            'rggr',
            'rrrr',
        ]);
        const out = S.clearRegion(f, { x: 1, y: 1, w: 2, h: 2 });
        eq(show(out), ['rrrr', 'r..r', 'r..r', 'rrrr'], 'hole punched');
        eq(show(f), ['rrrr', 'rggr', 'rggr', 'rrrr'], 'the input is untouched');
    });

    // ── stamp ───────────────────────────────────────────────────

    // The header's first decision. A clip is pixels; its holes are not paint.
    test('a transparent cell in a clip leaves what is under it alone', () => {
        const f = grid([
            'rrrr',
            'rrrr',
            'rrrr',
            'rrrr',
        ]);
        const clip = grid([
            'g.',
            '.g',
        ]);
        eq(show(S.stamp(f, clip, 1, 1)), ['rrrr', 'rgrr', 'rrgr', 'rrrr'], 'only the g cells landed');
    });

    test('a clip put down at an edge lands the part that fits', () => {
        const f = grid(['..', '..']);
        eq(show(S.stamp(f, grid(['gg', 'gg']), 1, 1)), ['..', '.g'], 'one corner of it');
        eq(show(S.stamp(f, grid(['gg', 'gg']), -1, -1)), ['g.', '..'], 'and from the other side');
        eq(show(S.stamp(f, grid(['gg']), 9, 9)), ['..', '..'], 'wholly off is simply nothing');
    });

    test('stamping nothing is a copy, not a crash', () => {
        const f = grid(['rg', 'gr']);
        eq(show(S.stamp(f, null, 0, 0)), ['rg', 'gr'], 'null clip');
        eq(show(S.stamp(f, [], 0, 0)), ['rg', 'gr'], 'empty clip');
    });

    // ── move ────────────────────────────────────────────────────

    test('a move lifts the pixels and leaves a hole behind', () => {
        const f = grid([
            'gg..',
            'gg..',
            '....',
            '....',
        ]);
        const r = S.move(f, { x: 0, y: 0, w: 2, h: 2 }, 2, 2);
        eq(show(r.frame), ['....', '....', '..gg', '..gg'], 'moved');
        eq(r.rect, { x: 2, y: 2, w: 2, h: 2 }, 'and the selection went with it');
    });

    // The reason move() exists instead of the caller calling clearRegion and
    // stamp itself. Clearing AFTER stamping eats the overlap, and the bug only
    // shows on a move shorter than the selection is wide — which is most of
    // them, because that is what nudging is.
    test('a move onto its own source keeps what landed there', () => {
        const f = grid([
            'rrr.',
            'rrr.',
            '....',
            '....',
        ]);
        const r = S.move(f, { x: 0, y: 0, w: 3, h: 2 }, 1, 0);
        eq(show(r.frame), ['.rrr', '.rrr', '....', '....'], 'shifted one, nothing eaten');
    });

    test('a move off the edge drops what went over, and does not wrap', () => {
        const f = grid([
            'rg..',
            'bb..',
            '....',
            '....',
        ]);
        const r = S.move(f, { x: 0, y: 0, w: 2, h: 2 }, -1, 0);
        eq(show(r.frame), ['g...', 'b...', '....', '....'], 'the left column is gone, not round the other side');
        eq(r.rect, { x: 0, y: 0, w: 1, h: 2 }, 'the selection reports the half that survived');
    });

    test('moving nothing changes nothing', () => {
        const f = grid(['rg', 'gr']);
        const r = S.move(f, null, 1, 1);
        eq(show(r.frame), ['rg', 'gr'], 'frame');
        eq(r.rect, null, 'rect');
    });

    test('a move does not mutate the frame it was given', () => {
        const f = grid(['gg', '..']);
        S.move(f, { x: 0, y: 0, w: 2, h: 1 }, 0, 1);
        eq(show(f), ['gg', '..'], 'untouched');
    });
}
