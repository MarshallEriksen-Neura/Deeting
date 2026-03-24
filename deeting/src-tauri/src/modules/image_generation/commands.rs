use tauri::{AppHandle, State};

use crate::modules::ai_upstream::image::request_provider_image_generation;
use crate::modules::image_generation::storage::{
    build_image_output_items, persist_generated_image,
};
use crate::modules::image_generation::store::{
    cancel_task_by_request_id, create_task, get_task, get_task_record, list_tasks,
    mark_task_failed, mark_task_running, mark_task_succeeded,
};
use crate::modules::image_generation::types::{
    LocalImageGenerationCancelResponse, LocalImageGenerationTaskCreateRequest,
    LocalImageGenerationTaskCreateResponse, LocalImageGenerationTaskDetail,
    LocalImageGenerationTaskPage, LocalImageGenerationTasksQuery,
};
use crate::state::AppState;

#[tauri::command]
pub async fn create_local_image_generation_task(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: LocalImageGenerationTaskCreateRequest,
) -> Result<LocalImageGenerationTaskCreateResponse, String> {
    let task = create_task(state.mcp.store.as_ref(), &payload)
        .await
        .map_err(|err| err.to_string())?;
    let task_id = task.task_id.clone();
    let app_state = state.inner().clone();
    tauri::async_runtime::spawn(async move {
        let _ = process_local_image_generation_task(&app, &app_state, &task_id).await;
    });
    Ok(task)
}

pub(crate) async fn run_local_image_generation_task_inline(
    app: &AppHandle,
    app_state: &AppState,
    payload: LocalImageGenerationTaskCreateRequest,
) -> Result<LocalImageGenerationTaskDetail, String> {
    let created = create_task(app_state.mcp.store.as_ref(), &payload)
        .await
        .map_err(|err| err.to_string())?;
    process_local_image_generation_task(app, app_state, &created.task_id).await?;
    get_task(app_state.mcp.store.as_ref(), &created.task_id)
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "local image generation task not found after processing".to_string())
}

#[tauri::command]
pub async fn get_local_image_generation_task(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<LocalImageGenerationTaskDetail, String> {
    get_task(state.mcp.store.as_ref(), &task_id)
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "local image generation task not found".to_string())
}

#[tauri::command]
pub async fn list_local_image_generation_tasks(
    state: State<'_, AppState>,
    query: LocalImageGenerationTasksQuery,
) -> Result<LocalImageGenerationTaskPage, String> {
    list_tasks(state.mcp.store.as_ref(), &query)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn cancel_local_image_generation_task(
    state: State<'_, AppState>,
    request_id: String,
) -> Result<LocalImageGenerationCancelResponse, String> {
    cancel_task_by_request_id(state.mcp.store.as_ref(), &request_id)
        .await
        .map_err(|err| err.to_string())
}

async fn process_local_image_generation_task(
    app: &AppHandle,
    app_state: &AppState,
    task_id: &str,
) -> Result<(), String> {
    mark_task_running(app_state.mcp.store.as_ref(), task_id)
        .await
        .map_err(|err| err.to_string())?;

    let task = get_task_record(app_state.mcp.store.as_ref(), task_id)
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "task not found".to_string())?;
    if task.status.eq_ignore_ascii_case("canceled") {
        return Ok(());
    }
    let raw = match request_provider_image_generation(app_state, &task, None).await {
        Ok(raw) => raw,
        Err(err) => {
            mark_task_failed(app_state.mcp.store.as_ref(), task_id, &err)
                .await
                .map_err(|error| error.to_string())?;
            return Err(err);
        }
    };

    let upstream_mode = raw
        .get("_async_mode")
        .and_then(|value| value.as_str())
        .unwrap_or("direct");
    let mut outputs = build_image_output_items(&raw);
    for output in &mut outputs {
        if let Some(source_url) = output.source_url.clone() {
            if let Some(record) = persist_generated_image(
                app,
                app_state,
                &source_url,
                output.content_type.as_deref().unwrap_or("image/png"),
            )
            .await
            {
                output.asset_url = record.asset_url;
                output.source_url = record.source_url;
                output.content_type = Some(record.content_type);
                output.size_bytes = Some(record.size_bytes);
            }
        }
    }

    mark_task_succeeded(
        app_state.mcp.store.as_ref(),
        task_id,
        &outputs,
        upstream_mode,
    )
    .await
    .map_err(|err| err.to_string())
}
