import { test, eq, ok } from './assert.mjs';
import { coreSandbox, loadUI } from './harness.mjs';

// The one ui/ file these tests reach into, and only for the part of it that is
// logic rather than DOM: what Save does when the project will not fit.
//
// It earned the coverage. A PNG import used to be able to build a project with
// more colours than the .forge key can name, and every attempt to save it said
// "could not save" with the real sentence going to console.error where nobody
// was looking. Import no longer produces such a project, but the ceiling is
// still reachable — the palette is shared and the pixels are not bound to it —
// so Save has to ask, and asking is a decision worth pinning down.
//
// What is stubbed is the shell: no document to speak of, no canvas, no editor.
// project-ui.js reaches for a handful of named things and this supplies exactly
// those, which is also a check that it has not quietly grown more.
function mount(opts = {}) {
    const sandbox = coreSandbox();
    const toasts = [];
    const written = [];
    const logged = [];
    const adopted = [];
    const selected = [];
    const downloads = [];
    const names = [];
    let revision = 1;
    let list = opts.sprites || null;

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
        MAX_SWATCHES: 32,
        revision: () => revision,
        getSprite: (name) => sprite(name, opts.colors || 2),
        getPalette: () => opts.palette || ['#000000', '#ffffff'],
        getSlots: () => null,
        getTemplate: () => null,
        setSprite: (s, palette, slots, template) => {
            revision++;
            adopted.push({ sprite: s, palette, slots, template });
        },
    };

    if (list) sandbox.SpriteForge.spritesUI = {
        all: () => list,
        load: (next) => { list = next; },
        activeName: () => opts.activeName || (list[0] && list[0].name),
        select: (i) => selected.push(i),
    };

    sandbox.SpriteForge.fs = {
        openProject: async () => opts.openPath || 'C:/games/proj.forge',
        readText: async () => opts.fileText || '',
        saveProject: async () => opts.path || 'C:/games/proj.forge',
        writeText: async (path, text) => {
            if (opts.diskFails) throw new Error('os error 5: access is denied');
            written.push({ path, text });
        },
    };
    // Absent entirely unless the case supplies one, so the no-confirm-available
    // branch is a real state and not just an untested `if`.
    if (opts.confirm) sandbox.SpriteForge.fs.confirm = opts.confirm;

    // Opt-in, so every case above keeps the bare sandbox and doDownload's
    // feature detection stays a real branch rather than one nothing reaches.
    // Just enough of a browser to watch a download happen: what got put in the
    // blob, and what the anchor was told to call it.
    if (opts.browser) {
        sandbox.Blob = class { constructor(parts) { downloads.push(String(parts[0])); } };
        sandbox.URL = { createObjectURL: () => 'blob:stub', revokeObjectURL: () => {} };
        sandbox.setTimeout = () => 0;
        sandbox.document.createElement = () => ({
            set download(v) { names.push(v); },
            get download() { return names[names.length - 1]; },
            click: () => {},
            addEventListener: () => {},
        });
    }
    // The web build has no fs at all, and the theme recolour runs there too.
    if (opts.noFs) delete sandbox.SpriteForge.fs;

    // core/ loaded before the fs stub above, so tier.js decided LITE. In
    // the page bridge.js runs in <head> and it decides FULL; say so here
    // rather than let the load order of a test stand in for a product
    // decision and quietly retarget every Save/Open case below.
    sandbox.SpriteForge.tier.current = sandbox.SpriteForge.tier.create(!opts.noFs);
    if (opts.webConfirm) sandbox.confirm = opts.webConfirm;

    loadUI(sandbox, 'project-ui.js');
    return {
        P: sandbox.SpriteForge.project,
        ui: sandbox.SpriteForge.projectUI,
        toasts, written, logged, adopted, selected, downloads, names,
        sprites: () => list,
        touch: () => { revision++; },
    };
}

/** One sprite whose frame holds exactly `colors` distinct colours. */
function sprite(name, colors, band) {
    const w = 20, h = Math.ceil(colors / 20);
    const tag = (band || 0).toString(16).padStart(2, '0');
    const frame = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => {
        const i = y * w + x;
        if (i >= colors) return null;
        return '#' + tag + i.toString(16).padStart(4, '0');
    }));
    return { name, w, h, origin: { x: 0, y: 0 }, fps: 8, frames: [frame] };
}

/** n sprites of 32 colours each, none shared: the three-import project. */
const spread = (n) => Array.from({ length: n }, (_, i) => sprite(`s${i}`, 32, i + 1));

// The palette after those imports is the last one's 32 swatches, every one of
// them already in that sprite's pixels — so the project carries 32 x n, which
// is the number the user would be shown.
const paletteAfter = (sprites) => sprites[sprites.length - 1].frames[0][0].filter(Boolean);

const no = async () => false;

export default async function (SF) {
    // Each case runs its save first and the assertions after, because assert.mjs
    // is synchronous and these actions are not.

    // The palette is one colour the pixels already use, so 200 means 200.
    const tooMany = mount({ colors: 200, palette: ['#000000'] });
    tooMany.touch();
    await tooMany.ui.saveAs();

    const three = spread(3);
    const declined = mount({ sprites: spread(3), palette: paletteAfter(three), confirm: no });
    declined.touch();
    await declined.ui.saveAs();

    let asked = null;
    const accepted = mount({
        sprites: spread(3),
        palette: paletteAfter(three),
        activeName: 's2',
        confirm: async (q) => { asked = q; return true; },
    });
    accepted.touch();
    await accepted.ui.saveAs();

    const dupes = mount({ sprites: ['dag', 'dag', 'carl', 'carl'].map(n => sprite(n, 2)) });
    await dupes.ui.saveAs();

    const oneDupe = mount({ sprites: ['dag', 'dag'].map(n => sprite(n, 2)) });
    await oneDupe.ui.saveAs();

    const disk = mount({ diskFails: true });
    disk.touch();
    await disk.ui.saveAs();

    const good = mount();
    good.touch();
    await good.ui.saveAs();

    // A .forge carrying more swatches than the editor has slots for. The import
    // script writes these at --colors 64; the palette used to be cut to
    // whichever 32 the file listed first, silently.
    const wide = (() => {
        const P = SF.project;
        const sprite = P.newSprite('dag', 8, 1);
        // 40 swatches, of which the art uses only the last eight.
        const swatches = Array.from({ length: 40 }, (_, i) => '#' + i.toString(16).padStart(6, '0'));
        sprite.frames = [[swatches.slice(32)]];
        return { palette: swatches, slots: null, template: null, sprites: [sprite] };
    })();
    const opened = mount({ sprites: wide.sprites, fileText: SF.project.stringify(wide) });
    await opened.ui.open();

    test('opening a file with more swatches than slots keeps the ones in use', () => {
        eq(opened.adopted.length, 1, 'it opened');
        const shown = opened.adopted[0].palette;
        eq(shown.length, 32, 'trimmed to the slots the editor has');
        for (const hex of wide.sprites[0].frames[0][0])
            ok(shown.includes(hex), `${hex} is drawn, so it has a swatch`);
    });

    test('and says so, rather than leaving it to be noticed', () => {
        const msg = opened.toasts.join(' | ');
        ok(msg.includes('40'), `names how many the file holds: ${JSON.stringify(msg)}`);
        ok(msg.includes('32'), 'and how many are shown');
    });

    test('opening costs unused swatches, never a drawn colour', () => {
        // The trim is a display limit, not an edit. What it can drop is a
        // swatch nothing has drawn with — there are only so many slots. Every
        // pixel comes through untouched, which is the half that matters: the
        // key holds 89, so the art was never the thing under pressure.
        eq(opened.sprites()[0].frames, wide.sprites[0].frames, 'pixels identical');

        const shown = opened.adopted[0].palette;
        const dropped = wide.palette.filter(h => !shown.includes(h));
        eq(dropped.length, 8, 'eight swatches did not fit');
        const drawn = new Set(wide.sprites[0].frames.flat(2).filter(Boolean));
        for (const hex of dropped) ok(!drawn.has(hex), `${hex} was never drawn with`);
    });

    // ── over the ceiling, with nothing to ask through ───────

    test('with no way to ask, an over-limit save fails and says the numbers', () => {
        eq(tooMany.toasts.length, 1, 'one toast');
        const msg = tooMany.toasts[0];
        ok(msg.includes('200'), `names the colour count: ${JSON.stringify(msg)}`);
        ok(msg.includes(String(SF.project.ALPHABET.length)), `names the key size: ${JSON.stringify(msg)}`);
        ok(!/COULD NOT SAVE/.test(msg), 'and is not the old bare message');
    });

    test('and it does not reduce anything behind the user\'s back', () => {
        eq(tooMany.adopted, [], 'nothing was pushed into the editor');
        eq(tooMany.written, [], 'nothing reached the disk');
        ok(tooMany.ui.isDirty(), 'still dirty, so the marker keeps telling the truth');
    });

    // ── over the ceiling, and asked ─────────────────────────

    test('three 32-colour sprites are over the key, and Save asks', () => {
        eq(SF.project.colorsOf({ palette: paletteAfter(three), sprites: three }).length, 96, '96 colours');
        ok(asked.includes('96'), `the question names the count: ${JSON.stringify(asked)}`);
        ok(asked.includes('89'), 'and the limit');
        ok(asked.includes('7'), 'and how many colours would be merged');
    });

    test('declining leaves the project exactly as it was', () => {
        eq(declined.adopted, [], 'no reduction');
        eq(declined.written, [], 'no save');
        ok(declined.ui.isDirty(), 'still dirty');
        const msg = declined.toasts[declined.toasts.length - 1];
        ok(msg.includes('96') && msg.includes('89'), `says why: ${JSON.stringify(msg)}`);
    });

    test('accepting reduces, saves, and the file holds every sprite', () => {
        eq(accepted.written.length, 1, 'one write');
        const back = SF.project.parse(accepted.written[0].text);
        eq(back.sprites.length, 3, 'all three sprites');
        ok(SF.project.colorsOf(back).length <= SF.project.ALPHABET.length, 'inside the key');
        ok(!accepted.ui.isDirty(), 'and clean afterwards');
    });

    test('the reduction reaches the editor and the list, not just the file', () => {
        eq(accepted.adopted.length, 1, 'the editor was given the reduced project');
        const live = { palette: accepted.adopted[0].palette, sprites: accepted.sprites() };
        eq(SF.project.colorsOf(live).length, SF.project.ALPHABET.length, 'the list is reduced too');
        // Saving the file while the editor kept the old 96 would make the dirty
        // marker lie: it would read clean against a file it no longer matches.
        eq(SF.project.stringify(live), accepted.written[0].text, 'they are the same project');
    });

    test('a reduce does not move you to another sprite', () => {
        eq(accepted.selected, [2], 's2 was active, and s2 is active after');
    });

    test('the reduction is reported, not silent', () => {
        const msg = accepted.toasts.join(' | ');
        ok(msg.includes('REDUCED 96'), `says what it did: ${JSON.stringify(msg)}`);
        ok(msg.includes('SAVED'), 'and that it saved');
    });

    // ── everything else Save can fail on ────────────────────

    test('a validate failure surfaces the first problem, not the header', () => {
        eq(oneDupe.toasts.length, 1, 'one toast');
        const msg = oneDupe.toasts[0];
        ok(msg.includes('DAG'), `names the sprite: ${JSON.stringify(msg)}`);
        ok(!msg.includes('CANNOT SAVE THIS PROJECT'), 'the header alone would say nothing');
        ok(!msg.includes('\n'), 'one line, because a toast is one line');
    });

    test('the console still gets the whole error, toast or no toast', () => {
        eq(oneDupe.logged.length, 1, 'one console line');
        ok(oneDupe.logged[0].includes('names become filenames'), 'in full, and in its own case');
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

    test('a project inside the limit is never asked about', () => {
        eq(good.adopted, [], 'no reduction offered or applied');
    });

    // ── applying a theme ────────────────────────────────────
    //
    // A theme is the project's, not the sprite on screen's, so a theme that
    // recoloured only the active sprite would leave the others drawn in
    // colours no swatch points at any more. It asks first because undo lives
    // in the editor and reaches only that one sprite.

    const THEME = ['#000000', '#ff0000', '#00ff00', '#0000ff'];

    let themeAsked = null;
    const themed = mount({
        sprites: spread(3),
        activeName: 's1',
        confirm: async (q) => { themeAsked = q; return true; },
    });
    const themedOk = await themed.ui.retheme(THEME, 'Dracula');

    const themeNo = mount({ sprites: spread(3), confirm: no });
    const themeNoOk = await themeNo.ui.retheme(THEME, 'Dracula');

    const themeMute = mount({ sprites: spread(3) });          // nothing to ask through
    const themeMuteOk = await themeMute.ui.retheme(THEME, 'Dracula');

    const themeWeb = mount({ sprites: spread(3), noFs: true, webConfirm: () => true });
    const themeWebOk = await themeWeb.ui.retheme(THEME, 'Dracula');

    // Already drawn entirely in the theme: nothing to move, nothing to ask.
    const already = mount({
        sprites: [{
            name: 'dag', w: 2, h: 1, origin: { x: 0, y: 0 }, fps: 8,
            frames: [[['#000000', '#ff0000']]],
        }],
        palette: ['#000000', '#ff0000'],
        confirm: async () => { throw new Error('should not have asked'); },
    });
    const alreadyOk = await already.ui.retheme(THEME, 'Dracula');

    const empty = mount({
        sprites: spread(2),
        confirm: async () => { throw new Error('should not have asked'); },
    });
    const emptyOk = await empty.ui.retheme([], 'Nothing');

    test('applying a theme asks, naming the sprites and what will move', () => {
        ok(themeAsked.includes('all 3 sprites'), `names the scope: ${JSON.stringify(themeAsked)}`);
        ok(themeAsked.includes('Dracula'), 'and the theme');
        ok(/\d+ colours will move/.test(themeAsked), 'and how much moves');
        ok(themeAsked.includes('Undo only covers the sprite on screen'), 'and what undo will not do');
        ok(/[Cc]ancel to change the swatches/.test(themeAsked), 'and what declining does instead');
    });

    test('accepting redraws every sprite in the theme', () => {
        eq(themedOk, true, 'it reports that it recoloured');
        const live = { palette: themed.adopted[0].palette, sprites: themed.sprites() };
        eq(SF.project.colorsOf(live).length, THEME.length, 'the project holds only the theme');
        for (const s of themed.sprites())
            for (const px of s.frames.flat(2))
                ok(px === null || THEME.includes(px), `${s.name}: ${px} is a theme colour`);
    });

    test('the theme reaches the editor as the new palette', () => {
        eq(themed.adopted.length, 1, 'one adopt');
        eq(themed.adopted[0].palette, THEME, 'the editor is given the theme');
    });

    test('a theme does not move you to another sprite either', () => {
        eq(themed.selected, [1], 's1 was active, and s1 is active after');
    });

    test('declining leaves every pixel alone and says so by returning false', () => {
        eq(themeNoOk, false, 'so the caller swaps the swatches on its own');
        eq(themeNo.adopted, [], 'nothing was recoloured');
    });

    test('with nothing to ask through, a theme does not recolour', () => {
        eq(themeMuteOk, false, 'no silent rewrite of the art');
        eq(themeMute.adopted, [], 'nothing adopted');
    });

    test('the web build, which has no fs, can still be asked', () => {
        eq(themeWebOk, true, 'the browser confirm carries it');
        eq(themeWeb.adopted.length, 1, 'and it recoloured');
    });

    test('a project already in the theme is not asked about at all', () => {
        eq(alreadyOk, false, 'nothing to move');
        eq(already.adopted, [], 'and nothing done');
    });

    test('an empty theme is refused rather than wiping the art', () => {
        eq(emptyOk, false, 'nothing to apply');
        eq(empty.adopted, [], 'and nothing applied');
    });

    /* ── LITE gets its work out as a file ───────────────────────────────
       A browser has no path to write to, but a download and a file input need
       neither a disk nor a window, so `projects` staying full does NOT mean the
       web build has to lose everything on a refresh. These pin the two things
       that matter: the bytes are the same bytes, and the refusal is the same
       refusal. If LITE ever grew its own encode, one of these breaks. */

    const web = mount({ noFs: true, browser: true, sprites: [sprite('dag', 2)] });
    web.touch();
    await web.ui.save();

    const webTooMany = mount({ noFs: true, browser: true, colors: 200, palette: ['#000000'] });
    webTooMany.touch();
    await webTooMany.ui.save();

    const webUnnamed = mount({ noFs: true, browser: true });
    const fullBrowser = mount({ browser: true });
    fullBrowser.touch();
    await fullBrowser.ui.save();

    test('with no filesystem, Save downloads the project instead of doing nothing', () => {
        eq(web.downloads.length, 1, 'one download');
        eq(web.written, [], 'and nothing pretended to reach a disk');
        const back = SF.project.parse(web.downloads[0]);
        eq(back.sprites.length, 1, 'it round-trips through the parser');
        eq(back.sprites[0].name, 'dag', 'carrying the sprite');
    });

    test('the download is named after the work, not after the tool', () => {
        eq(web.names, ['dag.forge'], 'the sprite names the file');
        eq(webUnnamed.ui.suggestedName(), 'untitled.forge', 'an unnamed sprite falls back');
    });

    test('downloading refuses the same projects a disk save refuses', () => {
        eq(webTooMany.downloads, [], 'nothing was handed to the browser');
        ok(webTooMany.toasts.some(t => /200 colours/i.test(t)),
            `the count is said, not swallowed: ${JSON.stringify(webTooMany.toasts)}`);
    });

    test('a download is not unsaved work, so the close guard stops asking', () => {
        eq(web.ui.isDirty(), false, 'the bytes left, even though no path was kept');
        eq(web.ui.path(), null, 'and there is no path to remember');
    });

    test('with a filesystem, Save still writes a path and downloads nothing', () => {
        eq(fullBrowser.downloads, [], 'no download in the desktop build');
        eq(fullBrowser.written.length, 1, 'it went to disk');
    });
}
