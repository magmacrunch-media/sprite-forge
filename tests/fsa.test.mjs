import { test, eq, ok } from './assert.mjs';
import { coreSandbox, loadUI } from './harness.mjs';

/* ui/fsa.js is the browser's filesystem, so the parts worth pinning down are
   the ones that decide whether it exists at all and the ones that stand
   between a save and a lie: an unknown path must not resolve, a cancelled
   picker must not throw, and the extension the UI appends must be the one we
   filed the handle under.
 *
 * The pickers are faked rather than mocked loosely, because the real ones have
 * two behaviours this file leans on: they throw AbortError on cancel, and a
 * handle from the OPEN picker is readable before it is writable. */

/** A stand-in for FileSystemFileHandle. `perm` starts 'granted' unless a test
 *  wants to exercise the request path. */
function fakeHandle(name, data = '', perm = 'granted') {
    let pending;
    const h = {
        name,
        data,
        requests: 0,
        queryPermission: async () => perm,
        requestPermission: async () => { h.requests++; perm = 'granted'; return perm; },
        getFile: async () => ({ text: async () => h.data }),
        createWritable: async () => ({
            write: async (d) => { pending = d; },
            close: async () => { h.data = pending; },
        }),
    };
    return h;
}

const ABORT = () => { const e = new Error('cancelled'); e.name = 'AbortError'; return e; };

/** A sandbox with core/ loaded and fsa.js evaluated into it. `opts.open` and
 *  `opts.save` are the picker implementations; omit one to model a browser
 *  that has no File System Access API at all. */
function mount(opts = {}) {
    const calls = { open: [], save: [] };
    const globals = { Blob: class { constructor(parts) { this.parts = parts; } }, confirm: () => true };

    if (opts.open) {
        globals.showOpenFilePicker = async (o) => { calls.open.push(o); return opts.open(o); };
    }
    if (opts.save) {
        globals.showSaveFilePicker = async (o) => { calls.save.push(o); return opts.save(o); };
    }

    const sandbox = coreSandbox(globals);
    if (opts.tauriFs) sandbox.SpriteForge.fs = opts.tauriFs;
    loadUI(sandbox, 'fsa.js');
    return { sandbox, calls, fs: sandbox.SpriteForge.fs };
}

const pickers = (handle) => ({ open: () => [handle], save: () => handle });

export default async function () {
    test('it installs when the pickers are there, and does not claim to be FULL', () => {
        const { fs } = mount(pickers(fakeHandle('hero.forge')));
        ok(fs, 'an fs is installed');
        eq(fs.tier, 'disk', 'it names the middle tier, so TARGETS stays hidden');
    });

    /* The kit's rule: the absence of the object IS the feature switch, so a
       browser without the API must not be handed a half-working one. */
    test('no pickers means no filesystem, and the build stays LITE', () => {
        eq(mount({}).fs, undefined, 'neither picker');
        eq(mount({ open: () => [] }).fs, undefined, 'open only is not enough');
        eq(mount({ save: () => null }).fs, undefined, 'save only is not enough');
    });

    /* bridge.js runs first and a real filesystem beats this one at everything,
       so the desktop build must come through untouched. */
    test('it stands aside when Tauri already installed one', () => {
        const tauri = { tauriMarker: true };
        const { fs } = mount({ ...pickers(fakeHandle('x.forge')), tauriFs: tauri });
        eq(fs, tauri, 'the Tauri bridge is left exactly as it was');
    });

    /* THE DELIBERATE OMISSIONS. Each of these is behind a capability 'disk'
       does not claim, and setDirty is the one that matters most: project-ui.js
       asks for it to decide whether something native is guarding unsaved work,
       so a stub here would silence the PWA's only close warning. */
    test('it omits what it cannot do, setDirty above all', () => {
        const { fs } = mount(pickers(fakeHandle('x.forge')));
        for (const m of ['setDirty', 'quit', 'configDir', 'exists', 'readDir',
            'pickFolder', 'writeInRoot', 'writeTextInRoot']) {
            eq(fs[m], undefined, `${m} is absent rather than stubbed`);
        }
    });

    await test.async('open hands back a name, and readText reads through it', async () => {
        const h = fakeHandle('hero.forge', 'FORGE DATA');
        const { fs } = mount(pickers(h));
        const path = await fs.openProject();
        eq(path, 'hero.forge', 'the name stands in for a path');
        eq(await fs.readText(path), 'FORGE DATA', 'read through the kept handle');
    });

    /* The whole point of the tier: the second save does not ask again. */
    await test.async('writeText saves back to the file that was opened', async () => {
        const h = fakeHandle('hero.forge', 'OLD');
        const { fs, calls } = mount(pickers(h));
        const path = await fs.openProject();
        await fs.writeText(path, 'NEW');
        eq(h.data, 'NEW', 'the opened file now holds the new text');
        eq(calls.save.length, 0, 'saving back asked for no picker at all');
    });

    /* Asked for up front so the first save does not need a second prompt from
       inside an async chain that may have lost its user gesture. */
    await test.async('the open picker asks for readwrite immediately', async () => {
        const { fs, calls } = mount(pickers(fakeHandle('hero.forge')));
        await fs.openProject();
        eq(calls.open[0].mode, 'readwrite', 'mode on the open picker');
        eq(calls.open[0].multiple, false, 'one file');
    });

    await test.async('a handle short of permission is asked, not assumed', async () => {
        const h = fakeHandle('hero.forge', 'OLD', 'prompt');
        const { fs } = mount(pickers(h));
        await fs.writeText(await fs.openProject(), 'NEW');
        eq(h.requests, 1, 'permission was requested once');
        eq(h.data, 'NEW', 'and the write went through');
    });

    /* The UI appends .forge when a returned path lacks it, so a name filed
       under something else would be looked up under something else and the
       next save would fail to find its handle. */
    await test.async('saveProject returns a name the UI will not have to fix up', async () => {
        const { fs } = mount(pickers(fakeHandle('hero')));
        const path = await fs.saveProject('untitled.forge');
        eq(path, 'hero.forge', 'the extension is settled here, not by the caller');
        await fs.writeText(path, 'X');            // throws if it was filed as 'hero'
    });

    await test.async('the suggested name is the basename, not a whole path', async () => {
        const { fs, calls } = mount(pickers(fakeHandle('hero.forge')));
        await fs.saveProject('C:\\sprites\\hero.forge');
        eq(calls.save[0].suggestedName, 'hero.forge', 'no directory in the suggestion');
    });

    /* Every caller treats a falsy return as "cancelled" and an exception as a
       real failure to report, so dismissing a dialog must not be an error. */
    await test.async('a dismissed picker returns null rather than throwing', async () => {
        const { fs } = mount({
            open: () => { throw ABORT(); },
            save: () => { throw ABORT(); },
        });
        eq(await fs.openProject(), null, 'open cancelled');
        eq(await fs.saveProject('a.forge'), null, 'save cancelled');
        eq(await fs.savePng('a.png'), null, 'png save cancelled');
    });

    /* A resolved promise with no write behind it would claim a save that did
       not happen, and the dirty marker would go clean on a lost document. */
    await test.async('writing to a path it never opened fails loudly', async () => {
        const { fs } = mount(pickers(fakeHandle('hero.forge')));
        let threw = null;
        try { await fs.writeText('ghost.forge', 'X'); } catch (e) { threw = e; }
        ok(threw, 'it threw rather than resolving');
        ok(/ghost\.forge/.test(threw.message), `names the file: ${threw && threw.message}`);
    });

    /* PNG export is untiered, so it works in LITE as a download. Once an fs
       exists editor.js routes through savePng instead, and that path has to
       work or a LITE capability has regressed. */
    await test.async('the PNG sheet route works, extension settled too', async () => {
        const h = fakeHandle('sheet');
        const { fs } = mount(pickers(h));
        const path = await fs.savePng('sprite_16x16.png');
        eq(path, 'sheet.png', 'named for what the picker returned, with .png on it');
        await fs.writeBytes(path, new Uint8Array([1, 2, 3]));
        ok(h.data && h.data.parts, 'the bytes went through a Blob to the handle');
    });

    await test.async('confirm answers, because project-ui asks before discarding', async () => {
        const { fs } = mount(pickers(fakeHandle('x.forge')));
        eq(await fs.confirm('discard?'), true, 'it resolves a boolean');
    });
}
