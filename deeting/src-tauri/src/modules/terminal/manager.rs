//! Manager for active PTY sessions.
//!
//! This is intentionally a thin coordinator: lifecycle work lives in
//! [`PtySession`]. The manager owns the session map, enforces the v1
//! single-session rule, and provides shutdown for app exit.
//!
//! [`PtySession`]: crate::modules::terminal::session::PtySession

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tauri::AppHandle;
use uuid::Uuid;

use super::session::{PtySession, PtySessionConfig, PtySessionError};

pub type SessionId = String;

/// Owns active PTY sessions. App-level singleton.
pub struct TerminalManager {
    sessions: Mutex<HashMap<SessionId, Arc<PtySession>>>,
}

impl TerminalManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    /// Number of currently active sessions. Primarily for tests.
    pub fn session_count(&self) -> usize {
        self.sessions
            .lock()
            .map(|guard| guard.len())
            .unwrap_or(0)
    }

    /// Spawn a new shell session.
    ///
    /// Errors with [`PtySessionError::AlreadyOpen`] if any session already
    /// exists — v1 is single-session by contract. The frontend is expected
    /// to call [`Self::close`] before reopening.
    pub fn open(
        &self,
        config: PtySessionConfig,
        app: AppHandle,
    ) -> Result<SessionId, PtySessionError> {
        let mut guard = self
            .sessions
            .lock()
            .map_err(|_| PtySessionError::PoisonedLock)?;
        if !guard.is_empty() {
            return Err(PtySessionError::AlreadyOpen);
        }
        let id = Uuid::new_v4().to_string();
        let session = Arc::new(PtySession::spawn(id.clone(), config, app)?);
        guard.insert(id.clone(), session);
        Ok(id)
    }

    pub fn write(&self, id: &str, data: &[u8]) -> Result<(), PtySessionError> {
        self.get(id)?.write(data)
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), PtySessionError> {
        self.get(id)?.resize(cols, rows)
    }

    /// Close and remove a session. Idempotent: closing an unknown session
    /// is a no-op (returns Ok). This makes frontend reload paths simpler.
    pub fn close(&self, id: &str) -> Result<(), PtySessionError> {
        let mut guard = self
            .sessions
            .lock()
            .map_err(|_| PtySessionError::PoisonedLock)?;
        if let Some(session) = guard.remove(id) {
            // Drop the manager lock before shutting down to avoid holding it
            // across the wait() inside shutdown(). The session is now solely
            // owned by `session` and the manager won't see it again.
            drop(guard);
            session.shutdown();
        }
        Ok(())
    }

    /// Tear down all sessions. Called on app exit via Drop.
    pub fn shutdown_all(&self) {
        let drained: Vec<Arc<PtySession>> = match self.sessions.lock() {
            Ok(mut guard) => guard.drain().map(|(_, s)| s).collect(),
            Err(_) => return,
        };
        for session in drained {
            session.shutdown();
        }
    }

    fn get(&self, id: &str) -> Result<Arc<PtySession>, PtySessionError> {
        self.sessions
            .lock()
            .map_err(|_| PtySessionError::PoisonedLock)?
            .get(id)
            .cloned()
            .ok_or(PtySessionError::SessionNotFound)
    }
}

impl Default for TerminalManager {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for TerminalManager {
    fn drop(&mut self) {
        self.shutdown_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_manager_has_no_sessions() {
        let manager = TerminalManager::new();
        assert_eq!(manager.session_count(), 0);
    }

    #[test]
    fn close_unknown_session_is_idempotent() {
        let manager = TerminalManager::new();
        // Closing a non-existent id should not error.
        let result = manager.close("does-not-exist");
        assert!(result.is_ok());
        assert_eq!(manager.session_count(), 0);
    }
}
