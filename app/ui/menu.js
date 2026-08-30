// menu.js — what this app's menu items mean.
//
// The bar's behaviour — open, close, hover-to-switch, Escape, the state
// refresh on every open — moved to MagmaKit.menu in magma-kit 0.2.0, extracted
// from THIS file once album//art became the second app with a menu bar. The
// reasoning that put it in the page rather than in the OS went with it.
//
// What is left is the only part that was ever about sprites: the actions map,
// and the two predicates that say when an item is dead.
//
// IT STILL OWNS NO BEHAVIOUR. Every item routes to something that already
// exists, and the View items proxy the toolbar buttons they name BY CLICKING
// THEM — so the menu never becomes a second implementation of a toggle that
// can drift from the button.

(function () {
    const P = () => window.SpriteForge.projectUI;
    const E = () => window.SpriteForge.editor;
    const H = () => window.SpriteForge.helpUI;
    const fs = () => window.SpriteForge.fs;

    /** The toolbar button an item stands for. */
    const proxied = (btn) => document.getElementById(btn.dataset.toggles || '');

    const actions = {
        'project:new': () => P().newProject(),
        'project:open': () => P().open(),
        'project:save': () => P().save(),
        'project:save-as': () => P().saveAs(),
        'app:quit': async () => {
            // The same question Open and New ask, asked once more on the way
            // out. Only then does the Rust side get told to exit.
            if (!await P().confirmDiscard('Quit')) return;
            fs().quit();
        },
        // Proxied to the sidebar buttons they name, the same way the View
        // items are: the modal and the exporter keep one caller each.
        'file:templates': () => document.getElementById('template-btn').click(),
        'file:import': () => document.getElementById('import-btn').click(),
        'file:export': () => document.getElementById('export-btn').click(),
        'edit:undo': () => E().undo(),
        'edit:redo': () => E().redo(),
        'view:zoom-in': () => document.getElementById('zoom-in').click(),
        'view:zoom-out': () => document.getElementById('zoom-out').click(),
        'view:zoom-fit': () => document.getElementById('zoom-fit').click(),
        'view:grid': (btn) => proxied(btn).click(),
        'view:mirror': (btn) => proxied(btn).click(),
        'view:onion': (btn) => proxied(btn).click(),
        'view:dock': (btn) => proxied(btn).click(),
        'help:reference': () => H().reference(),
        'help:credits': () => H().credits(),
    };

    /** Which items are dead right now. Asked fresh every time a menu opens,
     *  because the undo depth changes from under us. Anything this does not
     *  answer for falls back to the kit's data-toggles rule. */
    function state(action) {
        if (action === 'edit:undo') return { disabled: !E().canUndo() };
        if (action === 'edit:redo') return { disabled: !E().canRedo() };
        return null;
    }

    /* Mac labels first, before the bar reads any of them. A no-op on Windows,
       and outside the tier gate because the Reference card carries the same
       chords in both tiers — see ui/platform.js. */
    window.SpriteForge.platform.applyLabels();

    /* FULL only (core/tier.js). CSS already hides the bar in a browser, but
       hidden is not the same as absent: nothing below is wired, so 'app:quit'
       cannot dispatch and the fs().quit() above is genuinely unreachable
       rather than merely unclickable. */
    if (window.SpriteForge.tier.current.has('menubar'))
        window.MagmaKit.menu.create(document.getElementById('menubar'), { actions, state });
}());
