use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};

use crate::state::AppState;

use super::config::{load_binding, normalize_vault_root, resolve_workspace_path};
use super::store::enqueue_change;

const WATCHER_POLL_INTERVAL: Duration = Duration::from_secs(5);
const WATCHER_DEBOUNCE_WINDOW: Duration = Duration::from_millis(800);

pub(crate) fn start_local_llm_wiki_watcher(app_state: AppState) {
    tauri::async_runtime::spawn(async move {
        let mut active_key: Option<String> = None;
        let mut active_stop: Option<mpsc::Sender<()>> = None;

        loop {
            let binding = match load_binding(app_state.mcp.store.as_ref()).await {
                Ok(binding) => binding,
                Err(err) => {
                    log::warn!("llm wiki watcher failed to load binding: {}", err);
                    tokio::time::sleep(WATCHER_POLL_INTERVAL).await;
                    continue;
                }
            };

            let next_key = binding.as_ref().map(|binding| {
                format!(
                    "{}::{}",
                    binding.vault_root.trim(),
                    binding.workspace_relative_path.trim()
                )
            });

            if next_key != active_key {
                if let Some(stop_tx) = active_stop.take() {
                    let _ = stop_tx.send(());
                }

                active_key = next_key.clone();
                if let Some(binding) = binding {
                    match normalize_vault_root(&binding.vault_root) {
                        Ok(vault_root) => {
                            let workspace_path = resolve_workspace_path(
                                &vault_root,
                                &binding.workspace_relative_path,
                            );
                            let (stop_tx, stop_rx) = mpsc::channel::<()>();
                            active_stop = Some(stop_tx);
                            spawn_watcher_thread(
                                app_state.clone(),
                                vault_root,
                                workspace_path,
                                stop_rx,
                            );
                        }
                        Err(error) => {
                            log::warn!("llm wiki watcher skipped invalid binding: {}", error);
                        }
                    }
                }
            }

            tokio::time::sleep(WATCHER_POLL_INTERVAL).await;
        }
    });
}

fn spawn_watcher_thread(
    app_state: AppState,
    vault_root: PathBuf,
    workspace_path: PathBuf,
    stop_rx: mpsc::Receiver<()>,
) {
    std::thread::spawn(move || {
        let (event_tx, event_rx) = mpsc::channel::<notify::Result<Event>>();
        let mut watcher = match RecommendedWatcher::new(
            move |event| {
                let _ = event_tx.send(event);
            },
            Config::default(),
        ) {
            Ok(watcher) => watcher,
            Err(err) => {
                log::warn!("llm wiki watcher startup failed: {}", err);
                return;
            }
        };

        if let Err(err) = watcher.watch(&vault_root, RecursiveMode::Recursive) {
            log::warn!(
                "llm wiki watcher failed to watch {}: {}",
                vault_root.display(),
                err
            );
            return;
        }

        let mut pending = HashMap::<String, (PathBuf, &'static str, Instant)>::new();
        loop {
            if stop_rx.try_recv().is_ok() {
                break;
            }

            match event_rx.recv_timeout(Duration::from_millis(250)) {
                Ok(Ok(event)) => {
                    for path in event.paths {
                        if let Some(change_kind) = map_change_kind(&event.kind) {
                            if let Some(relative_path) =
                                normalize_watched_relative_path(&vault_root, &path)
                            {
                                pending.insert(
                                    relative_path,
                                    (path.clone(), change_kind, Instant::now()),
                                );
                            }
                        }
                    }
                }
                Ok(Err(err)) => {
                    log::warn!("llm wiki watcher event error: {}", err);
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }

            let ready = pending
                .iter()
                .filter(|(_, (_, _, seen_at))| seen_at.elapsed() >= WATCHER_DEBOUNCE_WINDOW)
                .map(|(relative_path, (path, change_kind, _))| {
                    (relative_path.clone(), path.clone(), *change_kind)
                })
                .collect::<Vec<_>>();

            if ready.is_empty() {
                continue;
            }

            for (relative_path, path, change_kind) in ready {
                pending.remove(&relative_path);
                let app_state = app_state.clone();
                let workspace_path = workspace_path.clone();
                tauri::async_runtime::spawn(async move {
                    let now = match mcp_storage::helpers::now_rfc3339() {
                        Ok(value) => value,
                        Err(err) => {
                            log::warn!("llm wiki watcher could not build timestamp: {}", err);
                            return;
                        }
                    };
                    let workspace_id = workspace_path.to_string_lossy().replace('\\', "/");
                    let absolute_path = if path.exists() {
                        Some(path.to_string_lossy().to_string())
                    } else {
                        None
                    };
                    if let Err(err) = enqueue_change(
                        app_state.mcp.store.as_ref(),
                        &workspace_id,
                        None,
                        &relative_path,
                        absolute_path.as_deref(),
                        change_kind,
                        "watcher",
                        &now,
                    )
                    .await
                    {
                        log::warn!(
                            "llm wiki watcher failed to enqueue {}: {}",
                            relative_path,
                            err
                        );
                    }
                });
            }
        }
    });
}

fn normalize_watched_relative_path(vault_root: &Path, path: &Path) -> Option<String> {
    let relative = path
        .strip_prefix(vault_root)
        .ok()?
        .to_string_lossy()
        .replace('\\', "/");
    if relative.trim().is_empty() {
        return None;
    }
    let lower = relative.to_ascii_lowercase();
    if lower.starts_with(".git/")
        || lower.starts_with(".trash/")
        || lower.starts_with("node_modules/")
        || lower.starts_with(".next/")
    {
        return None;
    }
    let is_markdown = Path::new(&relative)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("md"))
        .unwrap_or(false);
    if !is_markdown {
        return None;
    }
    Some(relative)
}

fn map_change_kind(kind: &EventKind) -> Option<&'static str> {
    match kind {
        EventKind::Create(_) | EventKind::Modify(_) => Some("upsert"),
        EventKind::Remove(_) => Some("delete"),
        _ => None,
    }
}
