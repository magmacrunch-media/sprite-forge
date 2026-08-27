// draw.js — shape rasterisation and flood fill over a plain pixel grid.
//
// A grid here is frames[i] from the editor: grid[y][x] is '#rrggbb' or null.
// Nothing in this file knows about a canvas, the current tool, or undo.
//
// bresenham and shapePixels moved from the editor unchanged. floodFill did not:
// it used to read the live frame through frame() and the frameW/frameH globals
// and mutate in place, which is exactly the coupling that stopped the editor
// being reusable. It now takes the grid and derives the bounds from it.

window.SpriteForge = window.SpriteForge || {};
window.SpriteForge.draw = (function () {

    function bresenham(x0, y0, x1, y1) {
        const pts = [];
        const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
        const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
        let err = dx - dy, x = x0, y = y0;
        for (;;) {
            pts.push([x, y]);
            if (x === x1 && y === y1) break;
            const e2 = 2 * err;
            if (e2 > -dy) { err -= dy; x += sx; }
            if (e2 < dx) { err += dx; y += sy; }
        }
        return pts;
    }

    function shapePixels(kind, x0, y0, x1, y1) {
        if (kind === 'line') return bresenham(x0, y0, x1, y1);
        const xa = Math.min(x0, x1), xb = Math.max(x0, x1);
        const ya = Math.min(y0, y1), yb = Math.max(y0, y1);
        const pts = [];
        if (kind === 'rect') {
            for (let x = xa; x <= xb; x++) pts.push([x, ya], [x, yb]);
            for (let y = ya + 1; y < yb; y++) pts.push([xa, y], [xb, y]);
            return pts;
        }
        // ellipse outline inscribed in the drag box; plot from both axes to avoid gaps
        const rx = (xb - xa) / 2, ry = (yb - ya) / 2;
        const cx = (xa + xb) / 2, cy = (ya + yb) / 2;
        if (rx < 0.5 || ry < 0.5) return bresenham(x0, y0, x1, y1);
        for (let x = xa; x <= xb; x++) {
            const dy = ry * Math.sqrt(Math.max(0, 1 - ((x - cx) / rx) ** 2));
            pts.push([x, Math.round(cy - dy)], [x, Math.round(cy + dy)]);
        }
        for (let y = ya; y <= yb; y++) {
            const dx = rx * Math.sqrt(Math.max(0, 1 - ((y - cy) / ry) ** 2));
            pts.push([Math.round(cx - dx), y], [Math.round(cx + dx), y]);
        }
        return pts;
    }

    /**
     * Four-way flood fill, mutating `grid` in place. Bounds come from the grid
     * itself, so a caller cannot desynchronise them from the pixels the way the
     * old frameW/frameH globals could.
     */
    function floodFill(grid, x, y, from, to) {
        if (from === to) return;
        const h = grid.length;
        if (!h) return;
        const w = grid[0].length;
        const stack = [[x, y]];
        while (stack.length) {
            const [cx, cy] = stack.pop();
            if (cx < 0 || cx >= w || cy < 0 || cy >= h) continue;
            if (grid[cy][cx] !== from) continue;
            grid[cy][cx] = to;
            stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
        }
    }

    return { bresenham, shapePixels, floodFill };
})();
