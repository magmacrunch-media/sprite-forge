import { test, eq, ok, throws } from './assert.mjs';

export default function (SF) {
    const E = SF.targets.engines;
    const grid = (w, h) => Array.from({ length: h }, () => Array(w).fill('#ff0000'));
    const dag = { name: 'spr_player_walk_down', frames: [grid(16, 24), grid(16, 24),
        grid(16, 24), grid(16, 24)], w: 16, h: 24, originX: 8, originY: 24 };

    test('all three engines are offered', () => {
        eq(E.kinds().map(k => k.id).sort(), ['adenosine', 'magnolia', 'texastoast'], 'kinds');
    });

    test('an unknown engine is refused', () => {
        throws(() => E.plan({ ...dag, kind: 'godot' }), 'unknown engine target');
    });

    test('each engine writes one sheet per sprite, to its own directory', () => {
        eq(E.plan({ ...dag, kind: 'magnolia' }).writes[0].path,
            'sprites/spr_player_walk_down.png', 'magnolia embeds from sprites/');
        eq(E.plan({ ...dag, kind: 'adenosine' }).writes[0].path,
            'assets/sprites/spr_player_walk_down.png', 'adenosine');
        eq(E.plan({ ...dag, kind: 'texastoast' }).writes[0].path,
            'assets/sprites/spr_player_walk_down.png', 'texastoast');
    });

    test('the directory can be overridden per target', () => {
        eq(E.plan({ ...dag, kind: 'magnolia', dir: 'wii/sprites' }).writes[0].path,
            'wii/sprites/spr_player_walk_down.png', 'override');
    });

    // The origin is not in the PNG, so the snippet is the only thing carrying
    // it out of the editor. Each of these must name the real numbers.
    test('the magnolia snippet carries the origin into sprite_load', () => {
        eq(E.plan({ ...dag, kind: 'magnolia' }).snippet,
            'sprite_load(&s, "spr_player_walk_down.png", 8, 24);', 'C call');
    });

    test('the adenosine snippet carries the frame size and origin', () => {
        eq(E.plan({ ...dag, kind: 'adenosine' }).snippet,
            "loadSpriteSheet('spr_player_walk_down.png', { frameWidth: 16, frameHeight: 24, " +
            'originX: 8, originY: 24 });', 'TS call');
    });

    test('texastoast takes no origin, so the snippet says where it went', () => {
        const s = E.plan({ ...dag, kind: 'texastoast' }).snippet;
        ok(s.startsWith("SpriteSheet('spr_player_walk_down.png', 16, 24)"), 'slice call');
        ok(s.includes('origin (8, 24)'), 'origin is not silently dropped');
    });

    test('a sheet defaults to one row, so frame index is column index', () => {
        eq(E.plan({ ...dag, kind: 'magnolia' }).writes[0].cols, 4, 'four columns');
        eq(E.plan({ ...dag, kind: 'magnolia', cols: 2 }).writes[0].cols, 2, 'override respected');
    });

    test('a wrong-sized frame is refused', () => {
        throws(() => E.plan({ ...dag, kind: 'magnolia', frames: [grid(8, 8)] }),
            'not 16x24');
    });

    test('no frames is refused', () => {
        throws(() => E.plan({ ...dag, kind: 'magnolia', frames: [] }), 'no frames');
    });

    test('an origin outside the frame warns but still plans', () => {
        const p = E.plan({ ...dag, kind: 'magnolia', originY: 99 });
        ok(p.warnings.some(x => x.includes('outside')), 'warned');
        eq(p.writes.length, 1, 'still planned');
    });

    test('a whole project plans one sheet per sprite with one snippet block', () => {
        const project = {
            palette: [], slots: null, template: null,
            sprites: ['down', 'up', 'left', 'right'].map(d => ({
                name: `spr_player_walk_${d}`, w: 16, h: 24,
                origin: { x: 8, y: 24 }, fps: 8,
                frames: [grid(16, 24), grid(16, 24)],
            })),
        };
        const p = E.planProject({ kind: 'magnolia', project });
        eq(p.writes.length, 4, 'four sheets');
        eq(p.writes.map(w => w.path), [
            'sprites/spr_player_walk_down.png', 'sprites/spr_player_walk_up.png',
            'sprites/spr_player_walk_left.png', 'sprites/spr_player_walk_right.png',
        ], 'one per sprite');
        eq(p.snippet.split('\n').length, 4, 'one call per sprite');
        eq(p.warnings, [], 'no warnings');
    });

    test('project planning surfaces a bad sprite by name', () => {
        const project = {
            sprites: [
                { name: 'good', w: 4, h: 4, origin: { x: 0, y: 0 }, fps: 8, frames: [grid(4, 4)] },
                { name: 'bad', w: 4, h: 4, origin: { x: 0, y: 0 }, fps: 8, frames: [grid(8, 8)] },
            ],
        };
        throws(() => E.planProject({ kind: 'magnolia', project }), 'bad: frame 0', 'names it');
    });
}
