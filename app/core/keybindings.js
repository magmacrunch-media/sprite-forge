// keybindings.js — every keyboard shortcut in the app, as data.
//
// The bindings were four independent keydown listeners, each with its own
// hand-rolled parse of ctrl/shift/key and its own idea of when to stand down.
// That is how two of them came to disagree about what counts as "typing", and
// how a fifth would have disagreed again. They are one table now; the kit
// (kit/keys.js) turns an event into one of these action NAMES, and each
// listener passes the list of names it actually handles, so a binding another
// listener owns resolves to null rather than being swallowed.
//
// Pure data. What an action DOES is the listener's business — which is also why
// the names match menu.js's data-action strings wherever the menu offers the
// same thing: one name for one action, whether it arrives by key or by menu.
//
// `prevent` marks the bindings whose browser default has to be stopped: the
// space bar scrolls, the arrows scroll, and Ctrl+Z in a page with no text
// selection still walks the browser's own undo.

(function () {
    'use strict';

    const SpriteForge = (window.SpriteForge = window.SpriteForge || {});

    const BINDINGS = [
        // ── edit ── the browser's own undo is the one to beat here
        { key: 'z', ctrl: true, action: 'edit:undo', prevent: true },
        { key: 'z', ctrl: true, shift: true, action: 'edit:redo', prevent: true },
        { key: 'y', ctrl: true, action: 'edit:redo', prevent: true },

        // ── project ── desktop only; project-ui.js is the only listener that
        // offers these, and only when there is a filesystem
        { key: 's', ctrl: true, action: 'project:save', prevent: true },
        { key: 's', ctrl: true, shift: true, action: 'project:save-as', prevent: true },
        { key: 'o', ctrl: true, action: 'project:open', prevent: true },
        // Bound because the File menu prints it. A menu that names a shortcut
        // it does not answer to is worse than a menu with no shortcuts on it.
        { key: 'n', ctrl: true, action: 'project:new', prevent: true },

        // ── tools ──
        { key: 'b', action: 'tool:pencil' },
        { key: 'e', action: 'tool:erase' },
        { key: 'g', action: 'tool:fill' },
        { key: 'l', action: 'tool:line' },
        { key: 'u', action: 'tool:rect' },
        { key: 'c', action: 'tool:ellipse' },
        { key: 'i', action: 'tool:pick' },
        { key: 'o', action: 'tool:origin' },

        // ── view ──
        { key: 'f', action: 'view:zoom-fit' },
        { key: 'd', action: 'view:grid' },
        { key: 'm', action: 'view:mirror' },
        { key: 'n', action: 'view:onion' },
        { key: 'p', action: 'view:dock' },
        { key: '-', action: 'view:zoom-out' },
        { key: '=', action: 'view:zoom-in' },

        // ── frames and animation ──
        { key: '[', action: 'frame:prev' },
        { key: ']', action: 'frame:next' },
        { key: ' ', action: 'anim:play', prevent: true },

        // ── transform ── the arrows scroll the page if left alone
        { key: 'h', action: 'transform:flip-h' },
        { key: 'v', action: 'transform:flip-v' },
        { key: 'r', action: 'transform:rot-90' },
        { key: 'ArrowLeft', action: 'shift:left', prevent: true },
        { key: 'ArrowRight', action: 'shift:right', prevent: true },
        { key: 'ArrowUp', action: 'shift:up', prevent: true },
        { key: 'ArrowDown', action: 'shift:down', prevent: true },

        // ── files and help ──
        { key: 't', action: 'file:templates' },
        // F1 is what every other program answers with, and the menu prints it.
        // It is also the one binding that has to work while a dialog is open,
        // because it TOGGLES the Reference modal — see help-ui.js.
        { key: 'F1', action: 'help:reference', prevent: true },
    ];

    /** The actions whose browser default must be stopped. */
    const PREVENT = new Set(BINDINGS.filter(b => b.prevent).map(b => b.action));

    SpriteForge.keybindings = {
        BINDINGS,
        prevents: (action) => PREVENT.has(action),
        /** The action names in this table, for a listener's `available` list. */
        actions: () => [...new Set(BINDINGS.map(b => b.action))],
    };
}());
