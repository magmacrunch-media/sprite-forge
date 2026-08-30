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
       table is in BOTH tiers; the table lists exceptions, so adding a feature
       does not mean remembering to add a row. */
    const CAPABILITIES = {
        projects: 'full',   // New / Open / Save / Save As, and the .forge file
        targets: 'full',    // the TARGETS panel — export straight into a game repo
        menubar: 'full',    // the drawn-in-page menu bar
    };

    const ORDER = { lite: 0, full: 1 };

    /**
     * `backed` is "does this build have a filesystem behind it". It defaults
     * to the real answer and is injectable so a suite can ask both tiers the
     * same questions without a Tauri window.
     */
    function create(backed) {
        const name = backed ? 'full' : 'lite';
        return {
            name: name,
            isFull: name === 'full',
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
        current: create(!!SpriteForge.fs),
    };
}());
