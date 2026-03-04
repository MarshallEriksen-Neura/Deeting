use tauri::State;

use crate::modules::monitor::types::{MonitorWorkerStartRequest, MonitorWorkerStatus};
use crate::state::AppState;

#[tauri::command]
pub async fn start_local_monitor_worker(
    state: State<'_, AppState>,
    payload: MonitorWorkerStartRequest,
) -> Result<MonitorWorkerStatus, String> {
    state.monitor.start_worker(payload).await
}

#[tauri::command]
pub async fn stop_local_monitor_worker(
    state: State<'_, AppState>,
) -> Result<MonitorWorkerStatus, String> {
    state.monitor.stop_worker().await
}

#[tauri::command]
pub async fn get_local_monitor_worker_status(
    state: State<'_, AppState>,
) -> Result<MonitorWorkerStatus, String> {
    state.monitor.get_status().await
}

#[tauri::command]
pub async fn run_local_monitor_worker_once(
    state: State<'_, AppState>,
) -> Result<MonitorWorkerStatus, String> {
    state.monitor.run_once().await
}
