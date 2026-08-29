import { test, eq, ok } from './assert.mjs';
import { coreSandbox, loadUI } from './harness.mjs';

// The one ui/ file these tests reach into, and only for the part of it that is
// logic rather than DOM: what Save tells the user when it cannot save.
//
// It earned the coverage. A PNG import used to be able to build a project with
// more colours than the .forge key can name, and every attempt to save it said
// "could not save" with the real sentence — which names the count and is the
// only clue to what to do about it — going to console.error where nobody was
// looking. Import no longer produces such a project (see sheet.test.mjs), but a
// shared palette across many sprites still can, so the message has to be right.
//
// What is stubbed is the shell: no document to speak of, no canvas, no editor.
// project-ui.js reaches for a handful of named things and this supplies exactly
// those, which is also a check that it has not quietly grown more.
function mount(opts = {}) {
    const sandbox = coreSandbox();
    const toasts = [];
    const written = [];
    const logged = [];
    let revision = opts.revision || 1;

    // Captured rather than left to print: it keeps the run's output clean, and
    // the console is where the whole message goes when the toast can only hold
    // a line of it, so it is worth asserting on.
    sandbox.console = { ...console, error: (...a) => logged.push(a.map(String).join(' ')) };

    sandbox.document.getElementById = () => null;
    sandbox.document.addEventListener = () => {};
    sandbox.document.title = '';
    // The dirty-marker poll would otherwise keep the test process alive.
    sandbox.setInterval = () => 0;
    sandbox.Toast = { show: (m) => toasts.push(m) };

    sandbox.SpriteForge.editor = {
        revision: () => revision,
        getSprite: (name) => sprite(name, opts.colors || 2),
        getPalette: () => opts.palette || ['#000000', '#ffffff'],
        getSlots: () => null,
        getTemplate: () => null,
    };
    if (opts.sprites)
        sandbox.SpriteForge.spritesUI = { all: () => opts.sprites, load: () => {} };

    sandbox.SpriteForge.fs = {
        saveProject: async () => opts.path || 'C:/games/proj.forge',
        writeText: async (path, text) => {
            if (opts.diskFails) throw new Error('os error 5: access is denied');
            written.push({ path, text });
        },
    };

    loadUI(sandbox, 'project-ui.js');
    return {
        ui: sandbox.SpriteForge.projectUI,
        toasts, written, logged,
        touch: () => { revision++; },
    };
}

/** One sprite whose frame holds exactly `colors` distinct colours. */
function sprite(name, colors) {
    const w = 20, h = Math.ceil(colors / 20);
    const frame = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => {
        const i = y * w + x;
        if (i >= colors) return null;
        return '#' + i.toString(16).padStart(2, '0') + '0000';
    }));
    return { name, w, h, origin: { x: 0, y: 0 }, fps: 8, frames: [frame] };
}

export default async function (SF) {
    // Each case runs its save first and the assertions after, because assert.mjs
    // is synchronous and these actions are not.
    // The palette is one colour the pixels already use, so 200 means 200.
    const tooMany = mount({ colors: 200, palette: ['#000000'] });
    tooMany.touch();
    await tooMany.ui.saveAs();

    const dupes = mount({
        sprites: ['dag', 'dag', 'carl', 'carl'].map(n => sprite(n, 2)),
    });
    await dupes.ui.saveAs();

    const oneDupe = mount({ sprites: ['dag', 'dag'].map(n => sprite(n, 2)) });
    await oneDupe.ui.saveAs();

    const disk = mount({ diskFails: true });
    disk.touch();
    await disk.ui.saveAs();

    const good = mount();
    good.touch();
    await good.ui.saveAs();

    test('a project with more colours than the key says so, and says how many', () => {
        eq(tooMany.toasts.length, 1, 'one toast');
        const msg = tooMany.toasts[0];
        ok(msg.includes('200'), `names the colour count: ${JSON.stringify(msg)}`);
        ok(msg.includes(String(SF.project.ALPHABET.length)), `names the key size: ${JSON.stringify(msg)}`);
        ok(!/COULD NOT SAVE/.test(msg), 'and is not the old bare message');
    });

    test('the console still gets the whole error, toast or no toast', () => {
        eq(tooMany.logged.length, 1, 'one console line');
        ok(tooMany.logged[0].includes('200 colours'), 'in its original case and wording');
    });

    test('a project that cannot be encoded is not reported as saved', () => {
        eq(tooMany.written, [], 'nothing reached the disk');
        ok(tooMany.ui.isDirty(), 'still dirty, so the marker keeps telling the truth');
    });

    test('a validate failure surfaces the first problem, not the header', () => {
        eq(oneDupe.toasts.length, 1, 'one toast');
        const msg = oneDupe.toasts[0];
        ok(msg.includes('DAG'), `names the sprite: ${JSON.stringify(msg)}`);
        ok(!msg.includes('CANNOT SAVE THIS PROJECT'), 'the header alone would say nothing');
        ok(!msg.includes('\n'), 'one line, because a toast is one line');
    });

    test('more problems than fit are counted rather than dropped', () => {
        const msg = dupes.toasts[0];
        ok(msg.includes('(+1 MORE)'), `counts the rest: ${JSON.stringify(msg)}`);
    });

    // A disk that will not take the bytes is not the user's to fix and the
    // message would be the OS's, so this half deliberately stays generic.
    test('a write failure keeps the generic message', () => {
        eq(disk.toasts, ['COULD NOT SAVE'], 'unchanged');
        ok(disk.ui.isDirty(), 'and still dirty');
    });

    test('a save that works still says saved, once', () => {
        eq(good.toasts, ['SAVED'], 'one toast');
        eq(good.written.length, 1, 'one write');
        ok(!good.ui.isDirty(), 'clean afterwards');
        // The bytes are a real .forge, not just something that did not throw.
        eq(SF.project.parse(good.written[0].text).sprites.length, 1, 'reads back');
    });
}
