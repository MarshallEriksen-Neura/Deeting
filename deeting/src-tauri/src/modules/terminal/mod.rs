//! Terminal module — owns the PTY-backed shell sessions used by the chat
//! page's right-side terminal panel.
//!
//! The module exposes:
//! - [`TerminalManager`]: app-level singleton that owns active sessions.
//! - Tauri commands for creating, listing, writing, resizing, and closing PTYs.
//! - 2 Tauri events (`terminal:output`, `terminal:exit`).
//!
//! `pty_open` keeps the original attach-or-create behavior for compatibility.
//! `pty_create` creates independent sessions for multi-terminal UI tabs.

pub mod commands;
pub mod manager;
pub mod session;

pub use manager::TerminalManager;
pub use session::{PtyExitPayload, PtyOutputPayload, PtySessionConfig, PtySessionError};
