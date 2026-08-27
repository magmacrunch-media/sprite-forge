import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { test, eq, ok, throws } from './assert.mjs';

// The reference project lives beside this repo. When it is not checked out the
// .yy-shaped tests report a skip rather than a pass — but the synthetic ones,
// which encode the rules, always run.
const TC = join(process.cwd(), '..', 'transatlantic_colleague');
const yyPath = spr => join(TC, 'sprites', spr, spr + '.yy');
const haveTC = existsSync(yyPath('spr_player_walk_down'));

export default function (SF) {
    const GM = SF.targets.gamemaker;
    const grid = (w, h) => Array.from({ length: h }, () => Array(w).fill('#ff0000'));

    // A minimal .yy carrying only what the planner reads, with GameMaker's
    // trailing commas intact — those are the whole reason for a line-level edit.
    const fakeYy = (nFrames) => [
        '{',
        '  "$GMSprite":"v2",',
        '  "%Name":"spr_test",',
        '  "bboxMode":0,',
        '  "bbox_bottom":19,',
        '  "bbox_left":0,',
        '  "bbox_right":15,',
        '  "bbox_top":0,',
        '  "frames":[',
        ...Array.from({ length: nFrames }, (_, i) =>
            '    {"$GMSpriteFrame":"v1","%Name":"' + String(i).repeat(8) +
            '-aaaa-bbbb-cccc-dddddddddddd","resourceVersion":"2.0",},'),
        '  ],',
        '  "height":20,',
        '  "layers":[',
        '    {"$GMImageLayer":"","%Name":"70218f7b-de81-436b-81ad-98a4d0b5ff3d","displayName":"default","resourceVersion":"2.0",},',
        '  ],',
        '  "width":16,',
        '  "backdropWidth":1366,',
        '  "backdropHeight":768,',
        '  "xorigin":8,',
        '  "yorigin":20,',
        '}',
    ].join('\n');

    test('reads frame and layer GUIDs out of the .yy', () => {
        const { frameGuids, layerGuid } = GM.readGuids(fakeYy(4), 'spr_test');
        eq(frameGuids.length, 4, 'four frames');
        eq(layerGuid, '70218f7b-de81-436b-81ad-98a4d0b5ff3d', 'the image layer');
    });

    test('every frame gets BOTH a frame png and a layers/ copy', () => {
        const p = GM.plan({
            yyText: fakeYy(2), spriteName: 'spr_test',
            frames: [grid(16, 24), grid(16, 24)], w: 16, h: 24, originX: 8, originY: 24,
        });
        eq(p.writes.length, 4, 'two frames x two files');
        for (let i = 0; i < 2; i++) {
            const forFrame = p.writes.filter(wr => wr.frame === i);
            eq(forFrame.length, 2, 'frame ' + i + ' has two writes');
            ok(forFrame.some(wr => /sprites\/spr_test\/[0-9a-f-]+\.png$/.test(wr.path)),
                'frame ' + i + ' top-level png');
            ok(forFrame.some(wr => wr.path.includes('/layers/')), 'frame ' + i + ' layers copy');
        }
    });

    test('the layers copy is keyed by frame guid then layer guid', () => {
        const p = GM.plan({
            yyText: fakeYy(1), frames: [grid(16, 24)], spriteName: 'spr_test',
            w: 16, h: 24, originX: 8, originY: 24,
        });
        const layer = p.writes.find(wr => wr.path.includes('/layers/'));
        const frame = p.writes.find(wr => !wr.path.includes('/layers/'));
        const guid = frame.path.split('/').pop().replace('.png', '');
        eq(layer.path,
            'sprites/spr_test/layers/' + guid + '/70218f7b-de81-436b-81ad-98a4d0b5ff3d.png',
            'nested by frame guid');
    });

    test('a frame-count mismatch is refused, not padded or truncated', () => {
        throws(() => GM.plan({
            yyText: fakeYy(4), spriteName: 'spr_test',
            frames: [grid(16, 24)], w: 16, h: 24, originX: 8, originY: 24,
        }), 'declares 4 frames', 'says what disagrees');
    });

    test('a .yy with no frames, or with two layers, is refused', () => {
        throws(() => GM.readGuids('{}', 'spr_test'), 'no frames found');
        const two = fakeYy(1).replace('  "width":16,',
            '    {"$GMImageLayer":"","%Name":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",},\n  "width":16,');
        throws(() => GM.readGuids(two, 'spr_test'), 'found 2', 'counts the layers');
    });

    test('a wrong-sized frame is refused', () => {
        throws(() => GM.plan({
            yyText: fakeYy(1), spriteName: 'spr_test',
            frames: [grid(8, 8)], w: 16, h: 24, originX: 8, originY: 24,
        }), 'not 16x24');
    });

    // ── The details the Python script earned the hard way ─────────────────

    test('patching touches only the fields whose value actually differs', () => {
        // The fixture is 16x20 with yorigin 20; patching it to 16x24 origin
        // (8,24) should move exactly three lines. The other five patched keys
        // already hold their target values, and rewriting them identically
        // would be invisible here but would show up as churn in a real diff.
        const before = fakeYy(2);
        const after = GM.patchYy(before, { w: 16, h: 24, originX: 8, originY: 24 });
        const bl = before.split('\n'), al = after.split('\n');
        eq(al.length, bl.length, 'same line count');
        ok(after.includes('"resourceVersion":"2.0",},'), 'trailing commas intact');
        const changed = bl.map((l, i) => l === al[i] ? null : bl[i].trim()).filter(Boolean);
        eq(changed, ['"bbox_bottom":19,', '"height":20,', '"yorigin":20,'],
            'exactly the three stale fields');
        eq(changed.map((_, i) => al[bl.indexOf('  ' + changed[i])].trim()),
            ['"bbox_bottom":23,', '"height":24,', '"yorigin":24,'], 'and their new values');
    });

    test('the ^ anchor stops "width" matching "backdropWidth"', () => {
        const after = GM.patchYy(fakeYy(1), { w: 16, h: 24, originX: 8, originY: 24 });
        ok(after.includes('"backdropWidth":1366,'), 'backdropWidth untouched');
        ok(after.includes('"backdropHeight":768,'), 'backdropHeight untouched');
        ok(after.includes('"width":16,') && after.includes('"height":24,'), 'real fields set');
    });

    test('patching is idempotent — a second pass changes nothing', () => {
        const once = GM.patchYy(fakeYy(1), { w: 16, h: 24, originX: 8, originY: 24 });
        eq(GM.patchYy(once, { w: 16, h: 24, originX: 8, originY: 24 }), null, 'no second change');
    });

    test('bbox follows the frame size and bboxMode is left on auto', () => {
        const after = GM.patchYy(fakeYy(1), { w: 16, h: 24, originX: 8, originY: 24 });
        for (const f of ['"bboxMode":0,', '"bbox_left":0,', '"bbox_top":0,',
                         '"bbox_right":15,', '"bbox_bottom":23,'])
            ok(after.includes(f), f);
    });

    test('CRLF line endings survive a patch', () => {
        const crlf = fakeYy(1).replace(/\n/g, '\r\n');
        const after = GM.patchYy(crlf, { w: 16, h: 24, originX: 8, originY: 24 });
        eq((after.match(/\r\n/g) || []).length, (crlf.match(/\r\n/g) || []).length, 'CRLF count');
        ok(after.includes('"width":16,\r\n'), 'CRLF preserved at a patched line');
        ok(!/[^\r]\n/.test(after), 'no bare LF introduced');
    });

    test('an origin outside the frame warns rather than failing', () => {
        const p = GM.plan({
            yyText: fakeYy(1), spriteName: 'spr_test', frames: [grid(16, 24)],
            w: 16, h: 24, originX: 99, originY: 24,
        });
        ok(p.warnings.some(x => x.includes('outside')), 'warned');
        eq(p.writes.length, 2, 'still planned');
    });

    // ── Against the real project ──────────────────────────────────────────

    if (!haveTC) {
        test('SKIPPED: transatlantic_colleague not checked out beside this repo', () => {
            throw new Error('no ' + TC + ' — the real-project tests did not run');
        });
        return;
    }

    const REAL = {
        spr_player_idle_down: 2, spr_player_idle_up: 2,
        spr_player_idle_left: 2, spr_player_idle_right: 2,
        spr_player_walk_down: 4, spr_player_walk_up: 4,
        spr_player_walk_left: 4, spr_player_walk_right: 4,
    };

    test('reads all eight real .yy files and their frame counts', () => {
        for (const [spr, n] of Object.entries(REAL)) {
            const { frameGuids, layerGuid } = GM.readGuids(readFileSync(yyPath(spr), 'utf8'), spr);
            eq(frameGuids.length, n, spr + ' frames');
            ok(/^[0-9a-f-]{36}$/.test(layerGuid), spr + ' layer guid');
        }
    });

    test('plans the real DAG sprites at 16x24, origin (8,24)', () => {
        for (const [spr, n] of Object.entries(REAL)) {
            const p = GM.plan({
                yyText: readFileSync(yyPath(spr), 'utf8'), spriteName: spr,
                frames: Array.from({ length: n }, () => grid(16, 24)),
                w: 16, h: 24, originX: 8, originY: 24,
            });
            eq(p.writes.length, n * 2, spr + ': ' + n + ' frames x 2 files');
            eq(p.warnings, [], spr + ': no warnings');
        }
    });

    // import_sprite_sheet.py has already run against these, so a correct port
    // must agree with it and change nothing. This is the port's oracle.
    test('the real .yy files are ALREADY at 16x24 origin (8,24), so patching is a no-op', () => {
        for (const spr of Object.keys(REAL)) {
            eq(GM.patchYy(readFileSync(yyPath(spr), 'utf8'),
                { w: 16, h: 24, originX: 8, originY: 24 }), null, spr + ': already up to date');
        }
    });

    test('real frame GUIDs match the PNGs actually on disk, layers copy included', () => {
        for (const spr of Object.keys(REAL)) {
            const { frameGuids, layerGuid } = GM.readGuids(readFileSync(yyPath(spr), 'utf8'), spr);
            for (const guid of frameGuids) {
                ok(existsSync(join(TC, 'sprites', spr, guid + '.png')),
                    spr + '/' + guid + '.png exists');
                ok(existsSync(join(TC, 'sprites', spr, 'layers', guid, layerGuid + '.png')),
                    spr + '/layers/' + guid + '/' + layerGuid + '.png exists');
            }
        }
    });

    test('every planned path is where the real files already are', () => {
        for (const [spr, n] of Object.entries(REAL)) {
            const p = GM.plan({
                yyText: readFileSync(yyPath(spr), 'utf8'), spriteName: spr,
                frames: Array.from({ length: n }, () => grid(16, 24)),
                w: 16, h: 24, originX: 8, originY: 24,
            });
            for (const wr of p.writes)
                ok(existsSync(join(TC, wr.path)), 'planned ' + wr.path + ' already exists');
        }
    });
}
