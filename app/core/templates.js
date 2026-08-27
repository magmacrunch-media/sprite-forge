// templates.js — SPRITE//FORGE character templates
//
// Pre-drawn characters to start from, in a form that stays reviewable in a
// diff: each frame is rows of single characters, and each character maps to
// [slotName, shadeStep] rather than to a literal colour.
//
// The indirection is what makes a template customisable. A slot carries one
// base colour and its shading is derived from it, so recolouring "shirt"
// recomputes that slot's whole ramp instead of asking the user to hand-match
// three hexes. Steps run -2 (deep shadow) to +2 (highlight); 0 is the base.
//
// Pure data and pure functions — this file loads before app.js and never
// touches the DOM. decode() takes the shading function as an argument rather
// than reaching for app.js's global, so neither file depends on the other's
// load order beyond the script tags.

window.CharacterTemplates = (function () {

    // ── RPG HERO ── top-down, front facing. The tile-RPG player: readable
    // silhouette at 1×, hard outline so it reads against any tile behind it.
    const RPG_HERO = {
        id: 'rpg-hero',
        label: 'RPG HERO',
        blurb: 'top-down · 16×16 · 1 frame',
        w: 16, h: 16,
        origin: [8, 15],
        slots: {
            line:  '#1a1526',
            skin:  '#f0c090',
            hair:  '#8b4a2b',
            tunic: '#3a6ea5',
            boots: '#5a3a22',
        },
        key: {
            '.': null,
            'K': ['line', 0],
            's': ['skin', 0],
            'd': ['skin', -1],
            'h': ['hair', 0],
            'H': ['hair', -1],
            't': ['tunic', 0],
            'T': ['tunic', -1],
            'u': ['tunic', 1],
            'b': ['boots', 0],
        },
        // Widths per row run 6·8·10·10·10·10·8·10·12·12·8·8·8·8·8: a rounded
        // crown, a jaw pinch, arms at the widest, then a waist pinch. Holding
        // one width down the whole body reads as a blob rather than a figure.
        frames: [[
            '................',
            '.....KKKKKK.....',
            '....KhhhhhhK....',
            '...KhhhhhhhhK...',
            '...KhssssssHK...',
            '...KhsKssKsHK...',
            '...KhssddssHK...',
            '....KddddddK....',
            '...KuuuuuuuuK...',
            '..KsKttttttKsK..',
            '..KsKttttttKsK..',
            '....KTTTTTTK....',
            '....KttKKttK....',
            '....KbbKKbbK....',
            '....KbbKKbbK....',
            '....KKKKKKKK....',
        ]],
    };

    // ── PLATFORMER KID ── side view, facing right. Ships idle plus two stride
    // frames so the animation preview does something the moment it loads.
    const KID_HEAD = [
        '................',
        '....KKKKK.......',
        '...KhhhhhhK.....',
        '..KhhhhhhhK.....',
        '..KhssssssK.....',
        '..KhssKssdK.....',
        '..KhsssssdK.....',
        '...KdddddK......',
        '...KuuuuuuK.....',
        '...KtttttsK.....',
        '...KtttttsK.....',
        '...KTTTTTTK.....',
        '...KTTKTTK......',
    ];

    const PLATFORMER_KID = {
        id: 'platformer-kid',
        label: 'PLATFORMER KID',
        blurb: 'side view · 16×16 · 3 frames',
        w: 16, h: 16,
        origin: [8, 15],
        slots: {
            line:  '#201a2e',
            skin:  '#ffd0a8',
            hair:  '#d4a017',
            shirt: '#e0483c',
            boots: '#3b3b52',
        },
        key: {
            '.': null,
            'K': ['line', 0],
            's': ['skin', 0],
            'd': ['skin', -1],
            'h': ['hair', 0],
            't': ['shirt', 0],
            'T': ['shirt', -1],
            'u': ['shirt', 1],
            'b': ['boots', 0],
        },
        // A three-beat cycle — stand, stride, pass — kept inside the body's own
        // width. A stride wider than the torso reads as a jumping jack.
        frames: [
            // stand
            KID_HEAD.concat([
                '...KbbKbbK......',
                '...KbbKbbK......',
                '...KKKKKKK......',
            ]),
            // stride, legs open
            KID_HEAD.concat([
                '...KbbKbbK......',
                '..KbbK.KbbK.....',
                '..KKKK.KKKK.....',
            ]),
            // pass, legs together
            KID_HEAD.concat([
                '...KbbbbbK......',
                '...KbbbbbK......',
                '...KKKKKKK......',
            ]),
        ],
    };

    // ── DAG (transatlantic_colleague) ── 16×24, origin (8,24) = feet.
    //
    // Replaces the code-drawn character in scripts/draw_dag/draw_dag.gml, whose
    // head was draw_circle(..., 4) — a perfect 8px ball on a 25px body, flat
    // filled, unoutlined, with draw_line_width limbs and circle hands. That is
    // the South Park construction, and it is why he read as one.
    //
    // What fixes it here:
    //   1. Shoulders (10) wider than the head (8), so the skull stops leading.
    //   2. A hard 1px outline round the whole silhouette.
    //   3. Row widths that change down the figure — 6·8·8·8·8·6 head, a 4px
    //      neck pinch at the scarf, 10 shoulders, 12 across the arms, 6 waist.
    //
    // The torso is held to 6px with the arms outboard of it. Filling the full
    // 16 reads as a refrigerator: at this size the empty columns either side of
    // the body are what make it a figure, and the gap between arm and coat is
    // what stops the arms disappearing into it.
    //
    // The scarf was tried at full width, narrowed, and cut. Cutting it lost the
    // only thing identifying the character, and the 2px neck that replaced it
    // read as a goatee rather than as a neck. Narrowed won.
    //
    // Colours are seeded from what draw_dag.gml already used, so this is a
    // redraw of the same character rather than a new one: coat (52,73,94),
    // scarf (149,165,166), hair (93,64,55), skin (244,213,181). The buttons are
    // the one deliberate change — draw_dag painted them the same grey as the
    // scarf, which reads as noise; brass gives one warm accent against the
    // olive drab of the room.

    const DAG_SLOTS = {
        line:   '#1c2733',
        skin:   '#f4d5b5',
        hair:   '#5d4037',
        coat:   '#34495e',
        scarf:  '#95a5a6',
        button: '#c9b458',
        trouser: '#293845',
        boots:   '#18222c',
    };

    const DAG_KEY = {
        '.': null,
        'K': ['line', 0],
        's': ['skin', 0],
        'd': ['skin', -1],
        'h': ['hair', 0],
        'c': ['coat', 0],
        'C': ['coat', -1],
        'f': ['scarf', 0],
        'F': ['scarf', -1],
        'n': ['button', 0],
        'b': ['trouser', 0],
        'B': ['boots', 0],
    };

    const BLANK = '................';

    // ── Upper bodies ── 17 rows each: 8 of head and scarf, 9 of torso. Drawn
    // once per facing and reused across every frame of that facing, so a change
    // to the face cannot drift between the idle and the walk.

    const DAG_UP_DOWN = [            // facing down (front)
        '.....KKKKKK.....',
        '....KhhhhhhK....',
        '....KhsssshK....',
        '....KsKssKsK....',
        '....KssssssK....',
        '.....KsddsK.....',
        '......KFFK......',
        '.....KFFFFK.....',
        '...KccccccccK...',
        '..KcKccccccKcK..',
        '..KcKcnccncKcK..',
        '..KcKccccccKcK..',
        '..KsKccccccKsK..',
        '...KKccccccKK...',
        '....KCCCCCCK....',
        '....KCCCCCCK....',
        '....KKKKKKKK....',
    ];

    const DAG_UP_UP = [              // facing up (back) — no face, no buttons
        '.....KKKKKK.....',
        '....KhhhhhhK....',
        '....KhhhhhhK....',
        '....KhhhhhhK....',
        '....KhhhhhhK....',
        '.....KhhhhK.....',
        '......KFFK......',
        '.....KFFFFK.....',
        '...KccccccccK...',
        '..KcKccccccKcK..',
        '..KcKccccccKcK..',
        '..KcKccccccKcK..',
        '..KsKccccccKsK..',
        '...KKccccccKK...',
        '....KCCCCCCK....',
        '....KCCCCCCK....',
        '....KKKKKKKK....',
    ];

    const DAG_UP_LEFT = [            // facing left — one eye, one arm, narrower
        '....KKKKKK......',
        '...KhhhhhhK.....',
        '...KsssshhK.....',
        '...KsKsshhK.....',
        '..KsssshhK......',
        '...KsdhhK.......',
        '.....KFFK.......',
        '....KFFFFK......',
        '...KccccccK.....',
        '..KcKccccKcK....',
        '..KcKccccKcK....',
        '..KcKccccKcK....',
        '..KsKccccKsK....',
        '...KKccccKK.....',
        '....KCCCCK......',
        '....KCCCCK......',
        '....KKKKKK......',
    ];

    // ── Leg blocks ── 6 rows when the body is at rest, 7 when it has bobbed up
    // a pixel and the legs have stretched to meet the floor. Feet always end on
    // row 23, because row 23 is the origin and the origin is the floor.

    const LEGS_STAND = [
        '....KbbKKbbK....',
        '....KbbKKbbK....',
        '....KbbKKbbK....',
        '....KbbKKbbK....',
        '...KBBBKKBBBK...',
        '...KKKKKKKKKK...',
    ];
    const LEGS_STAND_TALL = ['....KbbKKbbK....', ...LEGS_STAND];

    // Front and back contact poses: one foot planted, the other lifted a pixel.
    // A vertical offset, never a horizontal splay — spreading the feet sideways
    // on a front view reads as a jumping jack, not a stride.
    const LEGS_STEP_L = [
        '....KbbKKbbK....',
        '....KbbKKbbK....',
        '....KbbKKBBK....',
        '....KbbKKKKK....',
        '...KBBBK........',
        '...KKKKK........',
    ];
    const LEGS_STEP_R = [
        '....KbbKKbbK....',
        '....KbbKKbbK....',
        '....KBBKKbbK....',
        '....KKKKKbbK....',
        '........KBBBK...',
        '........KKKKK...',
    ];

    // Side view: here the stride *is* horizontal, but kept to 9px against a 6px
    // torso. Wider than about 1.5x the body and it stops reading as walking.
    const LEGS_SIDE = [
        '....KbbKbbK.....',
        '....KbbKbbK.....',
        '....KbbKbbK.....',
        '....KbbKbbK.....',
        '...KBBBKBBBK....',
        '...KKKKKKKKK....',
    ];
    const LEGS_SIDE_TALL = ['....KbbKbbK.....', ...LEGS_SIDE];
    const LEGS_SIDE_STEP_A = [
        '....KbbKbbK.....',
        '....KbbKbbK.....',
        '...KbbKKbbK.....',
        '..KbbK.KBBK.....',
        '..KBBK.KKKK.....',
        '..KKKK..........',
    ];
    const LEGS_SIDE_STEP_B = [
        '....KbbKbbK.....',
        '....KbbKbbK.....',
        '...KbbKKbbK.....',
        '..KBBK.KbbK.....',
        '..KKKK.KBBK.....',
        '.......KKKK.....',
    ];

    // rest() sits the figure on the floor; bob() lifts the body a pixel and
    // lengthens the legs to compensate. Frames 0 and 2 of a walk are the bobbed
    // passing poses, 1 and 3 the planted contact poses — the same ordering
    // draw_dag.gml used, which matters because obj_dag still drives image_index
    // from its own anim_frame accumulator.
    const rest = (upper, legs) => [BLANK, ...upper, ...legs];
    const bob  = (upper, legs) => [...upper, ...legs];

    const dagSprite = (id, label, blurb, frames) => ({
        id, label, blurb, w: 16, h: 24, origin: [8, 24],
        slots: { ...DAG_SLOTS }, key: { ...DAG_KEY }, frames,
    });

    const DAG_IDLE_DOWN = dagSprite('dag-idle-down', 'DAG IDLE DOWN', '16×24 · 2 frames', [
        rest(DAG_UP_DOWN, LEGS_STAND),
        bob(DAG_UP_DOWN, LEGS_STAND_TALL),
    ]);
    const DAG_IDLE_UP = dagSprite('dag-idle-up', 'DAG IDLE UP', '16×24 · 2 frames', [
        rest(DAG_UP_UP, LEGS_STAND),
        bob(DAG_UP_UP, LEGS_STAND_TALL),
    ]);
    const DAG_IDLE_LEFT = dagSprite('dag-idle-left', 'DAG IDLE LEFT', '16×24 · 2 frames', [
        rest(DAG_UP_LEFT, LEGS_SIDE),
        bob(DAG_UP_LEFT, LEGS_SIDE_TALL),
    ]);

    const DAG_WALK_DOWN = dagSprite('dag-walk-down', 'DAG WALK DOWN', '16×24 · 4 frames', [
        bob(DAG_UP_DOWN, LEGS_STAND_TALL),
        rest(DAG_UP_DOWN, LEGS_STEP_L),
        bob(DAG_UP_DOWN, LEGS_STAND_TALL),
        rest(DAG_UP_DOWN, LEGS_STEP_R),
    ]);
    const DAG_WALK_UP = dagSprite('dag-walk-up', 'DAG WALK UP', '16×24 · 4 frames', [
        bob(DAG_UP_UP, LEGS_STAND_TALL),
        rest(DAG_UP_UP, LEGS_STEP_L),
        bob(DAG_UP_UP, LEGS_STAND_TALL),
        rest(DAG_UP_UP, LEGS_STEP_R),
    ]);
    const DAG_WALK_LEFT = dagSprite('dag-walk-left', 'DAG WALK LEFT', '16×24 · 4 frames', [
        bob(DAG_UP_LEFT, LEGS_SIDE_TALL),
        rest(DAG_UP_LEFT, LEGS_SIDE_STEP_A),
        bob(DAG_UP_LEFT, LEGS_SIDE_TALL),
        rest(DAG_UP_LEFT, LEGS_SIDE_STEP_B),
    ]);

    const TEMPLATES = [RPG_HERO, PLATFORMER_KID,
        DAG_IDLE_DOWN, DAG_IDLE_UP, DAG_IDLE_LEFT,
        DAG_WALK_DOWN, DAG_WALK_UP, DAG_WALK_LEFT];

    /** Returns a list of problems; empty means the template is well formed. */
    function validate(tpl, shade) {
        const errs = [];
        if (!tpl.frames || !tpl.frames.length) errs.push('no frames');
        (tpl.frames || []).forEach((rows, i) => {
            if (rows.length !== tpl.h) errs.push(`frame ${i}: ${rows.length} rows, expected ${tpl.h}`);
            rows.forEach((row, y) => {
                if (row.length !== tpl.w) errs.push(`frame ${i} row ${y}: ${row.length} chars, expected ${tpl.w}`);
                for (const ch of row) {
                    if (!(ch in tpl.key)) errs.push(`frame ${i} row ${y}: unknown key '${ch}'`);
                    const cell = tpl.key[ch];
                    if (cell && !(cell[0] in tpl.slots)) errs.push(`key '${ch}' names missing slot '${cell[0]}'`);
                }
            });
        });
        // Two slots resolving to the same hex would make recolouring one of them
        // silently move the other, so this is a correctness check, not a nicety.
        if (shade) {
            const seen = {};
            for (const [ch, cell] of Object.entries(tpl.key)) {
                if (!cell) continue;
                const [slot, step] = cell;
                if (!(slot in tpl.slots)) continue;
                const hex = shade(tpl.slots[slot], step);
                if (seen[hex] && seen[hex] !== `${slot}:${step}`)
                    errs.push(`'${ch}' (${slot} ${step}) collides with ${seen[hex]} at ${hex}`);
                seen[hex] = `${slot}:${step}`;
            }
        }
        return errs;
    }

    /**
     * Resolves a template to editor state.
     * @param shade (baseHex, step) => hex — app.js's shadeHex.
     * @returns { frames, palette, origin, w, h, slots, steps }
     */
    function decode(tpl, shade) {
        const resolved = {};   // key char -> hex | null
        const steps = {};      // slot -> [shade steps it actually uses]
        for (const [ch, cell] of Object.entries(tpl.key)) {
            if (!cell) { resolved[ch] = null; continue; }
            const [slot, step] = cell;
            resolved[ch] = shade(tpl.slots[slot], step).toLowerCase();
            (steps[slot] = steps[slot] || []).push(step);
        }
        for (const slot of Object.keys(steps))
            steps[slot] = [...new Set(steps[slot])].sort((a, b) => a - b);

        const frames = tpl.frames.map(rows =>
            rows.map(row => [...row].map(ch => resolved[ch] ?? null)));

        // Palette grouped by slot, dark to light, so editing reads top to bottom.
        const palette = [];
        for (const slot of Object.keys(tpl.slots))
            for (const step of (steps[slot] || []))
                palette.push(shade(tpl.slots[slot], step).toLowerCase());

        return {
            frames, palette, w: tpl.w, h: tpl.h,
            origin: { x: tpl.origin[0], y: tpl.origin[1] },
            slots: { ...tpl.slots },
            steps,
        };
    }

    function list() { return TEMPLATES; }
    function get(id) { return TEMPLATES.find(t => t.id === id) || null; }

    return { list, get, decode, validate };
})();

// Namespace alias. This file predates core/ and keeps its own global so the
// templates stay a drop-in for anything already loading them by that name.
window.SpriteForge = window.SpriteForge || {};
window.SpriteForge.templates = window.CharacterTemplates;
