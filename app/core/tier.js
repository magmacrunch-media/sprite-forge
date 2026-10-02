// core/tier.js — LITE or FULL, decided once.
//
// magmacrunch.com runs the LITE build; the desktop bundle runs FULL. The
// mechanism is the one the kit already gives us — SpriteForge.fs is undefined
// when there is no Tauri backend, and its absence IS the feature switch. What
// this file adds is that the POLICY lives in one place: which features are
// full-only is a decision someone made, not an accident of which call site
// happened to check for a filesystem first.
//
// THE RULE FOR LITE: it is a strict upgrade on what is live. The page at
// ware/sprite-forge today is the pre-split monolith, and everything it could
// do — drawing, the tools, frames and onion skin, the animation preview,
// character templates, the palette and REPLACE, PNG sheet import and export —
// is in both tiers, alongside the sprite list and the themes it never had. A
// capability only earns a 'full' here when it is genuinely NEW work that needs
// a filesystem or a window, never as a way to make the desktop build look
// better by taking something away from the web one.
//
// Pure: it reads one boolean off the window and answers questions about it.
// The suites construct it against a fake window, which is why the probe is a
// parameter with a default rather than a direct reach for SpriteForge.fs.

(function () {
    'use strict';

    const SpriteForge = (window.SpriteForge = window.SpriteForge || {});

    /* Capability -> the lowest tier that has it. Anything absent from this
       table is in EVERY tier; the table lists exceptions, so adding a feature
       does not mean remembering to add a row. */
    const CAPABILITIES = {
        // A PATH-BACKED project: Save to the file you opened, Save As, the doc
        // name and the dirty marker. NOT the .forge file itself — getting your
        // work out as a file and picking one back up are a download and a file
        // input, which need no disk and no window, so they are untiered and
        // LITE has them. That distinction is the whole reason this table lists
        // exceptions rather than features.
        projects: 'disk',
        targets: 'full',    // the TARGETS panel — export straight into a game repo
        menubar: 'full',    // the drawn-in-page menu bar
    };

    /* THREE TIERS, AND THE MIDDLE ONE IS A BROWSER WITH HANDLES.
     *
     *   lite   no filesystem at all. A plain tab, and every browser without
     *          the File System Access API, iOS Safari included.
     *   disk   ui/fsa.js: real files through picked handles, so a project can
     *          be saved back to the file it came from. No directory it can
     *          hold across sessions and no per-machine config, which is what
     *          TARGETS needs, and no window, which is what the menu bar needs.
     *   full   Tauri. A path-keyed filesystem and a window.
     *
     * `projects` moved from full to disk when fsa.js arrived, and that is the
     * whole point of the middle row: the capability was never about Rust, it
     * was about being able to write back to the file you opened. The other two
     * rows did not move, because nothing about a handle gives you either.
     */
    const ORDER = { lite: 0, disk: 1, full: 2 };

    /**
     * `backed` says what is behind this build: a tier name, or a boolean for
     * the two cases that predate the middle tier (true is FULL, false is LITE).
     * Injectable so a suite can ask every tier the same questions without a
     * Tauri window or a browser that has the API.
     */
    function create(backed) {
        const name = typeof backed === 'string' ? backed : backed ? 'full' : 'lite';
        /* A tier nobody defined would silently answer `false` to every `has`,
           which reads on screen as a build that has lost its features rather
           than as a typo. */
        if (!(name in ORDER)) throw new Error(`unknown tier: ${backed}`);
        return {
            name: name,
            isFull: name === 'full',
            isDisk: name === 'disk',
            isLite: name === 'lite',
            /** Unknown capabilities are available: the table lists exceptions. */
            has: function (cap) {
                const need = CAPABILITIES[cap];
                if (!need) return true;
                return ORDER[name] >= ORDER[need];
            },
        };
    }

    SpriteForge.tier = {
        CAPABILITIES: CAPABILITIES,
        create: create,
        // The instance the rest of the app shares. ui/ asks this; nothing
        // downstream asks "are we in Tauri" a second time.
        //
        // The filesystem names its own tier, because it is the only thing that
        // knows what it can actually do. An fs that does not say is bridge.js's,
        // which predates the middle tier and backs everything; ui/fsa.js says
        // 'disk'. Reading it this way rather than sniffing for a method keeps
        // the answer a statement instead of a guess.
        current: create(SpriteForge.fs ? (SpriteForge.fs.tier || 'full') : 'lite'),
    };
}());
