//! The filesystem bridge: a small, generic set of file operations.
//!
//! Deliberately dumb. It knows nothing about .forge files, sprite sheets, or
//! GameMaker's on-disk layout — all of that lives in core/, in JavaScript,
//! where the web demo and the desktop build share one copy of it. Putting .yy
//! parsing down here would fork that logic into a second language for no gain,
//! and would put it out of reach of the Node test suite.
//!
//! So: bytes in, bytes out, and the shell performs whatever plan core/ produced.

use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;

#[derive(Serialize)]
pub struct DirEntry {
    pub name: String,
    pub is_dir: bool,
}

/// Rejects paths that try to climb out of where they were pointed.
///
/// The plans core/ produces are relative paths joined onto a target root the
/// user picked. A sprite named `../../..` would otherwise write outside the
/// project it was aimed at — and sprite names come from imported .yy files and
/// .forge files, which are data, not necessarily the user's own typing.
fn join_checked(root: &str, rel: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    if rel_path.is_absolute() {
        return Err(format!("path must be relative to the target root: {rel}"));
    }
    for c in rel_path.components() {
        match c {
            Component::ParentDir => return Err(format!("path escapes the target root: {rel}")),
            Component::Prefix(_) | Component::RootDir => {
                return Err(format!("path must be relative to the target root: {rel}"))
            }
            _ => {}
        }
    }
    Ok(Path::new(root).join(rel_path))
}

#[tauri::command]
pub fn read_text(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
pub fn write_text(path: String, contents: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    }
    fs::write(&path, contents).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
pub fn read_bytes(path: String) -> Result<Vec<u8>, String> {
    fs::read(&path).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
pub fn write_bytes(path: String, contents: Vec<u8>) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    }
    fs::write(&path, contents).map_err(|e| format!("{path}: {e}"))
}

/// Writes one file of a plan, resolved against a target root.
///
/// Separate from `write_bytes` because this is the call that takes an untrusted
/// relative path, and it is the only one that does. Keeping it distinct means
/// the containment check cannot be forgotten at a call site.
#[tauri::command]
pub fn write_in_root(root: String, rel: String, contents: Vec<u8>) -> Result<String, String> {
    let target = join_checked(&root, &rel)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    }
    fs::write(&target, contents).map_err(|e| format!("{}: {e}", target.display()))?;
    Ok(target.display().to_string())
}

#[tauri::command]
pub fn write_text_in_root(root: String, rel: String, contents: String) -> Result<String, String> {
    write_in_root(root, rel, contents.into_bytes())
}

#[tauri::command]
pub fn exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
pub fn read_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let mut out = Vec::new();
    for entry in fs::read_dir(&path).map_err(|e| format!("{path}: {e}"))? {
        let entry = entry.map_err(|e| format!("{path}: {e}"))?;
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        out.push(DirEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            is_dir,
        });
    }
    out.sort_by(|a, b| (b.is_dir, &a.name).cmp(&(a.is_dir, &b.name)));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::join_checked;

    #[test]
    fn joins_a_plain_relative_path() {
        let p = join_checked("/games/tc", "sprites/spr_dag/a.png").unwrap();
        assert!(p.ends_with("sprites/spr_dag/a.png"));
    }

    #[test]
    fn refuses_to_climb_out() {
        assert!(join_checked("/games/tc", "../../etc/passwd").is_err());
        assert!(join_checked("/games/tc", "sprites/../../../x").is_err());
    }

    #[test]
    fn refuses_an_absolute_path() {
        assert!(join_checked("/games/tc", "/etc/passwd").is_err());
    }
}
