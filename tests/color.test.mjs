import { test, eq, ok } from './assert.mjs';

export default function (SF) {
    const { hexToRgb, hexToHsl, hslToHex, shadeHex } = SF.color;

    test('hexToRgb parses the channels', () => {
        eq(hexToRgb('#000000'), [0, 0, 0], 'black');
        eq(hexToRgb('#ffffff'), [255, 255, 255], 'white');
        eq(hexToRgb('#34495e'), [52, 73, 94], 'the DAG coat');
    });

    // The reason step 0 is special-cased rather than round-tripped through HSL.
    test('step 0 returns the base string verbatim', () => {
        for (const hex of ['#f0c090', '#34495e', '#7cb342', '#e0483c', '#1a1526'])
            eq(shadeHex(hex, 0), hex, `${hex} unchanged`);
    });

    // Pins the finding that corrected shadeHex's comment: the HSL round trip
    // does NOT drift, because hslToHex rounds to the nearest byte. If someone
    // later changes that rounding, this fails and says so, and the step-0 short
    // circuit is the only thing still holding the exact-string invariant up.
    test('the HSL round trip is lossless for 8-bit colours', () => {
        const drifted = [];
        for (let r = 0; r < 256; r += 17)
            for (let g = 0; g < 256; g += 17)
                for (let b = 0; b < 256; b += 17) {
                    const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
                    if (hslToHex(...hexToHsl(hex)) !== hex) drifted.push(hex);
                }
        eq(drifted.slice(0, 5), [], 'colours that drift through HSL');
    });

    test('shadows darken and highlights lighten', () => {
        const l = hex => hexToHsl(hex)[2];
        for (const base of ['#34495e', '#e0483c', '#3a6ea5', '#7cb342']) {
            ok(l(shadeHex(base, -1)) < l(base), `${base} -1 is darker`);
            ok(l(shadeHex(base, -2)) < l(shadeHex(base, -1)), `${base} -2 is darker still`);
            ok(l(shadeHex(base, 1)) > l(base), `${base} +1 is lighter`);
        }
    });

    test('shadows gain saturation, highlights lose it', () => {
        const s = hex => hexToHsl(hex)[1];
        const base = '#3a6ea5';
        ok(s(shadeHex(base, -1)) > s(base), 'shadow more saturated');
        ok(s(shadeHex(base, 1)) < s(base), 'highlight less saturated');
    });

    test('every shade is a well-formed hex', () => {
        for (const base of ['#000000', '#ffffff', '#34495e', '#f4d5b5'])
            for (const step of [-2, -1, 0, 1, 2])
                ok(/^#[0-9a-f]{6}$/.test(shadeHex(base, step)), `${base} ${step}`);
    });

    test('lightness is clamped, so black and white still produce a ramp', () => {
        ok(shadeHex('#000000', -2) !== shadeHex('#000000', 2), 'black ramps');
        ok(shadeHex('#ffffff', -2) !== shadeHex('#ffffff', 2), 'white ramps');
    });

    test('hexToRgb memoises without aliasing callers', () => {
        // Same array identity is fine, but a caller must not be able to corrupt
        // the cache for everyone else through a returned reference.
        const a = hexToRgb('#123456');
        eq(a, [18, 52, 86], 'value');
        eq(hexToRgb('#123456'), [18, 52, 86], 'second read matches');
    });
}
