//! Single PTY session: shell process + master pty + reader thread.
//!
//! Lifecycle:
//! 1. [`PtySession::spawn`] opens a PTY pair, spawns the platform shell
//!    into the slave, drops the slave (so EOF propagates when child exits),
//!    clones a reader and takes the writer from the master, and starts a
//!    dedicated reader thread that emits `terminal:output` events.
//! 2. Subsequent writes/resizes go through `&self` methods that lock the
//!    relevant master/writer Mutex briefly.
//! 3. [`PtySession::shutdown`] kills the child, drops master/writer to
//!    close the pipes, and joins the reader thread. The reader thread's
//!    own EOF detection emits `terminal:exit`.
//!
//! v1 doesn't track exit codes — `PtyExitPayload::exit_code` is always
//! `None`. v1.5 plans to add a try_wait poll loop to capture it.

use std::collections::VecDeque;
use std::io::{Read, Write};
#[cfg(target_os = "windows")]
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::sync::Arc;
use std::thread::{self, JoinHandle};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use thiserror::Error;

const READ_CHUNK_SIZE: usize = 8 * 1024;
const REPLAY_MAX_BYTES: usize = 256 * 1024;
const TERMINAL_OUTPUT_EVENT: &str = "terminal:output";
const TERMINAL_EXIT_EVENT: &str = "terminal:exit";

#[cfg(target_os = "windows")]
const POWERSHELL_OSC_133_INIT_SCRIPT: &str = r#"
$global:__DEETING_OSC133_COMMAND_ACTIVE = $false
if (-not $global:__DEETING_OSC133_ORIGINAL_PROMPT) {
  $global:__DEETING_OSC133_ORIGINAL_PROMPT = (Get-Command prompt -CommandType Function).ScriptBlock
}
try {
  $PSStyle.FileInfo.Directory = $PSStyle.Foreground.BrightBlue
} catch {}
function global:__deeting_osc133_emit([string]$Payload) {
  [Console]::Write("$([char]27)]133;$Payload$([char]7)")
}
function global:prompt {
  $deetingSucceeded = $?
  $deetingNativeExitCode = $global:LASTEXITCODE
  $deetingExitCode = if ($deetingSucceeded) { 0 } elseif ($deetingNativeExitCode -is [int] -and $deetingNativeExitCode -ne 0) { $deetingNativeExitCode } else { 1 }
  if ($global:__DEETING_OSC133_COMMAND_ACTIVE) {
    __deeting_osc133_emit "D;$deetingExitCode"
    $global:__DEETING_OSC133_COMMAND_ACTIVE = $false
  }
  $deetingCwd = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((Get-Location).Path))
  __deeting_osc133_emit "A;cwd_base64=$deetingCwd"
  $deetingPromptOutput = & $global:__DEETING_OSC133_ORIGINAL_PROMPT
  if ($null -eq $deetingPromptOutput) {
    [Console]::Write($PSStyle.Reset)
    return
  }
  return "$deetingPromptOutput$($PSStyle.Reset)"
}
try {
  Import-Module PSReadLine -ErrorAction SilentlyContinue
  if (Get-Module PSReadLine) {
    Set-PSReadLineKeyHandler -Key Enter -BriefDescription DeetingOsc133AcceptLine -ScriptBlock {
      $line = ""
      $cursor = 0
      [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$line, [ref]$cursor)
      if ($line.Trim().Length -gt 0) {
        $global:__DEETING_OSC133_COMMAND_ACTIVE = $true
        $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($line))
        [Console]::Write("$([char]27)]133;C;command_base64=$encoded$([char]7)")
      }
      [Microsoft.PowerShell.PSConsoleReadLine]::AcceptLine()
    }
  }
} catch {}
"#;

#[derive(Debug, Error)]
pub enum PtySessionError {
    #[error("a terminal session is already open")]
    AlreadyOpen,
    #[error("terminal session not found")]
    SessionNotFound,
    #[error("terminal session has been closed")]
    SessionClosed,
    #[error("internal lock poisoned")]
    PoisonedLock,
    #[error("pty system error: {0}")]
    Pty(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

/// Payload for the `terminal:output` event.
#[derive(Clone, Debug, Serialize)]
pub struct PtyOutputPayload {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    /// Monotonic per-session output sequence. Used by remounting xterm views
    /// to merge backend replay with live output without duplication.
    pub sequence: u64,
    /// UTF-8 lossy decoded chunk. xterm.js handles ANSI parsing downstream.
    pub data: String,
}

/// Payload for the `terminal:exit` event.
#[derive(Clone, Debug, Serialize)]
pub struct PtyExitPayload {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    /// v1 always emits `None` (we don't poll for exit code yet).
    #[serde(rename = "exitCode")]
    pub exit_code: Option<i32>,
}

#[derive(Debug, Clone, Default)]
pub struct PtySessionConfig {
    pub cols: u16,
    pub rows: u16,
    pub cwd: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct PtyReplayChunk {
    pub sequence: u64,
    pub data: String,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct PtyReplaySnapshot {
    #[serde(rename = "lastSequence")]
    pub last_sequence: u64,
    pub chunks: Vec<PtyReplayChunk>,
}

#[derive(Debug, Default)]
struct PtyReplayBuffer {
    chunks: VecDeque<PtyReplayChunk>,
    next_sequence: u64,
    total_bytes: usize,
}

impl PtyReplayBuffer {
    fn append(&mut self, data: String) -> u64 {
        self.next_sequence = self.next_sequence.saturating_add(1);
        let sequence = self.next_sequence;
        self.total_bytes = self.total_bytes.saturating_add(data.len());
        self.chunks.push_back(PtyReplayChunk { sequence, data });
        while self.total_bytes > REPLAY_MAX_BYTES {
            let Some(stale) = self.chunks.pop_front() else {
                self.total_bytes = 0;
                break;
            };
            self.total_bytes = self.total_bytes.saturating_sub(stale.data.len());
        }
        sequence
    }

    fn snapshot(&self) -> PtyReplaySnapshot {
        PtyReplaySnapshot {
            last_sequence: self.next_sequence,
            chunks: self.chunks.iter().cloned().collect(),
        }
    }
}

pub struct PtySession {
    #[allow(dead_code)]
    id: String,
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    writer: Mutex<Option<Box<dyn Write + Send>>>,
    child: Mutex<Option<Box<dyn Child + Send + Sync>>>,
    reader_thread: Mutex<Option<JoinHandle<()>>>,
    replay: Arc<Mutex<PtyReplayBuffer>>,
    exited: Arc<AtomicBool>,
}

impl PtySession {
    pub fn spawn(
        id: String,
        config: PtySessionConfig,
        app: AppHandle,
    ) -> Result<Self, PtySessionError> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: config.rows.max(1),
                cols: config.cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| PtySessionError::Pty(e.to_string()))?;

        let mut cmd = build_shell_command();
        if let Some(cwd) = config.cwd.as_ref() {
            cmd.cwd(cwd);
        } else if let Some(home) = dirs::home_dir() {
            cmd.cwd(home);
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| PtySessionError::Pty(e.to_string()))?;
        // Drop the slave so when the child exits, EOF propagates to the
        // master reader and the reader thread terminates naturally.
        drop(pair.slave);

        let master = pair.master;
        let reader = master
            .try_clone_reader()
            .map_err(|e| PtySessionError::Pty(e.to_string()))?;
        let writer = master
            .take_writer()
            .map_err(|e| PtySessionError::Pty(e.to_string()))?;

        let replay = Arc::new(Mutex::new(PtyReplayBuffer::default()));
        let exited = Arc::new(AtomicBool::new(false));
        let reader_handle = spawn_reader_thread(
            id.clone(),
            reader,
            app,
            Arc::clone(&replay),
            Arc::clone(&exited),
        );

        Ok(Self {
            id,
            master: Mutex::new(Some(master)),
            writer: Mutex::new(Some(writer)),
            child: Mutex::new(Some(child)),
            reader_thread: Mutex::new(Some(reader_handle)),
            replay,
            exited,
        })
    }

    pub fn write(&self, data: &[u8]) -> Result<(), PtySessionError> {
        let mut guard = self.lock_writer()?;
        let writer = guard.as_mut().ok_or(PtySessionError::SessionClosed)?;
        writer.write_all(data)?;
        // Best-effort flush: on PTYs flush is usually a no-op but some
        // platforms benefit from it. Errors here are non-fatal.
        let _ = writer.flush();
        Ok(())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), PtySessionError> {
        let guard = self.lock_master()?;
        let master = guard.as_ref().ok_or(PtySessionError::SessionClosed)?;
        master
            .resize(PtySize {
                rows: rows.max(1),
                cols: cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| PtySessionError::Pty(e.to_string()))?;
        Ok(())
    }

    pub fn replay(&self) -> Result<PtyReplaySnapshot, PtySessionError> {
        self.replay
            .lock()
            .map(|guard| guard.snapshot())
            .map_err(|_| PtySessionError::PoisonedLock)
    }

    pub fn is_exited(&self) -> bool {
        self.exited.load(Ordering::SeqCst)
    }

    /// Tear down the session. Safe to call repeatedly — subsequent calls
    /// are no-ops once Master/writer/child have been taken out.
    pub fn shutdown(&self) {
        // 1. Kill child + reap to avoid zombies. Best-effort; ignore errors.
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
        // 2. Drop the writer half so further pty_write calls fail cleanly.
        if let Ok(mut guard) = self.writer.lock() {
            guard.take();
        }
        // 3. Drop the master so the reader thread sees EOF and exits.
        if let Ok(mut guard) = self.master.lock() {
            guard.take();
        }
        // 4. Wait for reader thread to drain + emit terminal:exit.
        if let Ok(mut guard) = self.reader_thread.lock() {
            if let Some(handle) = guard.take() {
                let _ = handle.join();
            }
        }
    }

    fn lock_master(
        &self,
    ) -> Result<MutexGuard<'_, Option<Box<dyn MasterPty + Send>>>, PtySessionError> {
        self.master
            .lock()
            .map_err(|_| PtySessionError::PoisonedLock)
    }

    fn lock_writer(
        &self,
    ) -> Result<MutexGuard<'_, Option<Box<dyn Write + Send>>>, PtySessionError> {
        self.writer
            .lock()
            .map_err(|_| PtySessionError::PoisonedLock)
    }
}

impl Drop for PtySession {
    fn drop(&mut self) {
        // Defensive: if shutdown wasn't called explicitly, do it now.
        self.shutdown();
    }
}

fn spawn_reader_thread(
    session_id: String,
    mut reader: Box<dyn Read + Send>,
    app: AppHandle,
    replay: Arc<Mutex<PtyReplayBuffer>>,
    exited: Arc<AtomicBool>,
) -> JoinHandle<()> {
    thread::Builder::new()
        .name(format!("pty-reader-{session_id}"))
        .spawn(move || {
            let mut buf = vec![0u8; READ_CHUNK_SIZE];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break, // EOF — child closed master pipe
                    Ok(n) => {
                        let chunk = String::from_utf8_lossy(&buf[..n]).into_owned();
                        let sequence = replay
                            .lock()
                            .map(|mut guard| guard.append(chunk.clone()))
                            .unwrap_or(0);
                        let _ = app.emit(
                            TERMINAL_OUTPUT_EVENT,
                            PtyOutputPayload {
                                session_id: session_id.clone(),
                                sequence,
                                data: chunk,
                            },
                        );
                    }
                    Err(_) => break,
                }
            }
            exited.store(true, Ordering::SeqCst);
            let _ = app.emit(
                TERMINAL_EXIT_EVENT,
                PtyExitPayload {
                    session_id,
                    exit_code: None,
                },
            );
        })
        .expect("failed to spawn pty reader thread")
}

#[cfg(target_os = "windows")]
fn build_shell_command() -> CommandBuilder {
    // Prefer pwsh.exe (PowerShell 7+) when available — better UTF-8 handling
    // out of the box. Fall back to powershell.exe (always installed on
    // modern Windows). cmd.exe is intentionally not used: poor TUI support.
    let mut cmd = if find_executable_on_path("pwsh.exe").is_some() {
        CommandBuilder::new("pwsh.exe")
    } else {
        CommandBuilder::new("powershell.exe")
    };
    cmd.arg("-NoLogo");
    cmd.arg("-NoExit");
    cmd.arg("-Command");
    cmd.arg(POWERSHELL_OSC_133_INIT_SCRIPT);
    cmd
}

#[cfg(target_os = "windows")]
fn find_executable_on_path(name: &str) -> Option<PathBuf> {
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths).find_map(|dir| {
            let candidate = dir.join(name);
            if candidate.is_file() {
                Some(candidate)
            } else {
                None
            }
        })
    })
}

#[cfg(not(target_os = "windows"))]
fn build_shell_command() -> CommandBuilder {
    // Honour $SHELL if set, otherwise fall back to bash. We don't pass any
    // flags — PTY-attached shells default to interactive mode and source
    // the user's rc files. v1 deliberately leaves shell behaviour vanilla.
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
    CommandBuilder::new(shell)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn output_payload_serializes_with_camel_case_session_id() {
        let payload = PtyOutputPayload {
            session_id: "abc".into(),
            sequence: 7,
            data: "hello".into(),
        };
        let json = serde_json::to_string(&payload).expect("serialize");
        assert!(json.contains("\"sessionId\":\"abc\""));
        assert!(json.contains("\"sequence\":7"));
        assert!(json.contains("\"data\":\"hello\""));
    }

    #[test]
    fn replay_buffer_prunes_old_chunks_by_byte_budget() {
        let mut replay = PtyReplayBuffer::default();
        let first = replay.append("a".repeat(REPLAY_MAX_BYTES));
        let second = replay.append("b".repeat(2));
        let snapshot = replay.snapshot();

        assert_eq!(first, 1);
        assert_eq!(second, 2);
        assert_eq!(snapshot.last_sequence, 2);
        assert_eq!(snapshot.chunks.len(), 1);
        assert_eq!(snapshot.chunks[0].sequence, 2);
    }

    #[test]
    fn exit_payload_serializes_with_null_exit_code_in_v1() {
        let payload = PtyExitPayload {
            session_id: "abc".into(),
            exit_code: None,
        };
        let json = serde_json::to_string(&payload).expect("serialize");
        assert!(json.contains("\"sessionId\":\"abc\""));
        assert!(json.contains("\"exitCode\":null"));
    }
}
