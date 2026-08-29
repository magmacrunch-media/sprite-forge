// color.js — hex/RGB/HSL conversion and the pixel-art shade ramp.
//
// Extracted from the editor unchanged. It is in core/ because three things
// outside the DOM need it: templates.js resolves a slot's base colour to its
// shades, sheet.js needs hex -> RGB to compose a PNG, and the .forge loader
// needs to recognise a palette entry. None of them can reach into the editor.
//
// Pure, no DOM, no state beyond one memo cache.

window.SpriteForge = window.SpriteForge || {};
window.SpriteForge.color = (function () {

    // Memoised because a single frame render calls this once per opaque pixel,
    // and a 128x128 frame is 16k lookups of a few dozen distinct colours.
    const rgbCache = {};

    function hexToRgb(hex) {
        return rgbCache[hex] || (rgbCache[hex] = [
            parseInt(hex.slice(1, 3), 16),
            parseInt(hex.slice(3, 5), 16),
            parseInt(hex.slice(5, 7), 16),
        ]);
    }

    function hexToHsl(hex) {
        const [r, g, b] = hexToRgb(hex).map(v => v / 255);
        const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
        if (max === min) return [0, 0, l];
        const d = max - min;
        const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        let h;
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
        return [h * 360, s, l];
    }

    function hslToHex(h, s, l) {
        h = ((h % 360) + 360) % 360 / 360;
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
        const f = (t) => {
            t = ((t % 1) + 1) % 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        return '#' + [f(h + 1 / 3), f(h), f(h - 1 / 3)]
            .map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
    }

    // One shade of a colour, as a step on a pixel-art ramp: shadows shift hue
    // toward blue and gain saturation, highlights shift toward yellow and lose
    // it.
    //
    // Step 0 returns the base string itself rather than round-tripping through
    // HSL. Exact-string hex lookups depend on it — slot recolouring, palette
    // membership and the .forge key all compare hexes with === — so this makes
    // identity a guarantee of the code rather than a property of the arithmetic.
    //
    // The inherited comment here claimed the round trip drifts (#f0c090 coming
    // back as #f0c08f). It does not: hslToHex rounds to the nearest byte, and a
    // sweep of 140,608 sampled colours plus every colour this project uses
    // round-trips exactly. The short circuit is kept anyway — it is free, and
    // it means a future change to hslToHex cannot quietly break the invariant.
    function shadeHex(base, step) {
        if (!step) return base;
        const [h, s, l] = hexToHsl(base);
        const dl = 0.11 * step;
        return hslToHex(
            h - 8 * step,
            step < 0 ? Math.min(1, s + 0.04 * -step) : Math.max(0, s - 0.04 * step),
            Math.max(0.06, Math.min(0.94, l + dl)),
        );
    }

    /**
     * The entry of `palette` nearest `hex`, by squared distance in RGB.
     *
     * Plain RGB rather than a perceptual space, on purpose: the caller that
     * needs this is snapping an imported PNG onto swatches harvested from that
     * same PNG, so every candidate is already one of the image's own colours
     * and the nearest of them is nearest under any metric worth the arithmetic.
     * Ties go to the earlier entry, which is the commonest colour when the
     * palette came from sheet.js.
     *
     * Returns null for an empty palette — there is no nearest anything.
     */
    function nearestHex(hex, palette) {
        const [r, g, b] = hexToRgb(hex);
        let best = null, bestD = Infinity;
        for (const c of palette) {
            const [cr, cg, cb] = hexToRgb(c);
            const dr = r - cr, dg = g - cg, db = b - cb;
            const d = dr * dr + dg * dg + db * db;
            if (d < bestD) { bestD = d; best = c; }
        }
        return best;
    }

    return { hexToRgb, hexToHsl, hslToHex, shadeHex, nearestHex };
})();
