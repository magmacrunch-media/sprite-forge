// help-ui.js — the two modals behind the HELP menu: Reference and Credits.
//
// Its own file rather than more of editor.js, for the same reason sprites-ui
// and targets-ui are theirs: neither modal knows anything about a sprite, and
// the editor is long enough already.
//
// Present in both builds, and reachable in both. The menu bar is drawn only on
// the desktop, so the web build gets at Reference through F1 and at Credits
// through the footer line — which the desktop build hides, the two entry points
// being exactly complementary.
//
// The version is not written here. index.html carries it once, in the footer,
// and this reads it back out; AGENTS.md counts the five places a version lives
// and this file is deliberately not a sixth.

(function () {
    const reference = document.getElementById('reference-modal');
    const credits = document.getElementById('credits-modal');
    if (!reference || !credits) return;

    const versionEl = document.getElementById('app-version');
    const creditsVersion = document.getElementById('credits-version');

    // The three ways out — the ×, the button in the actions row, and a click
    // on the backdrop — are the kit's (kit/modal.js), which is where the other
    // three copies of them in this app now come from too.
    const modals = {
        reference: MagmaKit.modal.wire(reference, { closers: ['reference-close'] }),
        credits: MagmaKit.modal.wire(credits, { closers: ['credits-close'] }),
    };

    function open(dlg) {
        // Only one at a time: both are reachable from the same menu, and
        // showModal() on an already-open dialog throws.
        for (const other of [reference, credits])
            if (other !== dlg && other.open) other.close();
        if (dlg === credits && creditsVersion && versionEl)
            creditsVersion.textContent = versionEl.textContent;
        modals[dlg === credits ? 'credits' : 'reference'].open();
    }

    const link = document.getElementById('credits-link');
    if (link) link.addEventListener('click', () => open(credits));

    // F1 is what every other program answers with, and the menu prints it, so
    // it has to work — a menu naming a shortcut it ignores is worse than one
    // naming none. Listened for here rather than in editor.js because that
    // handler stands down whenever a dialog is open, and this one has to
    // toggle. The binding itself is in core/keybindings.js with the rest.
    const KEYS = MagmaKit.keys.create(window.SpriteForge.keybindings.BINDINGS);

    document.addEventListener('keydown', (e) => {
        if (KEYS.resolve(e, ['help:reference']) !== 'help:reference') return;
        e.preventDefault();
        if (reference.open) reference.close();
        else open(reference);
    });

    window.SpriteForge = window.SpriteForge || {};
    window.SpriteForge.helpUI = {
        reference: () => open(reference),
        credits: () => open(credits),
    };
}());
