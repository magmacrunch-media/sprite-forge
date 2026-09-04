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

    /** Re-read for the same reason fs is: a suite sets the tier after
     *  this file has loaded. The POLICY is core/tier.js's, not this
     *  file's — this only asks. */
    const can = (cap) => window.SpriteForge.tier.current.has(cap);

    const baseName = p => (p || '').split(/[\\/]/).pop() || 'untitled.forge';
    const isDirty = () => editor.revision() !== savedRevision;

    function refresh() {
        if (!can('projects')) return;
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
     * Ask the user a yes/no question, however this build can.
     *
     * The Tauri dialog when there is one, the browser's own otherwise: the
     * theme recolour runs in the web build too, where there is no fs at all,
     * and a question nobody can answer would turn that into a feature that
     * silently does nothing. False when neither exists, because every caller
     * here is asking permission to change the art.
     */
    async function ask(question) {
        const f = fs();
        if (f && f.confirm) return !!await f.confirm(question);
        if (typeof window.confirm === 'function') return !!window.confirm(question);
        return false;
    }

    /** Put a sprite list back on the sprite it was showing, after a wholesale
     *  replacement landed it on sprite 0. */
    function restoreActive(project, name) {
        if (!name || !spritesUI()) return;
        const back = project.sprites.findIndex(sp => sp.name === name);
        if (back > 0) spritesUI().select(back);
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
        // A file may carry more swatches than the editor has slots for, so the
        // palette is trimmed to the ones the art actually uses rather than to
        // whichever the file listed first. Only the swatches: every pixel keeps
        // its colour, and the key holds far more than the palette shows.
        const palette = P.paletteFor(project, editor.MAX_SWATCHES);
        editor.setSprite(project.sprites[0], palette, project.slots, project.template);
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
        const question = `This project uses ${colors} colours and the .forge key holds ${limit}. `
            + `Reduce it to ${limit} by merging the ${colors - limit} least-used into their `
            + `nearest neighbours, and save?`;
        if (!await ask(question)) return null;

        // Which sprite is being edited is not the save's business to change.
        const was = spritesUI() ? spritesUI().activeName() : null;
        const reduced = P.reduce(project, limit);
        adoptProject(reduced);
        restoreActive(reduced, was);
        toast(`reduced ${colors} colours to ${P.colorsOf(reduced).length}`);
        return reduced;
    }

    /**
     * Redraw the whole project in `palette`, if the user wants that.
     *
     * A theme applies to the palette, and the palette is the project's rather
     * than the sprite on screen's — one set of swatches across every sprite is
     * the stated point of the format's shared key. So a recolour that stopped
     * at the active sprite would leave the others drawn in colours no swatch
     * points at any more, which is both wrong on its face and the way projects
     * used to drift past what the key can hold.
     *
     * Which is also why it asks first. Undo lives in the editor and covers the
     * sprite it is showing, so Ctrl+Z after this brings back that sprite and
     * the old swatches while the rest stay recoloured. Rewriting art in sprites
     * that are not on screen, irreversibly, is not something a dropdown should
     * do to someone who has not been told.
     *
     * Declining is not a dead end: it means the swatches change and the art
     * does not, which is exactly what applying a theme did before. The question
     * says so, and the caller does that half.
     *
     * Returns whether it recoloured, so the caller knows whether the palette
     * still needs swapping.
     */
    async function retheme(palette, label) {
        if (!palette || !palette.length) return false;
        const project = currentProject();

        // Nothing drawn, or drawn entirely in colours the theme already has:
        // there is nothing to ask about and nothing to move.
        const moving = P.colorsOf(project).filter(c => !palette.includes(c));
        if (!moving.length) return false;

        const n = project.sprites.length;
        const question = `Redraw ${n === 1 ? 'this sprite' : `all ${n} sprites`} in `
            + `${label || 'this theme'}? ${moving.length} colour${moving.length === 1 ? '' : 's'} `
            + `will move to the nearest one it has. Undo only covers the sprite on screen. `
            + `Cancel to change the swatches and leave the art alone.`;
        if (!await ask(question)) return false;

        const was = spritesUI() ? spritesUI().activeName() : null;
        const next = P.retheme(project, palette);
        adoptProject(next);
        restoreActive(next, was);
        toast(`recoloured ${n} sprite${n === 1 ? '' : 's'}`);
        return true;
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

    /**
     * The current project as .forge text, or null with the reason already said.
     *
     * Separate from writing it anywhere, because both tiers have to do exactly
     * this and only differ in where the bytes land: FULL writes a path, LITE
     * hands the browser a download. Sharing the encode is what stops the two
     * from drifting into disagreeing about which projects are saveable.
     */
    async function encodeCurrent() {
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
                return null;
            }
            project = reduced;
        }

        // Encoding runs separately from writing, because the two failures are
        // not the same kind of news. A project that cannot be encoded — two
        // sprites sharing a name, say — fails for a reason the user can go and
        // fix, and naming it is the difference between a fixable project and a
        // mysterious one. A disk that will not take the bytes is not theirs to
        // fix, and the message would be the OS's rather than ours.
        try {
            return P.stringify(project);
        } catch (e) {
            toast(firstProblem(e.message));
            console.error('save failed:', e);
            return null;
        }
    }

    async function writeTo(path) {
        const text = await encodeCurrent();
        if (text == null) return;
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

    /**
     * Parse .forge text and put it on screen. Shared for the same reason
     * encodeCurrent() is: FULL reads a path and LITE reads a picked File, and
     * everything after the bytes arrive is identical.
     *
     * `where` only names the source in the console line — the toast never
     * carries a path, because in LITE there is not one.
     */
    function adoptFromText(text, where) {
        try {
            const project = P.parse(text);
            const sprite = project.sprites[0];
            adoptProject(project);
            savedRevision = editor.revision();
            refresh();
            toast(project.sprites.length > 1
                ? `opened ${project.sprites.length} sprites`
                : `opened ${sprite.name}`);
            // Said rather than left to be noticed: the swatches on screen are
            // not all of the ones the file carries, and a REPLACE aimed at a
            // colour that did not fit has nothing to aim with.
            if (project.palette.length > editor.MAX_SWATCHES)
                toast(`palette holds ${project.palette.length} colours; `
                    + `showing the ${editor.MAX_SWATCHES} most used`);
            return true;
        } catch (e) {
            // core/project.js names the sprite, frame and row it choked on, so
            // this is worth showing rather than swallowing.
            toast('could not open');
            console.error(`could not open ${where}:\n${e.message}`);
            return false;
        }
    }

    async function doOpen() {
        const f = fs();
        if (!f) return;
        if (!await confirmDiscard('Open another project')) return;
        const path = await f.openProject();
        if (!path) return;
        if (adoptFromText(await f.readText(path), path)) {
            currentPath = path;
            refresh();
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

    /* ── The LITE halves ────────────────────────────────────────────────
       A browser cannot write to a path, but "get my work out as a file" and
       "pick one back up" need neither a filesystem nor a window — they are a
       download and a file input, which this page already uses for PNG import.
       So they are NOT tier-gated, and core/tier.js gains no row: `projects`
       stays full because a PATH-BACKED project is what needs a disk. Without
       this, LITE lost everything on a refresh, which is the one place LITE was
       not a strict upgrade on the page it replaced. */

    /** A filename for a download: the open file's, else the sprite's, else untitled. */
    function suggestedName() {
        if (currentPath) return baseName(currentPath);
        const sprites = spritesUI() ? spritesUI().all() : [editor.getSprite('sprite')];
        const stem = sprites.length === 1 && sprites[0].name && sprites[0].name !== 'sprite'
            ? sprites[0].name
            : 'untitled';
        return `${stem}.forge`;
    }

    async function doDownload() {
        const text = await encodeCurrent();
        if (text == null) return;
        // Feature-detected rather than assumed: this path also runs under the
        // test sandbox, which has no URL and no anchor to click.
        if (typeof URL === 'undefined' || !URL.createObjectURL || !document.createElement) {
            toast('cannot download here');
            return;
        }
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = suggestedName();
        a.click();
        // Revoked on a timer, not immediately: Safari has not finished reading
        // the blob when click() returns and cancels the download if it is gone.
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        // The bytes left, so the work is no longer unsaved as far as the
        // beforeunload guard is concerned. Where they landed is the browser's
        // business and there is no path to remember.
        savedRevision = editor.revision();
        toast('downloaded ' + a.download);
    }

    function doPickFile() {
        if (!document.createElement) return;
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.forge,application/json';
        input.addEventListener('change', async () => {
            const file = input.files && input.files[0];
            if (!file) return;
            // Asked here rather than before the picker: a cancelled dialog
            // should not have cost the user a confirmation prompt.
            if (!await confirmDiscard('Open another project')) return;
            try {
                if (adoptFromText(await file.text(), file.name)) currentPath = null;
            } catch (e) {
                toast('could not read that file');
                console.error(`could not read ${file.name}:`, e);
            }
        });
        input.click();
    }

    /** Tier-appropriate: a path where there is a disk, a download where there is not. */
    const saveProject = () => (can('projects') ? doSave() : doDownload());
    const openProject = () => (can('projects') ? doOpen() : doPickFile());

    // The project shortcuts, resolved through the app's one bindings table
    // (core/keybindings.js). `available` is what keeps this listener from
    // swallowing a key another one owns: Ctrl+Z resolves to edit:undo, which is
    // not on this list, so it comes back null here and the editor gets it.
    const ACTIONS = {
        'project:save': saveProject,
        'project:save-as': doSaveAs,
        'project:open': openProject,
        'project:new': doNew,
    };
    const KB = window.SpriteForge.keybindings;
    const KEYS = MagmaKit.keys.create(KB.BINDINGS);
    const NAMES = Object.keys(ACTIONS);

    document.addEventListener('keydown', (e) => {
        const action = KEYS.resolve(e, NAMES);
        if (!action) return;
        // Save As is the only one that genuinely needs a disk — it asks for a
        // path. New, Open and Save all have a browser-shaped answer now, so
        // they are no longer gated. Ctrl+S in LITE downloads rather than
        // letting through the browser's own Save Page, which is why prevents()
        // still runs before the tier is consulted.
        if (KB.prevents(action)) e.preventDefault();
        if (action === 'project:save-as' && !can('projects')) return;
        ACTIONS[action]();
    });

    // Sidebar buttons, present in both tiers and dispatching by tier. FULL also
    // reaches these through the File menu; that duplication is the pattern
    // Templates, Import PNG and Export PNG already follow, because the sidebar
    // is the one place a person coming from another editor does not look.
    const wire = (id, fn) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', fn);
    };
    wire('forge-save', saveProject);
    wire('forge-open', openProject);

    // The dirty marker has to react to drawing, which does not notify anyone.
    // Polling the revision counter is unglamorous and costs nothing next to the
    // canvas work already happening on every stroke.
    setInterval(refresh, 400);
    refresh();

    /* The LITE build has no Rust close guard, so it needs the browser's.
       The desktop build has magma_kit::dirty::confirm_close, driven by the
       setDirty push in refresh() above, and must NOT also do this —
       beforeunload in a WebView produces a second, OS-drawn prompt.

       Gated on the filesystem and not on the tier: the question is
       whether a Rust guard exists, which is not a product decision. */
    if (!fs()) {
        window.addEventListener('beforeunload', function (e) {
            if (!isDirty()) return;
            e.preventDefault();
            e.returnValue = '';
        });
    }

    // The four actions, under the names the buttons, the File menu and the
    // tests all reach them by. They were _-prefixed while the tests were the
    // only caller; the menu makes them a real surface, so the underscore goes.
    window.SpriteForge.projectUI = {
        refresh, isDirty,
        path: () => currentPath,
        currentProject,
        // save/open are the tier-appropriate ones, so the File menu and the
        // sidebar reach the same behaviour the keyboard does.
        open: openProject, save: saveProject, saveAs: doSaveAs, newProject: doNew,
        // The bytes themselves, and the two LITE halves by name. encode() is
        // published because it is the whole of what "can this be saved" means,
        // and the suite asserts both tiers go through it.
        encode: encodeCurrent, suggestedName,
        download: doDownload, pickFile: doPickFile,
        // The theme dropdown lives in the editor, but applying one is a whole-
        // project operation, so it is answered here where the list and the
        // dialogs are.
        retheme,
        // Quit has to ask the same question Open and New ask.
        confirmDiscard,
    };
}());
