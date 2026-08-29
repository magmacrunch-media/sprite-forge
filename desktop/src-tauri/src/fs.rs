//! The filesystem bridge: the commands the frontend may call, and nothing else.
//!
//! The behaviour is magma_kit::fs's — including `join_checked`, the
//! containment guard that makes `write_in_root` safe to hand a path built from
//! a sprite name. What lives here is the ALLOWLIST: one named command per
//! operation, so `generate_handler!` in lib.rs is an explicit list rather than
//! a plugin scope.
//!
//! Nothing here knows about .forge files, sprite sheets, or GameMaker's
//! on-disk layout — all of that lives in core/, in JavaScript, where the web
//! demo and the desktop build share one copy of it and the Node test suite can
//! reach it. Bytes in, bytes out, and the shell performs whatever plan core/
//! produced.

pub use magma_kit::fs::DirEntry;

#[tauri::command]
pub fn read_text(path: String) -> Result<String, String> {
    magma_kit::fs::read_text(&path)
}

#[tauri::command]
pub fn write_text(path: String, contents: String) -> Result<(), String> {
    magma_kit::fs::write_text(&path, &contents)
}

#[tauri::command]
pub fn read_bytes(path: String) -> Result<Vec<u8>, String> {
    magma_kit::fs::read_bytes(&path)
}

#[tauri::command]
pub fn write_bytes(path: String, contents: Vec<u8>) -> Result<(), String> {
    magma_kit::fs::write_bytes(&path, &contents)
}

/// Writes one file of a plan, resolved against a target root.
///
/// Separate from `write_bytes` because this is the call that takes a path built
/// from a sprite name, and sprite names come out of .yy and .forge files —
/// data, not necessarily the user's own typing. The kit refuses anything that
/// climbs out of the root.
#[tauri::command]
pub fn write_in_root(root: String, rel: String, contents: Vec<u8>) -> Result<String, String> {
    magma_kit::fs::write_in_root(&root, &rel, &contents)
}

#[tauri::command]
pub fn write_text_in_root(root: String, rel: String, contents: String) -> Result<String, String> {
    magma_kit::fs::write_text_in_root(&root, &rel, &contents)
}

#[tauri::command]
pub fn exists(path: String) -> bool {
    magma_kit::fs::exists(&path)
}

#[tauri::command]
pub fn read_dir(path: String) -> Result<Vec<DirEntry>, String> {
    magma_kit::fs::read_dir(&path)
}
