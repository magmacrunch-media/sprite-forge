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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running SPRITE//FORGE");
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
