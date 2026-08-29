// bridge.js — how the editor reaches a filesystem, if it has one.
//
// Loaded by both builds. Under Tauri it wires window.SpriteForge.fs to the Rust
// commands in desktop/src-tauri/src/fs.rs. In a browser it leaves fs undefined,
// and that absence is the whole feature switch: the editor hides the project
// and target panels when there is no fs, so the web page is the same files
// running without a disk rather than a second build to keep in step.
//
// Everything here is plumbing. No sprite, sheet or engine knowledge — that all
// lives in core/, shared by both builds and tested in Node.

(function () {
    window.SpriteForge = window.SpriteForge || {};

    // Tauri v2 exposes its IPC as __TAURI_INTERNALS__. Checking for that rather
    // than a user agent means the browser build cannot accidentally believe it
    // has a filesystem.
    const tauri = window.__TAURI_INTERNALS__;
    if (!tauri || typeof tauri.invoke !== 'function') return;

    // Past this point we know we are the desktop build, so say so on <html>.
    // CSS uses it to drop the parts of the vendored shell that only mean
    // something on the website: the back link into magmacrunch.com's utilities
    // index (a dead path inside the bundle) and the site footer. shell/ itself
    // stays byte-identical — the overrides live in ui/style.css.
    document.documentElement.classList.add('desktop');

    // WebView2 still offers its own right-click menu — Back, Reload, Save as,
    // Print. Every entry on it is either meaningless in a single-page tool or
    // actively destructive: Reload throws away unsaved frames with no prompt.
    // Fields keep theirs, because Cut/Copy/Paste in a text box is the one case
    // where the browser's menu is the right menu.
    document.addEventListener('contextmenu', (e) => {
        if (e.target.closest('input, textarea')) return;
        e.preventDefault();
    });

    const invoke = (cmd, args) => tauri.invoke(cmd, args || {});

    // The dialog plugin's commands are namespaced by plugin, unlike ours.
    const dialog = (cmd, args) =>
        tauri.invoke(`plugin:dialog|${cmd}`, args || {});

    const FORGE_FILTER = [{ name: 'SPRITE//FORGE project', extensions: ['forge'] }];
    const PNG_FILTER = [{ name: 'PNG image', extensions: ['png'] }];

    window.SpriteForge.fs = {
        // ── files ────────────────────────────────────────────
        readText: (path) => invoke('read_text', { path }),
        writeText: (path, contents) => invoke('write_text', { path, contents }),
        readBytes: (path) => invoke('read_bytes', { path }).then(a => new Uint8Array(a)),
        writeBytes: (path, bytes) => invoke('write_bytes', { path, contents: [...bytes] }),
        exists: (path) => invoke('exists', { path }),
        readDir: (path) => invoke('read_dir', { path }),

        // Writing one file of a plan, resolved against a target root. Separate
        // from writeBytes because this is the call that takes a path built from
        // a sprite name, and sprite names come out of .yy and .forge files —
        // data, not necessarily the user's own typing. The Rust side refuses
        // anything that climbs out of the root.
        writeInRoot: (root, rel, bytes) =>
            invoke('write_in_root', { root, rel, contents: [...bytes] }),
        writeTextInRoot: (root, rel, contents) =>
            invoke('write_text_in_root', { root, rel, contents }),

        // ── pickers ──────────────────────────────────────────
        openProject: () =>
            dialog('open', { options: { multiple: false, directory: false, filters: FORGE_FILTER } }),
        saveProject: (defaultPath) =>
            dialog('save', { options: { defaultPath, filters: FORGE_FILTER } }),
        openPng: () =>
            dialog('open', { options: { multiple: false, directory: false, filters: PNG_FILTER } }),
        savePng: (defaultPath) =>
            dialog('save', { options: { defaultPath, filters: PNG_FILTER } }),
        pickFolder: (title) =>
            dialog('open', { options: { multiple: false, directory: true, title } }),
        confirm: (message, title) =>
            dialog('ask', { message, title: title || 'SPRITE//FORGE' }),

        // ── config ───────────────────────────────────────────
        // targets.json lives here, never in the repo: the list of game projects
        // to export into is per-machine configuration. It is why this app can
        // know about its author's repos while a stranger's copy knows about
        // theirs and ships with an empty list.
        configDir: () => invoke('config_dir'),

        // ── about ────────────────────────────────────────────
        appVersion: () => invoke('app_version'),

        // ── the log file ─────────────────────────────────────
        // kit/boot.js writes here directly, before this file exists. These are
        // for everything after it. Fire-and-forget: a failure to log must never
        // become a failure to run.
        logLine: (kind, message, detail) =>
            invoke('log_line', { kind, message, detail: detail === undefined ? null : String(detail) })
                .catch(() => {}),
        logPath: () => invoke('log_path'),

        // ── lifecycle ────────────────────────────────────────
        quit: () => invoke('quit'),

        // Pushed rather than asked for: only the editor knows whether anything
        // is unsaved, and only the Rust side is told the window is closing.
        setDirty: (dirty) => invoke('set_dirty', { dirty }),
    };
}());
