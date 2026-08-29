import { test, eq, ok, throws } from './assert.mjs';

export default function (SF) {

    test('uniqueName keeps sprite names from colliding', () => {
        const P = SF.project;
        eq(P.uniqueName('dag', []), 'dag', 'nothing taken');
        eq(P.uniqueName('dag', ['dag']), 'dag-2', 'taken once');
        eq(P.uniqueName('dag', ['dag', 'dag-2']), 'dag-3', 'taken twice');
        eq(P.uniqueName('  ', []), 'sprite', 'blank falls back');
        eq(P.uniqueName(null, ['sprite']), 'sprite-2', 'so does nothing at all');
    });

    test('two sprites cannot share a name, in either direction', () => {
        const P = SF.project;
        const one = P.blank(2, 2, ['#ffffff']);
        const two = {
            ...one,
            sprites: [
                { ...one.sprites[0], name: 'dag' },
                { ...one.sprites[0], name: 'dag' },
            ],
        };
        // Saving has to refuse it as well as loading: a file that can be
        // written and not read back is a way to lose work.
        throws(() => P.stringify(two), 'has this name', 'stringify refuses');
        const ok = {
            ...one,
            sprites: [
                { ...one.sprites[0], name: 'dag' },
                { ...one.sprites[0], name: 'dag-2' },
            ],
        };
        eq(P.parse(P.stringify(ok)).sprites.map(s => s.name), ['dag', 'dag-2'], 'distinct names round-trip');
    });
    const P = SF.project;

    const sample = () => ({
        palette: ['#1c2733', '#f4d5b5', '#34495e'],
        slots: { coat: '#34495e' },
        template: 'dag-walk-down',
        sprites: [{
            name: 'spr_player_walk_down', w: 4, h: 3,
            origin: { x: 2, y: 3 }, fps: 8,
            frames: [
                [[null, '#1c2733', '#1c2733', null],
                 ['#1c2733', '#f4d5b5', '#f4d5b5', '#1c2733'],
                 [null, '#34495e', '#34495e', null]],
                [[null, null, null, null],
                 ['#1c2733', '#1c2733', '#1c2733', '#1c2733'],
                 [null, '#34495e', '#34495e', null]],
            ],
        }],
    });

    test('round trip preserves every pixel', () => {
        const before = sample();
        const after = P.parse(P.stringify(before));
        eq(after.sprites[0].frames, before.sprites[0].frames, 'frames');
        eq(after.palette, before.palette, 'palette');
        eq(after.slots, before.slots, 'slots');
        eq(after.template, before.template, 'template');
        eq(after.sprites[0].origin, before.sprites[0].origin, 'origin');
        eq(after.sprites[0].fps, before.sprites[0].fps, 'fps');
    });

    test('frames serialise as readable rows, transparent as "."', () => {
        const o = P.serialize(sample());
        eq(o.sprites[0].frames[0].length, 3, 'row count');
        for (const row of o.sprites[0].frames[0]) eq(row.length, 4, 'row width');
        ok(o.sprites[0].frames[1][0] === '....', 'a fully transparent row is "...."');
        ok(!JSON.stringify(o).includes('\\"'), 'no escaped quotes in the encoding');
    });

    test('key covers colours drawn but never in the palette', () => {
        const p = sample();
        p.sprites[0].frames[0][0][0] = '#ff00ff';   // painted, then dropped from the palette
        const o = P.serialize(p);
        ok(Object.values(o.key).includes('#ff00ff'), '#ff00ff is in the key');
        eq(P.parse(JSON.stringify(o)).sprites[0].frames[0][0][0], '#ff00ff', 'survives the round trip');
    });

    test('key keeps a palette swatch that no pixel uses', () => {
        const p = sample();
        p.palette.push('#abcdef');
        const o = P.serialize(p);
        ok(Object.values(o.key).includes('#abcdef'), 'unused swatch survives');
        eq(P.parse(JSON.stringify(o)).palette.includes('#abcdef'), true, 'and comes back');
    });

    test('a hand-edited short row names the sprite, frame and row', () => {
        const o = P.serialize(sample());
        o.sprites[0].frames[0][1] = 'abc';           // one char short
        const errs = P.validate(o);
        ok(errs.length === 1, `one error, got ${errs.length}: ${errs}`);
        ok(errs[0].includes('spr_player_walk_down'), 'names the sprite');
        ok(errs[0].includes('frame 0'), 'names the frame');
        ok(errs[0].includes('row 1'), 'names the row');
        ok(errs[0].includes('3 chars, expected 4'), 'says what is wrong');
    });

    test('an unknown key character is reported, not silently dropped', () => {
        const o = P.serialize(sample());
        o.sprites[0].frames[0][0] = '.ZZ.';
        const errs = P.validate(o);
        ok(errs.some(e => e.includes("unknown key 'Z'")), `got ${JSON.stringify(errs)}`);
    });

    test('wrong row count is reported', () => {
        const o = P.serialize(sample());
        o.sprites[0].frames[0].pop();
        ok(P.validate(o).some(e => e.includes('2 rows, expected 3')), 'row count');
    });

    test('parse throws with every problem listed, not just the first', () => {
        const o = P.serialize(sample());
        o.sprites[0].frames[0][0] = 'ab';
        o.sprites[0].frames[0][1] = 'cd';
        throws(() => P.parse(JSON.stringify(o)), 'row 0', 'first problem');
        try { P.parse(JSON.stringify(o)); } catch (e) {
            ok(e.message.includes('row 1'), 'second problem is listed too');
        }
    });

    test('a future format version is refused by name, not misread', () => {
        const o = P.serialize(sample());
        o.format = 'sprite-forge/2';
        throws(() => P.parse(JSON.stringify(o)), 'sprite-forge/2', 'names the version it saw');
        throws(() => P.parse(JSON.stringify(o)), 'sprite-forge/1', 'and the one it reads');
    });

    test('non-JSON says so', () => {
        throws(() => P.parse('{ not json'), 'not JSON');
    });

    test('"." cannot be reused as a key character', () => {
        const o = P.serialize(sample());
        o.key['.'] = '#123456';
        ok(P.validate(o).some(e => e.includes('reserved')), 'reserved char rejected');
    });

    test('a bad colour in the key is caught', () => {
        const o = P.serialize(sample());
        o.key.a = 'red';
        ok(P.validate(o).some(e => e.includes('not a #rrggbb colour')), 'bad colour');
    });

    test('blank() is a valid project that round trips', () => {
        const p = P.blank(8, 8, ['#000000', '#ffffff']);
        eq(P.validate(P.serialize(p)), [], 'blank validates');
        eq(P.parse(P.stringify(p)).sprites[0].frames[0].length, 8, 'height survives');
    });

    test('more colours than the alphabet holds fails loudly', () => {
        const p = P.blank(64, 64, []);
        const f = p.sprites[0].frames[0];
        let n = 0;
        for (let y = 0; y < 64 && n <= P.ALPHABET.length; y++)
            for (let x = 0; x < 64 && n <= P.ALPHABET.length; x++)
                f[y][x] = '#' + (n++).toString(16).padStart(6, '0');
        throws(() => P.serialize(p), 'the .forge key holds', 'over-capacity');
    });

    // ── the colour ceiling ──────────────────────────────────
    //
    // The key holds 89 and the palette UI holds 32, but nothing binds a
    // sprite's pixels to the palette: import a PNG into each of three sprites,
    // or apply a theme between drawing sessions, and the project carries
    // colours no swatch points at any more. Three imports is ninety-six.
    // reduce() is the way back under, and it is the only one.

    /** A project of `n` sprites, each holding `each` colours nothing else uses. */
    function spread(n, each, palette) {
        return {
            palette: palette || [],
            slots: null,
            template: null,
            sprites: Array.from({ length: n }, (_, si) => {
                const s = SF.project.newSprite(`s${si}`, each, 1);
                s.frames = [[Array.from({ length: each }, (_, i) =>
                    '#' + si.toString(16).padStart(2, '0') + i.toString(16).padStart(4, '0'))]];
                return s;
            }),
        };
    }

    test('colorsOf counts the palette and the pixels together', () => {
        const P = SF.project;
        const p = spread(3, 32);
        eq(P.colorsOf(p).length, 96, 'three sprites of 32');
        p.palette = ['#ff0000'];
        eq(P.colorsOf(p).length, 97, 'a swatch no pixel uses still counts');
        p.palette = [p.sprites[0].frames[0][0][0]];
        eq(P.colorsOf(p).length, 96, 'a swatch the pixels already use does not double');
    });

    test('a three-import project is over the key, and reduce brings it under', () => {
        const P = SF.project;
        const p = spread(3, 32);
        eq(P.colorsOf(p).length, 96, '96 colours');
        throws(() => P.stringify(p), 'the .forge key holds', 'will not save as it stands');

        const r = P.reduce(p, P.ALPHABET.length);
        eq(P.colorsOf(r).length, P.ALPHABET.length, 'exactly at the limit');
        ok(P.stringify(r).length > 0, 'and it saves');
        eq(P.parse(P.stringify(r)).sprites.length, 3, 'all three sprites survive');
    });

    test('reduce leaves every pixel a real colour and every sprite its shape', () => {
        const P = SF.project;
        const p = spread(4, 30);
        const r = P.reduce(p, 40);
        const kept = new Set(P.colorsOf(r));
        eq(kept.size, 40, 'at the limit');
        for (const [i, s] of r.sprites.entries()) {
            eq([s.w, s.h], [p.sprites[i].w, p.sprites[i].h], `${s.name} size`);
            eq(s.name, p.sprites[i].name, 'name');
            for (const px of s.frames.flat(2))
                ok(px === null || kept.has(px), `${s.name}: ${px} is one of the kept colours`);
        }
    });

    test('reduce keeps the whole palette, swatches nothing has used included', () => {
        const P = SF.project;
        // Ten deliberate swatches no pixel touches, against 96 pixel colours.
        const mixed = Array.from({ length: 10 }, (_, i) => '#ff' + i.toString(16).padStart(4, '0'));
        const p = spread(3, 32, mixed);
        const r = P.reduce(p, P.ALPHABET.length);
        eq(r.palette, mixed, 'every swatch survives, in order');
        for (const hex of mixed) ok(P.colorsOf(r).includes(hex), `${hex} still in the project`);
    });

    test('reduce keeps the commonest pixel colours and drops the rarest', () => {
        const P = SF.project;
        // '#000000' fills 8 pixels; the other four appear once each.
        const s = P.newSprite('dag', 4, 3);
        s.frames = [[
            ['#000000', '#000000', '#000000', '#000000'],
            ['#000000', '#000000', '#000000', '#000000'],
            ['#0000ff', '#00ff00', '#ff0000', '#ffffff'],
        ]];
        const r = P.reduce({ palette: [], slots: null, template: null, sprites: [s] }, 2);
        const kept = P.colorsOf(r);
        eq(kept.length, 2, 'two colours');
        ok(kept.includes('#000000'), 'the one carrying the art survives');
        eq(r.sprites[0].frames[0][0][0], '#000000', 'and the pixels using it are untouched');
    });

    test('reduce remaps slots, so a recolour still has something to recolour', () => {
        const P = SF.project;
        const p = spread(3, 32);
        const doomed = p.sprites[2].frames[0][0][31];   // last colour of the last sprite
        p.slots = { coat: doomed };
        const r = P.reduce(p, P.ALPHABET.length);
        const kept = new Set(P.colorsOf(r));
        ok(kept.has(r.slots.coat), `slot points at a live colour, not ${doomed}`);
    });

    test('reduce is a no-op, by identity, for a project already inside the limit', () => {
        const P = SF.project;
        const p = spread(2, 4);
        eq(P.colorsOf(p).length, 8, 'well under');
        ok(P.reduce(p, P.ALPHABET.length) === p, 'the same object back, not a copy');
    });

    test('reduce does not touch the project it was given', () => {
        const P = SF.project;
        const p = spread(3, 32);
        const before = JSON.stringify(p);
        P.reduce(p, P.ALPHABET.length);
        eq(JSON.stringify(p), before, 'the original is unchanged');
    });

    test('reduce defaults to the key size and never goes below one colour', () => {
        const P = SF.project;
        const p = spread(3, 32);
        eq(P.colorsOf(P.reduce(p)).length, P.ALPHABET.length, 'no limit means the key');
        eq(P.colorsOf(P.reduce(p, 0)).length, P.ALPHABET.length, '0 is not a limit either');
        eq(P.colorsOf(P.reduce(p, -5)).length, 1, 'a negative one clamps to a single colour');
    });

    test('reduce keeps transparency transparent', () => {
        const P = SF.project;
        const s = P.newSprite('dag', 3, 1);
        s.frames = [[['#ff0000', null, '#00ff00']]];
        const r = P.reduce({ palette: [], slots: null, template: null, sprites: [s] }, 1);
        eq(r.sprites[0].frames[0][0][1], null, 'the hole is still a hole');
        eq(P.colorsOf(r).length, 1, 'and the two colours became one');
    });

    test('multi-sprite projects share one palette and key', () => {
        const p = sample();
        p.sprites.push({
            name: 'spr_player_walk_up', w: 4, h: 3, origin: { x: 2, y: 3 }, fps: 8,
            frames: [[['#34495e', null, null, null], [null, null, null, null], [null, null, null, null]]],
        });
        const o = P.serialize(p);
        eq(Object.keys(o).includes('key'), true, 'one shared key');
        const back = P.parse(JSON.stringify(o));
        eq(back.sprites.length, 2, 'both sprites');
        eq(back.sprites[1].frames[0][0][0], '#34495e', 'second sprite pixels');
    });
}
