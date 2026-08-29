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

    // The open file's name and dirty marker, in the header strip. There is no
    // sidebar panel any more: New, Open, Save and Save As live in the File
    // menu, where every other program keeps them, and a panel that only
    // repeated them was a second place to maintain and a second place to look.
    const docName = document.getElementById('doc-name');

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
        if (!fs()) return;
        const name = currentPath ? baseName(currentPath) : 'untitled';
        const mark = isDirty() ? ' •' : '';
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
    const spritesUI = () => window.SpriteForge.spritesUI;

    function currentProject() {
        const sprites = spritesUI()
            ? spritesUI().all()
            : [editor.getSprite('sprite')];

        // A single sprite still carrying the default name takes the file's,
        // which is what this did before there was a list and is what makes
        // dag-walk-down.forge export dag-walk-down.png. Once there are two, or
        // once one has been named, the list is the authority and the filename
        // stops having an opinion.
        if (sprites.length === 1 && sprites[0].name === 'sprite' && currentPath)
            sprites[0].name = baseName(currentPath).replace(/\.forge$/i, '');

        return {
            palette: editor.getPalette(),
            slots: editor.getSlots(),
            template: editor.getTemplate(),
            sprites,
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

    /**
     * Put a whole project into the editor and the sprite list.
     *
     * The editor takes the first sprite plus everything the project shares; the
     * panel takes the whole list, sprite 0 included, and does not swap it back
     * in on top of what was just loaded. Open does this, and so does a reduce,
     * which is the only reason it is a function rather than four lines inside
     * doOpen.
     */
    function adoptProject(project) {
        editor.setSprite(project.sprites[0], project.palette, project.slots, project.template);
        if (spritesUI()) spritesUI().load(project.sprites);
    }

    /**
     * Offer to bring a project inside the key's colour limit, and do it if the
     * user agrees.
     *
     * The limit is reachable without doing anything wrong: the palette is
     * shared but the pixels are not bound to it, so importing a PNG into each
     * of three sprites is ninety-six colours against a key that holds
     * eighty-nine. Before this, that project simply could not be saved, and the
     * only advice available was the count.
     *
     * Asking is not a formality. Reducing rewrites pixels in every sprite,
     * including ones not on screen, so it is exactly the kind of thing that
     * must not happen because somebody pressed Save. Without a confirm to ask
     * through, the answer is no and the save fails with its reason — changing
     * the art unasked would be worse than not saving.
     */
    async function offerReduce(project, colors) {
        const limit = P.ALPHABET.length;
        const f = fs();
        const question = `This project uses ${colors} colours and the .forge key holds ${limit}. `
            + `Reduce it to ${limit} by merging the ${colors - limit} least-used into their `
            + `nearest neighbours, and save?`;
        if (!f || !f.confirm || !await f.confirm(question)) return null;

        // Which sprite is being edited is not the save's business to change.
        // adoptProject lands on sprite 0, which is right for Open and wrong
        // here — pressing Save should not move you.
        const was = spritesUI() ? spritesUI().activeName() : null;
        const reduced = P.reduce(project, limit);
        adoptProject(reduced);
        if (was) {
            const back = reduced.sprites.findIndex(sp => sp.name === was);
            if (back > 0) spritesUI().select(back);
        }
        toast(`reduced ${colors} colours to ${P.colorsOf(reduced).length}`);
        return reduced;
    }

    // core/project.js throws two shapes: one sentence from serialize(), and a
    // "cannot save this project:" header over one indented line per problem
    // from validate(). A toast is one line, so take the first problem and say
    // how many more the console is holding.
    function firstProblem(message) {
        const lines = String(message).split('\n').map(s => s.trim()).filter(Boolean);
        if (lines.length < 2) return lines[0] || 'could not save';
        return lines[1] + (lines.length > 2 ? ` (+${lines.length - 2} more)` : '');
    }

    async function writeTo(path) {
        let project = currentProject();

        // Asked before encoding rather than caught after it, because the answer
        // is a question for the user and not an error to report. serialize()
        // would throw on exactly this, and that throw stays as the backstop for
        // a project that gets here another way.
        const colors = P.colorsOf(project).length;
        if (colors > P.ALPHABET.length) {
            const reduced = await offerReduce(project, colors);
            if (!reduced) {
                toast(`${colors} colours; the .forge key holds ${P.ALPHABET.length}`);
                return;
            }
            project = reduced;
        }

        // Encoding runs separately from writing, because the two failures are
        // not the same kind of news. A project that cannot be encoded — two
        // sprites sharing a name, say — fails for a reason the user can go and
        // fix, and naming it is the difference between a fixable project and a
        // mysterious one. A disk that will not take the bytes is not theirs to
        // fix, and the message would be the OS's rather than ours.
        let text;
        try {
            text = P.stringify(project);
        } catch (e) {
            toast(firstProblem(e.message));
            console.error('save failed:', e);
            return;
        }
        try {
            await fs().writeText(path, text);
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
            adoptProject(project);
            currentPath = path;
            savedRevision = editor.revision();
            refresh();
            toast(project.sprites.length > 1
                ? `opened ${project.sprites.length} sprites`
                : `opened ${sprite.name}`);
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
        if (spritesUI()) spritesUI().load(blank.sprites);
        currentPath = null;
        savedRevision = editor.revision();
        refresh();
    }

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
