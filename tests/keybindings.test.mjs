// The keyboard table, and the parity it has to keep with the four listeners it
// replaced. The resolver itself is the kit's and is tested there; what is
// tested here is that THIS table still says what the old if-else chains said,
// and that the three listeners cannot swallow each other's keys.

import { test, eq, ok } from './assert.mjs';
import { coreSandbox } from './harness.mjs';

const ev = (key, o = {}) => ({
    key,
    ctrlKey: !!o.ctrl, metaKey: !!o.meta, shiftKey: !!o.shift, altKey: !!o.alt,
    target: o.target || null,
});

// The `available` lists the three listeners pass, copied from them.
const EDITOR = ['edit:undo', 'edit:redo', 'tool:pencil', 'tool:erase', 'tool:fill',
    'tool:line', 'tool:rect', 'tool:ellipse', 'tool:pick', 'tool:origin',
    'view:zoom-fit', 'view:grid', 'view:mirror', 'view:onion', 'view:dock',
    'view:zoom-out', 'view:zoom-in', 'frame:prev', 'frame:next', 'anim:play',
    'transform:flip-h', 'transform:flip-v', 'transform:rot-90',
    'shift:left', 'shift:right', 'shift:up', 'shift:down', 'file:templates'];
const PROJECT = ['project:save', 'project:save-as', 'project:open', 'project:new'];
const HELP = ['help:reference'];

export default function () {
    // The table is core/, but the resolver is a kit module — so load both.
    const sandbox = coreSandbox();
    const KB = sandbox.SpriteForge.keybindings;
    const keys = sandbox.MagmaKit.keys.create(KB.BINDINGS);

    // ── the editor's keys, exactly as its old if-else chain read them ──

    test('every tool keeps its letter', () => {
        for (const [key, action] of Object.entries({
            b: 'tool:pencil', e: 'tool:erase', g: 'tool:fill', l: 'tool:line',
            u: 'tool:rect', c: 'tool:ellipse', i: 'tool:pick', o: 'tool:origin',
        })) eq(keys.resolve(ev(key), EDITOR), action, key);
    });

    test('the view keys keep theirs', () => {
        for (const [key, action] of Object.entries({
            f: 'view:zoom-fit', d: 'view:grid', m: 'view:mirror',
            n: 'view:onion', p: 'view:dock', '-': 'view:zoom-out', '=': 'view:zoom-in',
        })) eq(keys.resolve(ev(key), EDITOR), action, key);
    });

    test('frames, animation and the transforms keep theirs', () => {
        for (const [key, action] of Object.entries({
            '[': 'frame:prev', ']': 'frame:next', ' ': 'anim:play',
            h: 'transform:flip-h', v: 'transform:flip-v', r: 'transform:rot-90',
            ArrowLeft: 'shift:left', ArrowRight: 'shift:right',
            ArrowUp: 'shift:up', ArrowDown: 'shift:down',
            t: 'file:templates',
        })) eq(keys.resolve(ev(key), EDITOR), action, key);
    });

    test('undo and redo, including the Ctrl+Y the old chain also took', () => {
        eq(keys.resolve(ev('z', { ctrl: true }), EDITOR), 'edit:undo');
        eq(keys.resolve(ev('z', { ctrl: true, shift: true }), EDITOR), 'edit:redo');
        eq(keys.resolve(ev('y', { ctrl: true }), EDITOR), 'edit:redo');
        // Cmd on macOS is the same intent.
        eq(keys.resolve(ev('z', { meta: true }), EDITOR), 'edit:undo');
    });

    // ── the project keys ──

    test('the project shortcuts resolve, Save As included', () => {
        eq(keys.resolve(ev('s', { ctrl: true }), PROJECT), 'project:save');
        eq(keys.resolve(ev('s', { ctrl: true, shift: true }), PROJECT), 'project:save-as');
        eq(keys.resolve(ev('o', { ctrl: true }), PROJECT), 'project:open');
        eq(keys.resolve(ev('n', { ctrl: true }), PROJECT), 'project:new');
    });

    // ── the listeners must not swallow each other ──
    //
    // This is what `available` buys, and the reason four separate listeners
    // could safely become one table. Ctrl+O is the sharp case: unmodified `o`
    // is the origin tool and Ctrl+O is Open, and the table holds both.

    test('a key one listener owns comes back null to the others', () => {
        eq(keys.resolve(ev('s', { ctrl: true }), EDITOR), null, 'Ctrl+S is not the editor\'s');
        eq(keys.resolve(ev('z', { ctrl: true }), PROJECT), null, 'Ctrl+Z is not project-ui\'s');
        eq(keys.resolve(ev('b'), PROJECT), null, 'a tool letter is not project-ui\'s');
        eq(keys.resolve(ev('F1'), EDITOR), null, 'F1 belongs to help-ui alone');
    });

    test('Ctrl+O opens a project and bare o picks the origin tool', () => {
        eq(keys.resolve(ev('o', { ctrl: true }), PROJECT), 'project:open');
        eq(keys.resolve(ev('o'), EDITOR), 'tool:origin');
        eq(keys.resolve(ev('o', { ctrl: true }), EDITOR), null);
    });

    // ── the typing guard ──

    test('a bare letter while typing is a character, not a tool change', () => {
        const input = { tagName: 'INPUT', type: 'text' };
        eq(keys.resolve(ev('b', { target: input }), EDITOR), null);
        // The sprite-name and theme-name fields are why this matters: typing
        // "b" in one used to change the tool underneath.
        eq(keys.resolve(ev('r', { target: { tagName: 'TEXTAREA' } }), EDITOR), null);
        // A <select> counts as typing too — a letter there is type-ahead. The
        // old guard only checked input and textarea, so THEME and TARGETS were
        // holes in it.
        eq(keys.resolve(ev('n', { target: { tagName: 'SELECT' } }), EDITOR), null);
    });

    test('Ctrl bindings still fire while typing, and F1 always does', () => {
        const input = { tagName: 'INPUT', type: 'text' };
        eq(keys.resolve(ev('s', { ctrl: true, target: input }), PROJECT), 'project:save');
        eq(keys.resolve(ev('z', { ctrl: true, target: input }), EDITOR), 'edit:undo');
        eq(keys.resolve(ev('F1', { target: input }), HELP), 'help:reference');
    });

    // ── preventDefault ──

    test('the bindings that must beat a browser default say so', () => {
        for (const a of ['edit:undo', 'edit:redo', 'anim:play', 'shift:left',
            'shift:right', 'shift:up', 'shift:down', 'project:save',
            'project:save-as', 'project:open', 'project:new', 'help:reference'])
            ok(KB.prevents(a), `${a} prevents the default`);
    });

    test('the bindings that have no default to beat do not claim one', () => {
        for (const a of ['tool:pencil', 'view:grid', 'frame:next', 'transform:rot-90'])
            ok(!KB.prevents(a), `${a} leaves the default alone`);
    });

    // ── the menu prints shortcuts; they have to be real ──
    //
    // "A menu that names a shortcut it does not answer to is worse than a menu
    // with no shortcuts on it" — the rule project-ui.js was written to. The
    // menu bar prints eleven; each one has to resolve to the action its own
    // data-action names.

    test('every shortcut the menu bar prints is in the table', () => {
        const printed = {
            'project:new': ev('n', { ctrl: true }),
            'project:open': ev('o', { ctrl: true }),
            'project:save': ev('s', { ctrl: true }),
            'project:save-as': ev('s', { ctrl: true, shift: true }),
            'file:templates': ev('t'),
            'edit:undo': ev('z', { ctrl: true }),
            'edit:redo': ev('z', { ctrl: true, shift: true }),
            'view:zoom-in': ev('='),
            'view:zoom-out': ev('-'),
            'view:zoom-fit': ev('f'),
            'view:grid': ev('d'),
            'view:mirror': ev('m'),
            'view:onion': ev('n'),
            'view:dock': ev('p'),
            'help:reference': ev('F1'),
        };
        for (const [action, e] of Object.entries(printed))
            eq(keys.resolve(e, [action]), action, `the menu prints this for ${action}`);
    });

    test('no two bindings share a key combination', () => {
        const seen = new Map();
        for (const b of KB.BINDINGS) {
            const id = `${b.key.toLowerCase()}|${!!b.ctrl}|${!!b.shift}`;
            ok(!seen.has(id), `${id} is bound to both ${seen.get(id)} and ${b.action}`);
            seen.set(id, b.action);
        }
    });
}
