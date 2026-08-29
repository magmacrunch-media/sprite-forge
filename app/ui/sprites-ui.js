// sprites-ui.js — the SPRITES panel: many sprites, one palette.
//
// The .forge format has always carried a list of sprites and a single shared
// key; project-ui.js just handed it a list of one. This is the list.
//
// Where the sprites live matters. The one being edited lives in the editor and
// nowhere else — the editor is the only thing that knows about the stroke half
// finished on the canvas. The others live here as plain data. Switching reads
// the editor back into the list and hands it the next one, which is why every
// path that touches the list calls sync() first.
//
// One palette for the whole project is the point rather than a limitation: a
// character's eight facings drawn from one set of swatches cannot drift onto
// eight slightly different browns. core/project.js already enforces it by
// sharing one key across every sprite in the file.
//
// Present in both builds. A sprite list needs no filesystem.

(function () {
    const P = window.SpriteForge.project;
    const editor = window.SpriteForge.editor;

    const listEl = document.getElementById('sprite-list');
    const nameInput = document.getElementById('sprite-name');
    const btnAdd = document.getElementById('sprite-add');
    const btnDup = document.getElementById('sprite-dup');
    const btnDel = document.getElementById('sprite-del');

    /** Every sprite in the project. sprites[active] is a stale copy while the
     *  editor holds the live one, so it is read through sync() and never
     *  straight out of the array.
     *
     *  Seeded from the editor rather than from a literal: this file loads
     *  after editor.js has finished starting up, so the blank sprite it is
     *  already showing is the honest first entry, at whatever size and frame
     *  count that turned out to be. */
    let sprites = [editor.getSprite('sprite')];
    let active = 0;

    const clone = (s) => JSON.parse(JSON.stringify(s));
    const names = () => sprites.map(s => s.name);
    const others = () => names().filter((_, i) => i !== active);

    /** Pull the editor's live state back into the list. */
    function sync() {
        if (sprites[active]) sprites[active] = editor.getSprite(sprites[active].name);
    }

    function render() {
        if (!listEl) return;
        listEl.textContent = '';
        sprites.forEach((s, i) => {
            const b = document.createElement('button');
            b.className = 'sprite-row' + (i === active ? ' active' : '');
            b.textContent = s.name;
            b.title = `${s.name} — ${s.w}×${s.h}, ${s.frames.length} frame${s.frames.length === 1 ? '' : 's'}`;
            b.addEventListener('click', () => select(i));
            listEl.append(b);
        });
        if (nameInput) nameInput.value = sprites[active] ? sprites[active].name : '';
        // One sprite is the floor: a project with none has nothing to save and
        // nothing to draw on.
        if (btnDel) btnDel.disabled = sprites.length < 2;
    }

    function select(i) {
        if (i === active || !sprites[i]) return;
        sync();
        active = i;
        editor.swapSprite(sprites[active]);
        render();
    }

    // ── the list as the rest of the app sees it ─────────────

    /** Every sprite, the live one included. */
    function all() {
        sync();
        return sprites.map(clone);
    }

    /**
     * Adopt a project's sprites. The caller has already put sprites[0] into
     * the editor along with the palette and template, so this takes the list
     * without swapping anything back in on top of it.
     */
    function load(projectSprites) {
        sprites = (projectSprites && projectSprites.length)
            ? projectSprites.map(clone)
            : [P.newSprite('sprite', 32, 32)];
        active = 0;
        render();
    }

    // ── recolouring the sprites you are not looking at ──────
    //
    // The palette is the project's, so a recolour is too: REPLACE and a slot
    // change rewrite one set of colours everywhere, not just on the sprite
    // that happens to be on screen. The editor rewrites its own live frames
    // and calls these for the rest.

    /**
     * Whether any stored sprite uses one of `map`'s colours.
     *
     * Asked before anything is written, because the editor has to know whether
     * there is a change to make before it takes an undo snapshot: a REPLACE
     * that hits nothing should not cost a Ctrl+Z. The live sprite is excluded
     * because the editor has already checked its own frames.
     */
    function usesAny(map) {
        return sprites.some((s, i) => i !== active
            && s.frames.some(f => f.some(row => row.some(px => px && map[px]))));
    }

    /**
     * Rewrite `map`'s colours across every stored sprite. Returns how many
     * changed, so the caller can say what it did.
     *
     * Skips the live one: the editor maps its own frames in the same pass, and
     * the copy held here is the stale one that sync() overwrites anyway.
     */
    function remapAll(map) {
        let n = 0;
        sprites = sprites.map((s, i) => {
            if (i === active) return s;
            let touched = false;
            const frames = s.frames.map(f => f.map(row => row.map(px => {
                const to = px && map[px];
                if (!to) return px;
                touched = true;
                return to;
            })));
            if (!touched) return s;
            n++;
            return { ...s, frames };
        });
        return n;
    }

    /**
     * The list as it stands, for an undo entry.
     *
     * Deliberately does not sync() first. This is taken the moment before the
     * editor changes itself, and pulling its live state in would capture the
     * change that is about to happen. sprites[active] staying stale is the
     * standing invariant here, not a bug to fix on the way past.
     */
    function capture() { return sprites.map(clone); }

    /**
     * Put a captured list back. Which sprite is active does not change: this
     * serves undo, not opening a file, and the sprite you were drawing on is
     * still the one you are drawing on.
     */
    function restoreAll(list) {
        sprites = list.map(clone);
        active = Math.min(active, sprites.length - 1);
        render();
    }

    // ── add, duplicate, delete, rename ──────────────────────

    function add() {
        sync();
        const from = sprites[active];
        const blank = P.newSprite(P.uniqueName('sprite', names()), from.w, from.h);
        sprites.push(blank);
        active = sprites.length - 1;
        editor.swapSprite(sprites[active]);
        render();
    }

    function duplicate() {
        sync();
        const copy = clone(sprites[active]);
        copy.name = P.uniqueName(copy.name, names());
        sprites.splice(active + 1, 0, copy);
        active += 1;
        editor.swapSprite(sprites[active]);
        render();
    }

    function remove() {
        if (sprites.length < 2) return;
        sprites.splice(active, 1);
        // Stay where you were in the list rather than jumping to the top; the
        // sprite that slid into this slot is the one you were next to.
        active = Math.min(active, sprites.length - 1);
        editor.swapSprite(sprites[active]);
        render();
    }

    function rename(to) {
        if (!sprites[active]) return;
        const name = P.uniqueName(to, others());
        sprites[active].name = name;
        // Only redraw the row, so the field does not fight the typing by
        // replacing what was typed with the de-duplicated version mid-word.
        const row = listEl && listEl.children[active];
        if (row) { row.textContent = name; row.title = name; }
    }

    if (btnAdd) btnAdd.addEventListener('click', add);
    if (btnDup) btnDup.addEventListener('click', duplicate);
    if (btnDel) btnDel.addEventListener('click', remove);
    if (nameInput) {
        nameInput.addEventListener('input', () => rename(nameInput.value));
        // The de-duplicated name only lands in the field once typing stops.
        nameInput.addEventListener('change', () => { render(); });
        nameInput.addEventListener('blur', () => { render(); });
    }

    render();

    window.SpriteForge.spritesUI = {
        all, load, render,
        usesAny, remapAll, capture, restoreAll,
        count: () => sprites.length,
        activeName: () => (sprites[active] ? sprites[active].name : null),
        // For tests: drive the same paths the buttons do.
        add, duplicate, remove, rename, select,
    };
}());
