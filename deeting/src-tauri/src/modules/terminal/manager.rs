//! Manager for active PTY sessions.
//!
//! This is intentionally a thin coordinator: lifecycle work lives in
//! [`PtySession`]. The manager owns the session map, supports app-local
//! reattachment, and provides shutdown for app exit.
//!
//! [`PtySession`]: crate::modules::terminal::session::PtySession

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tauri::AppHandle;
use uuid::Uuid;

use super::session::{PtyReplaySnapshot, PtySession, PtySessionConfig, PtySessionError};

pub type SessionId = String;

#[derive(Clone, Debug)]
pub struct TerminalSessionInfo {
    pub session_id: SessionId,
    pub status: &'static str,
}

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
        self.sessions.lock().map(|guard| guard.len()).unwrap_or(0)
    }

    /// Spawn a shell session or return the existing one.
    ///
    /// The terminal panel is route-local, but the shell is app-local. If the
    /// user leaves the chat route and comes back, the new frontend xterm view
    /// should attach to the existing PTY instead of failing with
    /// [`PtySessionError::AlreadyOpen`] or killing the user's shell state.
    pub fn open(
        &self,
        config: PtySessionConfig,
        app: AppHandle,
    ) -> Result<SessionId, PtySessionError> {
        let mut guard = self
            .sessions
            .lock()
            .map_err(|_| PtySessionError::PoisonedLock)?;
        if let Some(existing_id) = guard.keys().next().cloned() {
            return Ok(existing_id);
        }
        Self::spawn_locked(&mut guard, config, app, None)
    }

    /// Spawn a new independent shell session, or reattach when the frontend
    /// presents an id that already belongs to a live backend PTY.
    pub fn create(
        &self,
        config: PtySessionConfig,
        app: AppHandle,
        requested_id: Option<String>,
    ) -> Result<SessionId, PtySessionError> {
        let requested_id = normalize_requested_id(requested_id);
        let mut guard = self
            .sessions
            .lock()
            .map_err(|_| PtySessionError::PoisonedLock)?;
        if let Some(id) = requested_id.as_deref() {
            if let Some(existing) = guard.get(id).cloned() {
                if !existing.is_exited() {
                    drop(guard);
                    let _ = existing.resize(config.cols, config.rows);
                    return Ok(id.to_string());
                }

                guard.remove(id);
                drop(guard);
                existing.shutdown();

                let mut guard = self
                    .sessions
                    .lock()
                    .map_err(|_| PtySessionError::PoisonedLock)?;
                return Self::spawn_locked(&mut guard, config, app, Some(id.to_string()));
            }
        }
        Self::spawn_locked(&mut guard, config, app, requested_id)
    }

    pub fn session_ids(&self) -> Vec<SessionId> {
        let mut ids: Vec<SessionId> = self
            .sessions
            .lock()
            .map(|guard| guard.keys().cloned().collect())
            .unwrap_or_default();
        ids.sort();
        ids
    }

    pub fn session_infos(&self) -> Vec<TerminalSessionInfo> {
        let mut infos = self
            .sessions
            .lock()
            .map(|guard| {
                guard
                    .iter()
                    .map(|(session_id, session)| TerminalSessionInfo {
                        session_id: session_id.clone(),
                        status: if session.is_exited() { "exited" } else { "ready" },
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        infos.sort_by(|left, right| left.session_id.cmp(&right.session_id));
        infos
    }

    pub fn write(&self, id: &str, data: &[u8]) -> Result<(), PtySessionError> {
        self.get(id)?.write(data)
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), PtySessionError> {
        self.get(id)?.resize(cols, rows)
    }

    pub fn replay(&self, id: &str) -> Result<PtyReplaySnapshot, PtySessionError> {
        self.get(id)?.replay()
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

    fn spawn_locked(
        guard: &mut HashMap<SessionId, Arc<PtySession>>,
        config: PtySessionConfig,
        app: AppHandle,
        requested_id: Option<String>,
    ) -> Result<SessionId, PtySessionError> {
        let id = requested_id.unwrap_or_else(|| Uuid::new_v4().to_string());
        if guard.contains_key(&id) {
            return Err(PtySessionError::AlreadyOpen);
        }
        let session = Arc::new(PtySession::spawn(id.clone(), config, app)?);
        guard.insert(id.clone(), session);
        Ok(id)
    }
}

fn normalize_requested_id(requested_id: Option<String>) -> Option<String> {
    requested_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
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
