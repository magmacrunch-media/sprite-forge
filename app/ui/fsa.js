// fsa.js — a filesystem for the browser, where the browser has one.
//
// bridge.js wires SpriteForge.fs to Rust when Tauri is behind the page. This
// file does the same job from the File System Access API, so an installed PWA
// can save to the file you opened instead of only downloading a copy. It is
// the same bet hologram's editor made and wrote down: given handles, a page
// can keep the one you picked, so the first save asks where and every save
// after it is silent, and that is most of what the desktop wrapper was wanted
// for.
//
// TWO CONDITIONS, BOTH NECESSARY. It installs only when Tauri has NOT already
// (bridge.js runs first and wins, because a real filesystem beats this one at
// everything), and only when the pickers exist. Firefox and Safari have no
// File System Access API and iOS Safari will not be getting one, so there the
// object stays undefined and the build is LITE exactly as it is today. That is
// the kit's rule and this file does not get to bend it: the absence of the
// object IS the feature switch, so a browser without the API must not end up
// holding a half-working one.
//
// IT IS NOT A FULL BUILD, AND SAYS SO. `tier: 'disk'` is read by core/tier.js,
// which places it between LITE and FULL. Projects become path-backed; TARGETS
// and the menu bar do not, because the first wants a directory handle it can
// hold across sessions plus a per-machine config file, and the second wants a
// window. Claiming 'full' here would light up two panels that would then fail
// on methods this object deliberately does not have.
//
// WHAT IS MISSING IS MISSING ON PURPOSE. No setDirty, quit, configDir, exists,
// readDir, pickFolder, writeInRoot or writeTextInRoot. Every caller of those
// is behind a capability this tier does not claim, and each one checks before
// it calls. setDirty is the load-bearing absence: project-ui.js installs its
// own beforeunload guard unless something native is tracking dirtiness, and it
// decides that by asking for this method. A stub that resolved would silence
// the only unsaved-work warning a PWA has.
//
// PATHS ARE NAMES HERE. The API deals in handles and never discloses a path,
// so what this hands back is the file's name and a registry maps it to the
// handle. The UI only ever splits a path on its separators to show the last
// part and passes the rest back to us, so a name satisfies it; what the user
// loses is the full path in the doc-name tooltip, which a browser genuinely
// does not know. Two files with one name collide and the newer wins, which is
// correct for the one case it can arise in: a document the user has just
// opened or saved is the current one, and the other is no longer on screen.

(function () {
    'use strict';

    const SpriteForge = (window.SpriteForge = window.SpriteForge || {});

    // Tauri first. bridge.js ran a moment ago and installs only when the IPC is
    // really there, so an fs at this point is the genuine article.
    if (SpriteForge.fs) return;

    const openPicker = window.showOpenFilePicker;
    const savePicker = window.showSaveFilePicker;
    if (typeof openPicker !== 'function' || typeof savePicker !== 'function') return;

    const FORGE = [{ description: 'SPRITE//FORGE project', accept: { 'application/json': ['.forge'] } }];
    const PNG = [{ description: 'PNG image', accept: { 'image/png': ['.png'] } }];

    /* name -> FileSystemFileHandle. See the header: this is what stands in for
       a path table. It is never persisted, so a reload starts empty and the
       first save of a session asks where again, which is the API's rule rather
       than a choice made here. */
    const handles = new Map();

    const baseName = (p) => String(p || '').split(/[\\/]/).pop();

    /** Ensure `name` carries `ext`, so the UI's own `endsWith` fix-up is a
     *  no-op and the string it stores is the one we registered. Without this
     *  the UI could append .forge to a name we filed under something else, and
     *  the next save would look up a handle that is not there. */
    const withExt = (name, ext) => (name.toLowerCase().endsWith(ext) ? name : name + ext);

    /** A picker the user dismissed throws AbortError. Every caller in the UI
     *  treats a falsy return as "cancelled", so that is what it becomes; any
     *  other failure is real and keeps travelling. */
    const cancelled = (e) => e && (e.name === 'AbortError' || e.name === 'NotAllowedError');

    /* Writing to a handle from showOpenFilePicker needs readwrite, which the
       open below asks for up front. This is the backstop for a handle that
       came back with less, and for a permission that lapsed. It can only
       succeed inside a user gesture, so a refusal is reported rather than
       retried: the UI's catch turns it into "could not save" and leaves the
       dirty marker alone, which is the truth. */
    async function grant(handle) {
        const opts = { mode: 'readwrite' };
        if (typeof handle.queryPermission === 'function'
            && (await handle.queryPermission(opts)) === 'granted') return;
        if (typeof handle.requestPermission === 'function'
            && (await handle.requestPermission(opts)) === 'granted') return;
        if (typeof handle.queryPermission !== 'function') return;  // older impl, let the write decide
        throw new Error('permission to write that file was refused');
    }

    function find(path) {
        const handle = handles.get(baseName(path));
        // Never silently do nothing: the UI reports a failed save and keeps the
        // document dirty, which is recoverable. A resolved promise with no
        // write behind it would claim a save that did not happen.
        if (!handle) throw new Error(`no open file called ${baseName(path)}`);
        return handle;
    }

    async function put(handle, data) {
        await grant(handle);
        const w = await handle.createWritable();
        await w.write(data);
        await w.close();
    }

    async function pickSave(suggested, types, ext) {
        let handle;
        try {
            handle = await savePicker({ suggestedName: withExt(baseName(suggested), ext), types });
        } catch (e) {
            if (cancelled(e)) return null;
            throw e;
        }
        const name = withExt(handle.name, ext);
        handles.set(name, handle);
        return name;
    }

    SpriteForge.fs = {
        /* Read by core/tier.js. See the header: this backs projects and not
           TARGETS, so it must not be mistaken for the Tauri build. */
        tier: 'disk',

        // ── files ────────────────────────────────────────────
        readText: (path) => find(path).getFile().then((f) => f.text()),
        writeText: (path, contents) => put(find(path), contents),
        writeBytes: (path, bytes) => put(find(path), new Blob([bytes])),

        // ── pickers ──────────────────────────────────────────
        openProject: async () => {
            let picked;
            try {
                /* mode: 'readwrite' is what makes Save silent afterwards. Without
                   it the handle comes back readable only and the first save has
                   to raise a second permission prompt, from inside an async
                   chain that may already have lost its user gesture. */
                picked = await openPicker({ multiple: false, types: FORGE, mode: 'readwrite' });
            } catch (e) {
                if (cancelled(e)) return null;
                throw e;
            }
            const handle = picked[0];
            if (!handle) return null;
            handles.set(handle.name, handle);
            return handle.name;
        },

        saveProject: (defaultPath) => pickSave(defaultPath || 'untitled.forge', FORGE, '.forge'),
        savePng: (name) => pickSave(name || 'sheet.png', PNG, '.png'),

        /* The browser's own, which is modal and truthful. project-ui.js checks
           for this method before calling it, so providing it is an upgrade on
           the LITE path rather than a requirement. */
        confirm: (message) => Promise.resolve(window.confirm(message)),
    };
}());
