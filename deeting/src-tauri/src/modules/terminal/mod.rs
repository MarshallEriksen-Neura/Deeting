//! Terminal module — owns the PTY-backed shell sessions used by the chat
//! page's right-side terminal panel.
//!
//! The module exposes:
//! - [`TerminalManager`]: app-level singleton that owns active sessions.
//! - 4 Tauri commands (`pty_open`, `pty_write`, `pty_resize`, `pty_close`).
//! - 2 Tauri events (`terminal:output`, `terminal:exit`).
//!
//! v1 enforces a single concurrent session at the backend layer; frontend
//! is the only caller of `pty_open` and treats the second-open error as a
//! programming bug.

pub mod commands;
pub mod manager;
pub mod session;

pub use manager::TerminalManager;
pub use session::{
    PtyExitPayload, PtyOutputPayload, PtySessionConfig, PtySessionError,
};
