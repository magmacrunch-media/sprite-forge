//! SPRITE//FORGE desktop shell.
//!
//! Thin on purpose. The window loads the same HTML, CSS and JavaScript the web
//! build uses; this crate adds the things a browser tab cannot give it — real
//! Open/Save dialogs, real file writes, and a log file on disk — and nothing
//! else.
//!
//! Everything the app knows about sprites, sheets, .forge files and each
//! engine's on-disk layout lives in core/, in JavaScript. See src/fs.rs for
//! why that boundary sits where it does.
//!
//! The behaviour behind most of what follows is magma_kit's; what this file
//! owns is the allowlist and the app's own strings.

mod fs;

use std::sync::Mutex;

use magma_kit::dirty::Dirty;
use tauri::Manager;

/// The log file's path, resolved once at startup so `log_path` can report it
/// without asking the OS again.
struct LogReady(Mutex<Option<String>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // Whether the editor has unsaved changes, as last reported by the
        // frontend. Kept on this side so that closing the window can ask the
        // same question File > Exit asks. If the frontend ever stops pushing,
        // the worst case is a stale `true` and one dialog too many — never a
        // window that cannot be closed.
        .manage(Dirty::new())
        .manage(LogReady(Mutex::new(None)))
        .setup(|app| {
            // The log is the only thing here that has to work before anything
            // else does: app/kit/boot.js reports load-order failures into it,
            // and those are exactly the failures where the window can tell you
            // nothing.
            let dir = app.path().app_config_dir()?;
            std::fs::create_dir_all(&dir)?;
            let path = magma_kit::log::init(&dir, "sprite-forge.log");
            *app.state::<LogReady>().0.lock().unwrap() = Some(path.display().to_string());
            magma_kit::log::rs("boot", "app starting");
            Ok(())
        })
        .on_window_event(|window, event| {
            let tauri::WindowEvent::CloseRequested { api, .. } = event else { return };
            magma_kit::dirty::confirm_close(
                window,
                api,
                &window.state::<Dirty>(),
                "This project has unsaved changes. Close anyway?",
                "SPRITE//FORGE",
            );
        })
        .invoke_handler(tauri::generate_handler![
            fs::read_text,
            fs::write_text,
            fs::read_bytes,
            fs::write_bytes,
            fs::write_in_root,
            fs::write_text_in_root,
            fs::exists,
            fs::read_dir,
            config_dir,
            app_version,
            log_line,
            log_path,
            quit,
            set_dirty,
        ])
        .run(tauri::generate_context!())
        .expect("error while running SPRITE//FORGE");
}

/// Told by the frontend whenever the unsaved-changes state flips.
///
/// Only the editor knows whether anything is unsaved, and only this side gets
/// told the window is closing, so the answer has to be pushed across ahead of
/// time rather than asked for at the moment it is needed.
#[tauri::command]
fn set_dirty(state: tauri::State<Dirty>, dirty: bool) {
    state.set(dirty);
}

/// File > Exit.
///
/// A named command rather than granting core:window:allow-close, for the same
/// reason src/fs.rs is a set of commands rather than the filesystem plugin:
/// one function the frontend can call is a smaller surface than a capability
/// that lets any script close the window. The unsaved-changes question is
/// asked in project-ui.js before this is ever reached — by the time the call
/// arrives the decision has been made.
#[tauri::command]
fn quit(app: tauri::AppHandle) {
    app.exit(0);
}

/// Where targets.json lives: the OS config directory, never the repo.
///
/// This is the whole mechanism behind "the app knows about my game repos, but
/// a stranger's download knows about theirs". The list of target projects is
/// per-machine configuration, so it belongs here and not in anything that gets
/// committed or shipped.
///
///   Windows  %APPDATA%\com.magmacrunch.sprite-forge\
///   macOS    ~/Library/Application Support/com.magmacrunch.sprite-forge/
#[tauri::command]
fn config_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("no config directory: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    Ok(dir.display().to_string())
}

/// Cargo.toml is the one source of truth for the version, and this is how the
/// desktop build reads it. The web build has no binary to ask, which is why
/// index.html still carries the string — tests/version.test.mjs holds the two
/// to each other.
#[tauri::command]
fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// The webview's side of the log file. app/kit/boot.js calls this on a script
/// error or an unhandled rejection, which is the case the log exists for: a
/// throw partway down the load order leaves the window sitting there showing
/// whatever it painted first, with nothing in a console anyone can see.
#[tauri::command]
fn log_line(kind: String, message: String, detail: Option<String>) {
    magma_kit::log::write("JS", &kind, &message, detail.as_deref());
}

#[tauri::command]
fn log_path(state: tauri::State<LogReady>) -> Option<String> {
    state.0.lock().unwrap().clone()
}
