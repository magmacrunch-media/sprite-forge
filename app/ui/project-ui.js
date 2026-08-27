// project-ui.js — New / Open / Save / Save As, and the dirty marker.
//
// This is the panel that only exists in the desktop build. It looks for
// SpriteForge.fs and hides itself when there is none, which is how the web page
// stays the same files running without a disk rather than a second build.
//
// It owns no sprite knowledge: reading and writing the .forge bytes is
// core/project.js, and getting the editor's contents in and out is the one
// accessor at the bottom of editor.js.

(function () {
    const P = window.SpriteForge.project;
    const editor = window.SpriteForge.editor;

    const panel = document.querySelector('[data-section="project"]');
    const pathLabel = document.getElementById('project-path');
    // The same name in the header strip. On the desktop that strip is the
    // toolbar and this is where the file is named, so CSS hides the sidebar
    // copy above rather than showing both.
    const docName = document.getElementById('doc-name');
    const btnNew = document.getElementById('project-new');
    const btnOpen = document.getElementById('project-open');
    const btnSave = document.getElementById('project-save');
    const btnSaveAs = document.getElementById('project-save-as');

    let currentPath = null;
    let savedRevision = editor.revision();
    // What the Rust side was last told, so the poll below only crosses the IPC
    // when the answer actually changes rather than every 400ms.
    let pushedDirty = null;

    // Re-read rather than capture: the stub used by the tests installs fs after
    // this file has loaded, and a captured reference would miss it.
    const fs = () => window.SpriteForge.fs;

    const baseName = p => (p || '').split(/[\\/]/).pop() || 'untitled.forge';
    const isDirty = () => editor.revision() !== savedRevision;

    function refresh() {
        const has = !!fs();
        if (panel) panel.hidden = !has;
        if (!has) return;
        const name = currentPath ? baseName(currentPath) : 'untitled';
        const mark = isDirty() ? ' •' : '';
        if (pathLabel) {
            pathLabel.textContent = name + mark;
            pathLabel.title = currentPath || 'not saved yet';
        }
        if (docName) {
            docName.textContent = name + mark;
            docName.title = currentPath || 'not saved yet';
        }
        document.title = `${name}${mark} — SPRITE//FORGE`;

        // Closing the window has to ask what File > Exit asks, and the answer
        // has to be over there before the question is.
        const dirty = isDirty();
        if (dirty !== pushedDirty && fs().setDirty) {
            pushedDirty = dirty;
            fs().setDirty(dirty).catch(() => { pushedDirty = null; });
        }
    }

    function toast(msg) {
        if (window.Toast) window.Toast.show(String(msg).toUpperCase());
        else console.log(msg);
    }

    /** The editor's contents as a whole project. One sprite today; the sprite
     *  list will make this many, and the file format already allows it. */
    function currentProject() {
        const name = currentPath
            ? baseName(currentPath).replace(/\.forge$/i, '')
            : 'sprite';
        return {
            palette: editor.getPalette(),
            slots: editor.getSlots(),
            template: editor.getTemplate(),
            sprites: [editor.getSprite(name)],
        };
    }

    async function confirmDiscard(what) {
        if (!isDirty()) return true;
        const f = fs();
        if (f && f.confirm)
            return await f.confirm(`${baseName(currentPath)} has unsaved changes. ${what} anyway?`);
        return true;
    }

    async function doSaveAs() {
        const f = fs();
        if (!f) return;
        const suggested = currentPath || 'untitled.forge';
        const path = await f.saveProject(suggested);
        if (!path) return;                       // cancelled
        currentPath = path.endsWith('.forge') ? path : path + '.forge';
        await writeTo(currentPath);
    }

    async function doSave() {
        if (!currentPath) return doSaveAs();
        await writeTo(currentPath);
    }

    async function writeTo(path) {
        try {
            await fs().writeText(path, P.stringify(currentProject()));
            savedRevision = editor.revision();
            refresh();
            toast('saved');
        } catch (e) {
            // Never claim a save that did not happen — savedRevision stays put,
            // so the dirty marker keeps telling the truth.
            toast('could not save');
            console.error('save failed:', e);
        }
    }

    async function doOpen() {
        const f = fs();
        if (!f) return;
        if (!await confirmDiscard('Open another project')) return;
        const path = await f.openProject();
        if (!path) return;
        try {
            const project = P.parse(await f.readText(path));
            const sprite = project.sprites[0];
            editor.setSprite(sprite, project.palette, project.slots, project.template);
            currentPath = path;
            savedRevision = editor.revision();
            refresh();
            toast(`opened ${sprite.name}`);
        } catch (e) {
            // core/project.js names the sprite, frame and row it choked on, so
            // this is worth showing rather than swallowing.
            toast('could not open');
            console.error(`could not open ${path}:\n${e.message}`);
        }
    }

    async function doNew() {
        if (!await confirmDiscard('Start a new project')) return;
        const blank = P.blank(32, 32, editor.getPalette());
        editor.setSprite(blank.sprites[0], null, null, null);
        currentPath = null;
        savedRevision = editor.revision();
        refresh();
    }

    if (btnNew) btnNew.addEventListener('click', doNew);
    if (btnOpen) btnOpen.addEventListener('click', doOpen);
    if (btnSave) btnSave.addEventListener('click', doSave);
    if (btnSaveAs) btnSaveAs.addEventListener('click', doSaveAs);

    document.addEventListener('keydown', (e) => {
        if (!fs()) return;
        if (!(e.metaKey || e.ctrlKey)) return;
        if (e.key === 's') { e.preventDefault(); if (e.shiftKey) doSaveAs(); else doSave(); }
        else if (e.key === 'o') { e.preventDefault(); doOpen(); }
        // Bound because the File menu prints it. A menu that names a shortcut
        // it does not answer to is worse than a menu with no shortcuts on it.
        else if (e.key === 'n') { e.preventDefault(); doNew(); }
    });

    // The dirty marker has to react to drawing, which does not notify anyone.
    // Polling the revision counter is unglamorous and costs nothing next to the
    // canvas work already happening on every stroke.
    setInterval(refresh, 400);
    refresh();

    // The four actions, under the names the buttons, the File menu and the
    // tests all reach them by. They were _-prefixed while the tests were the
    // only caller; the menu makes them a real surface, so the underscore goes.
    window.SpriteForge.projectUI = {
        refresh, isDirty,
        path: () => currentPath,
        currentProject,
        open: doOpen, save: doSave, saveAs: doSaveAs, newProject: doNew,
        // Quit has to ask the same question Open and New ask.
        confirmDiscard,
    };
}());
