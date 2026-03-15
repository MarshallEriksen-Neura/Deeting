use tauri::State;

use crate::modules::monitor::types::{
    LocalMonitorActionResponse, LocalMonitorCreateResponse, LocalMonitorExecutionLogListResponse,
    LocalMonitorFeedbackRequest, LocalMonitorListQuery, LocalMonitorLogsQuery,
    LocalMonitorStatsResponse, LocalMonitorTask, LocalMonitorTaskCreateRequest,
    LocalMonitorTaskIdRequest, LocalMonitorTaskListResponse, LocalMonitorTaskUpdateRequest,
    LocalMonitorTriggerResponse, LocalNotificationChannel, LocalNotificationChannelCreateRequest,
    LocalNotificationChannelCreateResponse, LocalNotificationChannelDeleteResponse,
    LocalNotificationChannelListResponse, LocalNotificationChannelTestRequest,
    LocalNotificationChannelTestResponse, LocalNotificationChannelUpdateRequest,
    LocalNotificationChannelUpdateResponse, MonitorWorkerStartRequest, MonitorWorkerStatus,
};
use crate::state::AppState;

#[tauri::command]
pub async fn list_local_monitor_tasks(
    state: State<'_, AppState>,
    query: LocalMonitorListQuery,
) -> Result<LocalMonitorTaskListResponse, String> {
    state.monitor.list_tasks(query).await
}

#[tauri::command]
pub async fn get_local_monitor_task(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<LocalMonitorTask, String> {
    state.monitor.get_task(task_id).await
}

#[tauri::command]
pub async fn create_local_monitor_task(
    state: State<'_, AppState>,
    payload: LocalMonitorTaskCreateRequest,
) -> Result<LocalMonitorCreateResponse, String> {
    state.monitor.create_task(payload).await
}

#[tauri::command]
pub async fn update_local_monitor_task(
    state: State<'_, AppState>,
    task_id: String,
    payload: LocalMonitorTaskUpdateRequest,
) -> Result<LocalMonitorTask, String> {
    state.monitor.update_task(task_id, payload).await
}

#[tauri::command]
pub async fn pause_local_monitor_task(
    state: State<'_, AppState>,
    payload: LocalMonitorTaskIdRequest,
) -> Result<LocalMonitorActionResponse, String> {
    state.monitor.pause_task(payload).await
}

#[tauri::command]
pub async fn resume_local_monitor_task(
    state: State<'_, AppState>,
    payload: LocalMonitorTaskIdRequest,
) -> Result<LocalMonitorActionResponse, String> {
    state.monitor.resume_task(payload).await
}

#[tauri::command]
pub async fn trigger_local_monitor_task(
    state: State<'_, AppState>,
    payload: LocalMonitorTaskIdRequest,
) -> Result<LocalMonitorTriggerResponse, String> {
    state.monitor.trigger_task(payload).await
}

#[tauri::command]
pub async fn delete_local_monitor_task(
    state: State<'_, AppState>,
    payload: LocalMonitorTaskIdRequest,
) -> Result<LocalMonitorActionResponse, String> {
    state.monitor.delete_task(payload).await
}

#[tauri::command]
pub async fn get_local_monitor_stats(
    state: State<'_, AppState>,
) -> Result<LocalMonitorStatsResponse, String> {
    state.monitor.get_stats().await
}

#[tauri::command]
pub async fn list_local_monitor_logs(
    state: State<'_, AppState>,
    query: LocalMonitorLogsQuery,
) -> Result<LocalMonitorExecutionLogListResponse, String> {
    state.monitor.list_logs(query).await
}

#[tauri::command]
pub async fn submit_local_monitor_feedback(
    state: State<'_, AppState>,
    payload: LocalMonitorFeedbackRequest,
) -> Result<(), String> {
    state
        .monitor
        .submit_feedback(payload.task_id, payload.log_id, payload.score)
        .await
}

#[tauri::command]
pub async fn list_local_notification_channels(
    state: State<'_, AppState>,
) -> Result<LocalNotificationChannelListResponse, String> {
    state.monitor.list_notification_channels().await
}

#[tauri::command]
pub async fn get_local_notification_channel(
    state: State<'_, AppState>,
    channel_id: String,
) -> Result<LocalNotificationChannel, String> {
    state.monitor.get_notification_channel(channel_id).await
}

#[tauri::command]
pub async fn create_local_notification_channel(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
    payload: LocalNotificationChannelCreateRequest,
) -> Result<LocalNotificationChannelCreateResponse, String> {
    let response = state.monitor.create_notification_channel(payload).await?;
    crate::modules::im::runtime::spawn_im_runtime_worker(state.inner().clone(), app_handle);
    Ok(response)
}

#[tauri::command]
pub async fn update_local_notification_channel(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
    channel_id: String,
    payload: LocalNotificationChannelUpdateRequest,
) -> Result<LocalNotificationChannelUpdateResponse, String> {
    let response = state
        .monitor
        .update_notification_channel(channel_id, payload)
        .await?;
    crate::modules::im::runtime::spawn_im_runtime_worker(state.inner().clone(), app_handle);
    Ok(response)
}

#[tauri::command]
pub async fn delete_local_notification_channel(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
    channel_id: String,
) -> Result<LocalNotificationChannelDeleteResponse, String> {
    let response = state.monitor.delete_notification_channel(channel_id).await?;
    crate::modules::im::runtime::spawn_im_runtime_worker(state.inner().clone(), app_handle);
    Ok(response)
}

#[tauri::command]
pub async fn test_local_notification_channel(
    state: State<'_, AppState>,
    payload: LocalNotificationChannelTestRequest,
) -> Result<LocalNotificationChannelTestResponse, String> {
    state.monitor.test_notification_channel(payload).await
}

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
