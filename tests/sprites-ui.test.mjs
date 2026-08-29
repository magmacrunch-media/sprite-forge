import { test, eq, ok } from './assert.mjs';
import { coreSandbox, loadUI } from './harness.mjs';

// The sprite list's half of a project-wide recolour.
//
// REPLACE and a slot change rewrite one set of colours across every sprite,
// because the palette they belong to is the project's rather than the sprite
// on screen's. The editor rewrites its own live frames; these four functions
// are the rest of the project, and the undo entry that makes it reversible.
//
// Stubbed down to nothing: no list element, no buttons, and an editor that is
// only somewhere for the live sprite to sit. render() bails without a list
// element, which is what lets this run at all.
const clone = (x) => JSON.parse(JSON.stringify(x));

function mount(list) {
    const sandbox = coreSandbox();
    let live = null;

    sandbox.document.getElementById = () => null;
    sandbox.document.createElement = () => ({
        classList: { toggle: () => {} }, append: () => {}, appendChild: () => {},
        addEventListener: () => {}, style: {},
    });
    sandbox.SpriteForge.editor = {
        // Faithful, so that sync() writing the live sprite back into the list
        // is the no-op it is in the app and not a change this test invented.
        getSprite: (name) => ({ ...clone(live), name }),
        swapSprite: (s) => { live = clone(s); },
    };

    loadUI(sandbox, 'sprites-ui.js');
    const su = sandbox.SpriteForge.spritesUI;
    su.load(list);
    live = clone(list[0]);
    return su;
}

/** A 1 x n sprite whose row is exactly `colors`. */
function sprite(name, colors) {
    return { name, w: colors.length, h: 1, origin: { x: 0, y: 0 }, fps: 8, frames: [[[...colors]]] };
}

const RED = '#ff0000', BLUE = '#0000ff', GREEN = '#00ff00';

export default function () {
    test('usesAny sees a colour in a sprite that is not on screen', () => {
        const su = mount([sprite('s0', [GREEN]), sprite('s1', [RED]), sprite('s2', [GREEN])]);
        ok(su.usesAny({ [RED]: BLUE }), 'red lives in s1, which is not the live one');
        ok(!su.usesAny({ '#123456': BLUE }), 'a colour nothing uses');
    });

    test('usesAny ignores the live sprite, which the editor checks itself', () => {
        const su = mount([sprite('s0', [RED]), sprite('s1', [GREEN])]);
        ok(!su.usesAny({ [RED]: BLUE }), 'red is only in s0, and s0 is live');
    });

    test('remapAll rewrites the stored sprites and counts them', () => {
        const su = mount([sprite('s0', [GREEN]), sprite('s1', [RED]), sprite('s2', [RED, GREEN])]);
        eq(su.remapAll({ [RED]: BLUE }), 2, 'two sprites had red');
        const all = su.all();
        eq(all[1].frames[0][0], [BLUE], 's1');
        eq(all[2].frames[0][0], [BLUE, GREEN], 's2, and green left alone');
    });

    test('remapAll leaves the live sprite to the editor', () => {
        const su = mount([sprite('s0', [RED]), sprite('s1', [RED])]);
        eq(su.remapAll({ [RED]: BLUE }), 1, 'only the stored one counted');
        // all() syncs the editor in over slot 0, and the editor's copy is the
        // one the editor recoloured for itself — untouched red here.
        eq(su.all()[1].frames[0][0], [BLUE], 's1 moved');
    });

    test('remapAll skips whichever sprite is live, not just the first', () => {
        const su = mount([sprite('s0', [GREEN]), sprite('s1', [RED]), sprite('s2', [RED])]);
        su.select(1);
        eq(su.remapAll({ [RED]: BLUE }), 1, 's2 only — s1 is live now');
        eq(su.all()[2].frames[0][0], [BLUE], 's2 moved');
    });

    test('remapAll reports nothing when nothing matches', () => {
        const su = mount([sprite('s0', [RED]), sprite('s1', [GREEN])]);
        eq(su.remapAll({ '#abcdef': BLUE }), 0, 'no sprite touched');
    });

    test('capture and restoreAll take a recolour back', () => {
        const su = mount([sprite('s0', [GREEN]), sprite('s1', [RED]), sprite('s2', [RED])]);
        const before = su.capture();
        su.remapAll({ [RED]: BLUE });
        eq(su.all()[1].frames[0][0], [BLUE], 'recoloured');
        su.restoreAll(before);
        eq(su.all()[1].frames[0][0], [RED], 'and back');
        eq(su.all()[2].frames[0][0], [RED], 'every sprite, not just the first');
    });

    test('capture is a copy, so later edits do not rewrite the undo entry', () => {
        const su = mount([sprite('s0', [GREEN]), sprite('s1', [RED])]);
        const before = su.capture();
        su.remapAll({ [RED]: BLUE });
        eq(before[1].frames[0][0], [RED], 'the captured list still holds red');
    });

    test('restoreAll does not move you to another sprite', () => {
        const su = mount([sprite('s0', [GREEN]), sprite('s1', [RED]), sprite('s2', [RED])]);
        su.select(2);
        const before = su.capture();
        su.remapAll({ [RED]: BLUE });
        su.restoreAll(before);
        eq(su.activeName(), 's2', 'still on s2 afterwards');
    });

    test('restoreAll onto a shorter list keeps active in range', () => {
        const su = mount([sprite('s0', [GREEN]), sprite('s1', [RED]), sprite('s2', [RED])]);
        su.select(2);
        su.restoreAll([sprite('s0', [GREEN])]);
        eq(su.count(), 1, 'one sprite');
        eq(su.activeName(), 's0', 'and active landed on it rather than off the end');
    });
}
