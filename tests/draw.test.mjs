import { test, eq, ok } from './assert.mjs';

export default function (SF) {
    const { bresenham, shapePixels, floodFill } = SF.draw;
    const key = ps => ps.map(p => p.join(',')).join(' ');
    const grid = (w, h, fill = null) =>
        Array.from({ length: h }, () => Array(w).fill(fill));

    test('a line is symmetric end to end', () => {
        const fwd = bresenham(0, 0, 7, 3);
        const rev = bresenham(7, 3, 0, 0);
        eq(key(fwd), key([...rev].reverse()), 'reversed');
    });

    test('a zero-length line is one point', () => eq(bresenham(4, 4, 4, 4), [[4, 4]], 'single'));

    test('a vertical line has no gaps', () => {
        const pts = bresenham(5, 5, 5, 0);
        eq(pts.length, 6, 'six points');
        ok(pts.every(p => p[0] === 5), 'all on x=5');
    });

    test('rect is an outline, not a fill', () => {
        const pts = shapePixels('rect', 2, 3, 11, 9);
        const inside = pts.filter(([x, y]) => x > 2 && x < 11 && y > 3 && y < 9);
        eq(inside.length, 0, 'nothing inside the border');
        ok(pts.some(([x, y]) => x === 2 && y === 3), 'has the corner');
    });

    test('a degenerate rect is a single point', () => eq(shapePixels('rect', 4, 4, 4, 4), [[4, 4], [4, 4]], 'point twice'));

    test('a too-thin ellipse falls back to a line', () => {
        eq(key(shapePixels('ellipse', 4, 4, 4, 4)), key(bresenham(4, 4, 4, 4)), 'degenerate');
        eq(key(shapePixels('ellipse', 0, 0, 9, 0)), key(bresenham(0, 0, 9, 0)), 'zero height');
    });

    test('an ellipse stays inside its drag box', () => {
        for (const [x0, y0, x1, y1] of [[2, 3, 11, 9], [0, 0, 15, 15], [3, 1, 8, 12]]) {
            const pts = shapePixels('ellipse', x0, y0, x1, y1);
            ok(pts.every(([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1),
                `ellipse ${x0},${y0}-${x1},${y1} within box`);
        }
    });

    test('an ellipse is plotted from both axes, so it has no gaps', () => {
        // Every row the ellipse spans must contain at least one plotted pixel.
        const pts = shapePixels('ellipse', 2, 3, 11, 9);
        const rows = new Set(pts.map(p => p[1]));
        for (let y = 3; y <= 9; y++) ok(rows.has(y), `row ${y} is plotted`);
    });

    test('flood fill takes its bounds from the grid it is given', () => {
        const g = grid(4, 3);
        floodFill(g, 0, 0, null, '#ff00ff');
        eq(g.flat().filter(c => c === '#ff00ff').length, 12, 'whole grid filled');
    });

    test('flood fill respects a barrier', () => {
        const g = grid(5, 3);
        for (let y = 0; y < 3; y++) g[y][2] = '#000000';   // wall down the middle
        floodFill(g, 0, 0, null, '#ff00ff');
        eq(g.map(r => r.map(c => c === '#ff00ff' ? 'F' : c ? 'W' : '.').join('')),
            ['FFW..', 'FFW..', 'FFW..'], 'stopped at the wall');
    });

    test('filling with the colour already there is a no-op, not a hang', () => {
        const g = grid(3, 3, '#123456');
        floodFill(g, 1, 1, '#123456', '#123456');
        eq(g.flat().filter(c => c === '#123456').length, 9, 'unchanged');
    });

    test('an out-of-bounds seed does nothing', () => {
        const g = grid(3, 3);
        floodFill(g, 99, 99, null, '#ff00ff');
        eq(g.flat().filter(Boolean).length, 0, 'no pixels written');
    });

    test('a non-square grid uses its own width per row', () => {
        const g = grid(7, 2);
        floodFill(g, 6, 1, null, '#ff00ff');
        eq(g.flat().filter(c => c === '#ff00ff').length, 14, 'all 7x2 filled');
    });
}
