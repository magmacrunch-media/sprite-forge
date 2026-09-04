// store.js — targets.json: which game projects this machine exports into.
//
// This file never lives in the repo. It sits in the OS config directory (see
// config_dir in desktop/src-tauri/src/lib.rs), because the list of game
// projects to export into is a fact about a machine, not about the app. It is
// the whole mechanism behind "this copy knows about its author's repos and a
// stranger's download knows about theirs, and neither ships the other's".
//
// A target is a directory plus the engine that reads what lands in it. Those
// two together are its identity: the same repo can legitimately be both a
// GameMaker target and an adenosine one, but exporting adenosine sheets into
// the same root twice is a mistake worth refusing rather than a configuration
// worth honouring.
//
// Pure, like the rest of core/: no DOM, no filesystem. The shell reads and
// writes the bytes; everything here is text in, object out.

window.SpriteForge = window.SpriteForge || {};
window.SpriteForge.targets = window.SpriteForge.targets || {};
window.SpriteForge.targets.store = (function () {

    const FORMAT = 'sprite-forge/targets/1';

    // The three sheet engines come from engines.js rather than being listed
    // again here — that file is already the one place that knows what an
    // engine is. The other two are not engines in that sense and each has its
    // own planner: GameMaker does per-frame surgery on a .yy, and Godot writes
    // C# source instead of an image at all.
    const KINDS = window.SpriteForge.targets.engines.kinds()
        .map(k => k.id)
        .concat('gamemaker', 'godot');

    /** No targets at all — what a machine has before it adds its first. */
    function blank() {
        return { format: FORMAT, targets: [] };
    }

    /** Trailing separators and backslashes removed, so two spellings of the
     *  same directory cannot both be added. */
    function normalizeRoot(root) {
        const slash = String.fromCharCode(92);
        let r = String(root == null ? '' : root).split(slash).join('/');
        while (r.length > 1 && r.endsWith('/')) r = r.slice(0, -1);
        return r;
    }

    /** A target's identity: what it is, and where it writes.
     *
     *  Lower-cased, because the paths this compares come from a Windows folder
     *  picker and C:/Games/Dag and C:/games/dag are one directory. The stored
     *  root keeps its original spelling — only the comparison is folded. */
    function id(kind, root) {
        return kind + ':' + normalizeRoot(root).toLowerCase();
    }

    function validate(o) {
        if (!o || typeof o !== 'object' || Array.isArray(o))
            throw new Error('targets.json: not an object');
        if (o.format !== FORMAT)
            throw new Error(`targets.json: unknown format ${JSON.stringify(o.format)}`);
        if (!Array.isArray(o.targets))
            throw new Error('targets.json: targets is not a list');

        const seen = new Set();
        o.targets.forEach((t, i) => {
            const at = `targets[${i}]`;
            if (!t || typeof t !== 'object' || Array.isArray(t))
                throw new Error(`${at}: not an object`);
            if (typeof t.root !== 'string' || !t.root.trim())
                throw new Error(`${at}: root is empty`);
            if (typeof t.label !== 'string' || !t.label.trim())
                throw new Error(`${at}: label is empty`);
            if (!KINDS.includes(t.kind))
                throw new Error(`${at}: unknown kind ${JSON.stringify(t.kind)}`);

            const key = id(t.kind, t.root);
            if (seen.has(key))
                throw new Error(`${at}: ${t.kind} already exports into ${normalizeRoot(t.root)}`);
            seen.add(key);
        });
        return o;
    }

    /** A copy with one more target. Throws rather than silently deduplicating,
     *  because a repeated Add is a user who picked the wrong folder. */
    function add(store, { label, kind, root }) {
        const next = {
            format: FORMAT,
            targets: [...store.targets, {
                label: String(label == null ? '' : label).trim(),
                kind,
                root: normalizeRoot(root),
            }],
        };
        return validate(next);
    }

    /** A copy without the target of that id. Removing what is not there is
     *  not an error: the list is the answer either way. */
    function remove(store, targetId) {
        return {
            format: FORMAT,
            targets: store.targets.filter(t => id(t.kind, t.root) !== targetId),
        };
    }

    function stringify(store) {
        return JSON.stringify(validate(store), null, 2) + '\n';
    }

    /** Text in, validated store out. A missing file is the caller's business —
     *  it should pass blank() rather than empty text. */
    function parse(text) {
        let o;
        try { o = JSON.parse(text); }
        catch (e) { throw new Error(`targets.json: not valid JSON (${e.message})`); }
        return validate(o);
    }

    return { FORMAT, KINDS, blank, parse, stringify, validate, add, remove, id, normalizeRoot };
}());
