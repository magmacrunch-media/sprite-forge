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
