//! SPRITE//FORGE desktop shell.
//!
//! Thin on purpose. The window loads the same HTML, CSS and JavaScript the web
//! build uses; this crate adds the two things a browser tab cannot give it —
//! real Open/Save dialogs and real file writes — and nothing else.
//!
//! Everything the app knows about sprites, sheets, .forge files and each
//! engine's on-disk layout lives in core/, in JavaScript. See src/fs.rs for
//! why that boundary sits where it does.

mod fs;

use std::sync::atomic::{AtomicBool, Ordering};

/// Whether the editor has unsaved changes, as last reported by the frontend.
///
/// Kept on this side so that closing the window can ask the same question
/// File > Exit asks. The frontend pushes it on every change; if it ever stops
/// pushing, the worst case is a stale `true` and one dialog too many — never a
/// window that cannot be closed.
struct Dirty(AtomicBool);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Dirty(AtomicBool::new(false)))
        .on_window_event(|window, event| {
            use tauri::Manager;
            let tauri::WindowEvent::CloseRequested { api, .. } = event else { return };

            // Clean work closes with no ceremony, which is also the safe
            // default if the frontend never told us anything.
            if !window.state::<Dirty>().0.load(Ordering::Relaxed) {
                return;
            }

            api.prevent_close();
            let w = window.clone();
            // show() takes a callback and returns immediately. A blocking ask
            // here would be asking the thread that has to draw the dialog to
            // wait for it.
            tauri_plugin_dialog::DialogExt::dialog(window)
                .message("This project has unsaved changes. Close anyway?")
                .title("SPRITE//FORGE")
                .buttons(tauri_plugin_dialog::MessageDialogButtons::OkCancel)
                .show(move |discard| {
                    if discard {
                        let _ = w.destroy();
                    }
                });
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
    state.0.store(dirty, Ordering::Relaxed);
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
    use tauri::Manager;
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("no config directory: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    Ok(dir.display().to_string())
}
