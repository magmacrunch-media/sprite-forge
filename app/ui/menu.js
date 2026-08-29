// menu.js — the desktop build's menu bar.
//
// Drawn in the page, not by Windows. A native menu bar is rendered by the OS
// in the OS font, and this app is Press Start 2P and Courier Prime on a
// scanline; a strip of Segoe UI across the top of it would look like a
// different program wearing the window. Drawing it here also keeps the
// frontend dependency-free — no @tauri-apps/api, no event bridge, no Rust
// menu-event plumbing — which is the same reason bridge.js talks to the IPC
// by hand.
//
// It owns no behaviour. Every item routes to something that already exists:
// the project actions on SpriteForge.projectUI, undo/redo on the editor's one
// state accessor, and the View toggles to the toolbar buttons they name, by
// clicking them. That last one matters — the menu never becomes a second
// implementation of a toggle that can drift from the button.

(function () {
    const bar = document.getElementById('menubar');
    if (!bar) return;

    const P = () => window.SpriteForge.projectUI;
    const E = () => window.SpriteForge.editor;
    const fs = () => window.SpriteForge.fs;

    /** The toolbar button a View item stands for. */
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
    };

    // ── open / closed ───────────────────────────────────────

    let open = null;

    function close() {
        if (!open) return;
        open.classList.remove('open');
        open = null;
    }

    function show(menu) {
        if (open === menu) return close();
        close();
        sync();
        menu.classList.add('open');
        open = menu;
    }

    /** Item state, read fresh every time a menu opens rather than kept in
     *  step: undo depth and the three toggles all change from under us. */
    function sync() {
        for (const item of bar.querySelectorAll('[data-action]')) {
            const action = item.dataset.action;

            if (action === 'edit:undo') item.disabled = !E().canUndo();
            else if (action === 'edit:redo') item.disabled = !E().canRedo();

            const target = proxied(item);
            if (target) item.classList.toggle('checked', target.classList.contains('active'));
        }
    }

    for (const menu of bar.querySelectorAll('.menu')) {
        menu.querySelector('.menu-title').addEventListener('click', (e) => {
            e.stopPropagation();
            show(menu);
        });
        // Once one menu is open, sliding across the bar switches between them
        // without another click — the one behaviour every real menu bar has
        // and no plain <details> gives you for free.
        menu.addEventListener('mouseenter', () => { if (open && open !== menu) show(menu); });
    }

    bar.addEventListener('click', (e) => {
        const item = e.target.closest('[data-action]');
        if (!item || item.disabled) return;
        close();
        actions[item.dataset.action](item);
    });

    document.addEventListener('click', close);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}());
