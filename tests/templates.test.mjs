import { test, eq, ok } from './assert.mjs';

export default function (SF) {
    const T = SF.templates;
    const { shadeHex } = SF.color;

    test('every shipped template is well formed', () => {
        for (const tpl of T.list())
            eq(T.validate(tpl, shadeHex), [], `template "${tpl.id}"`);
    });

    test('every template decodes to its declared size', () => {
        for (const tpl of T.list()) {
            const d = T.decode(tpl, shadeHex);
            eq([d.w, d.h], [tpl.w, tpl.h], `${tpl.id} size`);
            for (const [fi, f] of d.frames.entries()) {
                eq(f.length, tpl.h, `${tpl.id} frame ${fi} rows`);
                for (const row of f) eq(row.length, tpl.w, `${tpl.id} frame ${fi} row width`);
            }
        }
    });

    // The reason validate() checks for collisions at all: two slots resolving to
    // the same hex would make recolouring one silently move the other.
    test('no two slot/step pairs resolve to the same colour', () => {
        for (const tpl of T.list()) {
            const seen = {};
            for (const [ch, cell] of Object.entries(tpl.key)) {
                if (!cell) continue;
                const hex = shadeHex(tpl.slots[cell[0]], cell[1]);
                const id = `${cell[0]}:${cell[1]}`;
                ok(!seen[hex] || seen[hex] === id,
                    `${tpl.id}: '${ch}' (${id}) collides with ${seen[hex]} at ${hex}`);
                seen[hex] = id;
            }
        }
    });

    test('validate catches a wrong-width row', () => {
        const tpl = JSON.parse(JSON.stringify(T.get('rpg-hero')));
        tpl.frames[0][0] = tpl.frames[0][0].slice(1);
        ok(T.validate(tpl, shadeHex).some(e => e.includes('15 chars, expected 16')), 'width');
    });

    test('validate catches an unknown key character', () => {
        const tpl = JSON.parse(JSON.stringify(T.get('rpg-hero')));
        tpl.frames[0][0] = 'Z'.repeat(16);
        ok(T.validate(tpl, shadeHex).some(e => e.includes("unknown key 'Z'")), 'unknown char');
    });

    test('DAG sprites are 16x24 with the origin at the feet', () => {
        // transatlantic_colleague's README pins this: origin = feet, and
        // tools/import_sprite_sheet.py refuses a sheet that disagrees.
        for (const tpl of T.list().filter(t => t.id.startsWith('dag-'))) {
            eq([tpl.w, tpl.h], [16, 24], `${tpl.id} size`);
            eq(tpl.origin, [8, 24], `${tpl.id} origin`);
        }
    });

    test('DAG frame counts match what the .yy files declare', () => {
        const expected = { 'dag-idle-down': 2, 'dag-idle-up': 2, 'dag-idle-left': 2,
                           'dag-walk-down': 4, 'dag-walk-up': 4, 'dag-walk-left': 4 };
        for (const [id, n] of Object.entries(expected))
            eq(T.get(id).frames.length, n, `${id} frames`);
    });

    test('a template palette is grouped by slot, dark to light', () => {
        const d = T.decode(T.get('dag-walk-down'), shadeHex);
        // steps within each slot must be ascending
        for (const [slot, steps] of Object.entries(d.steps))
            eq(steps, [...steps].sort((a, b) => a - b), `${slot} steps ascending`);
        eq(d.palette.length, Object.values(d.steps).flat().length, 'one swatch per slot/step');
    });
}
