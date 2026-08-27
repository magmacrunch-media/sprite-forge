import { test, eq } from './assert.mjs';

// These pin the shared sheet contract: uniform grid, left-to-right then
// top-to-bottom, origin never in the PNG. adenosine (TS), magnolia (C/Wii),
// texastoast (Python) and the GameMaker importer all assume it. Spec:
// adenosine/packages/rpg/API.md, sprites.ts. Breaking one of these is a
// four-repo break, so they are deliberately fussy about ordering.
export default function (SF) {
    const { frameToImageData, framesToSheet, sheetToFrames } = SF.sheet;

    // Frame i is a solid block of colour i, so ordering is readable from pixels.
    const COLORS = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'];
    const solid = (hex, w, h) => Array.from({ length: h }, () => Array(w).fill(hex));
    const frames = (n, w, h) => COLORS.slice(0, n).map(c => solid(c, w, h));
    const firstPixel = f => f[0][0];

    test('a frame becomes opaque RGBA, transparent stays zero', () => {
        const img = frameToImageData([['#ff0000', null]], 2, 1);
        eq([...img.data.slice(0, 4)], [255, 0, 0, 255], 'opaque red');
        eq([...img.data.slice(4, 8)], [0, 0, 0, 0], 'transparent');
    });

    test('default layout is one row, so frame index == column', () => {
        const c = framesToSheet(frames(4, 8, 12), 8, 12);
        eq([c.width, c.height], [32, 12], 'N x 1 strip');
    });

    test('round trip is lossless at one row', () => {
        const src = frames(4, 8, 12);
        const c = framesToSheet(src, 8, 12);
        const back = sheetToFrames(c.getContext('2d'), c.width, c.height, 8, 12, 64, 32);
        eq(back.frames, src, 'pixels');
        eq(back.truncated, false, 'not truncated');
    });

    test('multi-row sheets slice left-to-right THEN top-to-bottom', () => {
        const src = frames(6, 4, 4);
        const c = framesToSheet(src, 4, 4, 3);            // 3 columns, 2 rows
        eq([c.width, c.height], [12, 8], '3x2 grid');
        const back = sheetToFrames(c.getContext('2d'), c.width, c.height, 4, 4, 64, 32);
        eq(back.frames.map(firstPixel), COLORS.slice(0, 6), 'reading order preserved');
    });

    test('a partial last row does not shift the frames before it', () => {
        const src = frames(5, 4, 4);
        const c = framesToSheet(src, 4, 4, 3);            // 3 + 2
        eq([c.width, c.height], [12, 8], 'still a 3x2 grid');
        const back = sheetToFrames(c.getContext('2d'), c.width, c.height, 4, 4, 64, 32);
        // The 6th cell was never written, so it reads back fully transparent.
        eq(back.frames.slice(0, 5).map(firstPixel), COLORS.slice(0, 5), 'the five real frames');
        eq(back.frames[5].flat().filter(Boolean).length, 0, 'the empty cell is transparent');
    });

    test('cols is clamped, never zero or wider than the frame count', () => {
        eq(framesToSheet(frames(3, 4, 4), 4, 4, 0).width, 12, 'cols 0 -> one row');
        eq(framesToSheet(frames(3, 4, 4), 4, 4, 99).width, 12, 'cols > n -> one row');
        eq(framesToSheet(frames(3, 4, 4), 4, 4, 1).height, 12, 'cols 1 -> one column');
    });

    test('palette is ordered by pixel count, commonest first', () => {
        // 3 red pixels, 1 blue.
        const f = [['#ff0000', '#ff0000'], ['#ff0000', '#0000ff']];
        const c = framesToSheet([f], 2, 2);
        const back = sheetToFrames(c.getContext('2d'), 2, 2, 2, 2, 64, 32);
        eq(back.palette, ['#ff0000', '#0000ff'], 'commonest first');
    });

    test('sub-50% alpha becomes transparent; there is no partial alpha', () => {
        const c = framesToSheet([[['#ff0000']]], 1, 1);
        const ctx = c.getContext('2d');
        const img = ctx.getImageData(0, 0, 1, 1);
        img.data[3] = 127;                               // just under half
        ctx.putImageData(img, 0, 0);
        eq(sheetToFrames(ctx, 1, 1, 1, 1, 64, 32).frames[0][0][0], null, '127 -> transparent');
        img.data[3] = 128;
        ctx.putImageData(img, 0, 0);
        eq(sheetToFrames(ctx, 1, 1, 1, 1, 64, 32).frames[0][0][0], '#ff0000', '128 -> opaque');
    });

    test('an indivisible sheet reports truncation instead of failing', () => {
        const c = framesToSheet(frames(3, 4, 4), 4, 4);   // 12x4
        const back = sheetToFrames(c.getContext('2d'), c.width, c.height, 5, 4, 64, 32);
        eq(back.frames.length, 2, 'two whole 5-wide frames fit');
        eq(back.truncated, true, 'and it says so');
    });

    test('a frame larger than the image returns null', () => {
        const c = framesToSheet(frames(1, 4, 4), 4, 4);
        eq(sheetToFrames(c.getContext('2d'), 4, 4, 5, 5, 64, 32), null, 'null, not a throw');
    });

    test('frame and swatch caps are honoured', () => {
        const c = framesToSheet(frames(6, 4, 4), 4, 4);
        eq(sheetToFrames(c.getContext('2d'), c.width, c.height, 4, 4, 3, 32).frames.length, 3, 'frame cap');
        eq(sheetToFrames(c.getContext('2d'), c.width, c.height, 4, 4, 64, 2).palette.length, 2, 'swatch cap');
    });

    test('non-square frames keep their aspect through a round trip', () => {
        const src = [solid('#ff0000', 16, 24), solid('#00ff00', 16, 24)];
        const c = framesToSheet(src, 16, 24);
        eq([c.width, c.height], [32, 24], 'the DAG sheet shape');
        const back = sheetToFrames(c.getContext('2d'), 32, 24, 16, 24, 64, 32);
        eq(back.frames, src, 'pixels');
    });
}
