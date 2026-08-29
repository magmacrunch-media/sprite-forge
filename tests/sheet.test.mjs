import { test, eq, ok } from './assert.mjs';

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

    // The swatch cap used to truncate the palette and leave the pixels alone,
    // which produced a project the editor would import happily and then refuse
    // to save: project.js builds the .forge key from the pixels as well as the
    // palette, so all 471 colours of a photograph were still in there. Every
    // pixel coming out of here has to be a palette entry.
    test('the swatch cap reduces the pixels too, not just the palette', () => {
        // Six solid frames, six colours, cap of two.
        const c = framesToSheet(frames(6, 4, 4), 4, 4);
        const back = sheetToFrames(c.getContext('2d'), c.width, c.height, 4, 4, 64, 2);
        eq(back.colors, 6, 'six distinct colours were in the image');
        eq(back.palette.length, 2, 'two survived');
        const used = new Set(back.frames.flat(2).filter(Boolean));
        eq([...used].sort(), [...back.palette].sort(), 'the pixels use only those two');
    });

    test('a dropped colour lands on the nearest kept one', () => {
        // Two near-blacks and a near-white, one pixel each. The palette keeps
        // the first two seen (the counts tie, and the sort is stable), so
        // #fefefe has to snap to #ffffff rather than to #000000.
        const f = [['#000000', '#ffffff'], ['#fefefe', '#000000']];
        const c = framesToSheet([f], 2, 2);
        const back = sheetToFrames(c.getContext('2d'), 2, 2, 2, 2, 64, 2);
        eq(back.palette, ['#000000', '#ffffff'], 'the two commonest');
        eq(back.frames[0], [['#000000', '#ffffff'], ['#ffffff', '#000000']], 'near-white snapped to white');
    });

    test('transparency survives the reduction', () => {
        const f = [['#ff0000', null], [null, '#00ff00']];
        const c = framesToSheet([f], 2, 2);
        const back = sheetToFrames(c.getContext('2d'), 2, 2, 2, 2, 64, 1);
        eq(back.frames[0][0][1], null, 'still a hole');
        eq(back.frames[0][1][0], null, 'still a hole');
        eq(back.frames[0][1][1], back.palette[0], 'the dropped colour moved, the holes did not');
    });

    test('under the cap the pixels are left alone', () => {
        const src = frames(3, 4, 4);
        const c = framesToSheet(src, 4, 4);
        const back = sheetToFrames(c.getContext('2d'), c.width, c.height, 4, 4, 64, 32);
        eq(back.frames, src, 'pixels untouched');
        eq(back.colors, 3, 'colours counted anyway');
        eq(back.colors, back.palette.length, 'nothing was dropped');
    });

    test('no cap means no reduction, however many colours', () => {
        // 64 distinct greys in one 8x8 frame.
        const f = Array.from({ length: 8 }, (_, y) => Array.from({ length: 8 }, (_, x) => {
            const v = (y * 8 + x).toString(16).padStart(2, '0');
            return `#${v}${v}${v}`;
        }));
        const c = framesToSheet([f], 8, 8);
        const back = sheetToFrames(c.getContext('2d'), 8, 8, 8, 8, 64, 0);
        eq(back.colors, 64, 'all 64 counted');
        eq(back.palette.length, 64, 'all 64 kept');
        eq(back.frames[0], f, 'pixels untouched');
    });

    // The whole point of the reduction: what comes out of an import is a
    // project core/project.js can encode. 128 colours is past both the swatch
    // cap and the 89-character .forge key.
    test('a many-coloured image reduces to something project.js can save', () => {
        const f = Array.from({ length: 16 }, (_, y) => Array.from({ length: 8 }, (_, x) => {
            const v = (y * 8 + x).toString(16).padStart(2, '0');
            return `#${v}00${v}`;
        }));
        const c = framesToSheet([f], 8, 16);
        const back = sheetToFrames(c.getContext('2d'), 8, 16, 8, 16, 64, 32);
        eq(back.colors, 128, 'the image really did hold 128 colours');
        eq(back.palette.length, 32, 'cut to the swatch cap');

        const P = SF.project;
        const s = P.newSprite('imported', 8, 16);
        s.frames = back.frames;
        const text = P.stringify({ palette: back.palette, slots: null, template: null, sprites: [s] });
        ok(text.length > 0, 'it saves');
        eq(Object.keys(JSON.parse(text).key).length, 32, 'the key holds exactly the palette');
        eq(P.parse(text).sprites[0].frames, back.frames, 'and reads back pixel for pixel');
    });

    test('non-square frames keep their aspect through a round trip', () => {
        const src = [solid('#ff0000', 16, 24), solid('#00ff00', 16, 24)];
        const c = framesToSheet(src, 16, 24);
        eq([c.width, c.height], [32, 24], 'the DAG sheet shape');
        const back = sheetToFrames(c.getContext('2d'), 32, 24, 16, 24, 64, 32);
        eq(back.frames, src, 'pixels');
    });
}
