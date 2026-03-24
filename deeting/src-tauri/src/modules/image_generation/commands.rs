use tauri::AppHandle;

use crate::modules::ai_upstream::image::request_provider_image_generation;
use crate::modules::image_generation::storage::{
    build_image_output_items, persist_generated_image,
};
use crate::modules::image_generation::types::{
    LocalImageGenerationOutputItem, LocalImageGenerationTaskCreateRequest,
    LocalImageGenerationTaskDetail, LocalImageGenerationTaskRecord,
};
use crate::state::AppState;

pub(crate) async fn run_local_image_generation_task_inline(
    app: &AppHandle,
    app_state: &AppState,
    payload: LocalImageGenerationTaskCreateRequest,
) -> Result<LocalImageGenerationTaskDetail, String> {
    let now = time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|err| err.to_string())?;
    let task = LocalImageGenerationTaskRecord {
        task_id: uuid::Uuid::new_v4().to_string(),
        session_id: payload.session_id.clone(),
        request_id: payload.request_id.clone(),
        model: payload.model.clone(),
        provider_model_id: payload.provider_model_id.clone(),
        prompt: payload.prompt.clone(),
        prompt_encrypted: payload.encrypt_prompt.unwrap_or(false),
        negative_prompt: payload.negative_prompt.clone(),
        width: payload.width,
        height: payload.height,
        aspect_ratio: payload.aspect_ratio.clone(),
        num_outputs: payload.num_outputs,
        steps: payload.steps,
        cfg_scale: payload.cfg_scale,
        seed: payload.seed,
        sampler_name: payload.sampler_name.clone(),
        quality: payload.quality.clone(),
        style: payload.style.clone(),
        response_format: payload.response_format.clone(),
        image_url: payload.image_url.clone(),
        extra_params: payload.extra_params.clone(),
        status: "running".to_string(),
    };
    let (outputs, error_message, _upstream_mode) =
        execute_image_generation_for_task(app, app_state, &task).await;

    if let Some(err) = error_message {
        return Ok(LocalImageGenerationTaskDetail {
            task_id: task.task_id,
            status: "failed".to_string(),
            model: task.model,
            created_at: now.clone(),
            updated_at: now.clone(),
            completed_at: Some(now),
            error_code: Some("upstream_failed".to_string()),
            error_message: Some(err),
            outputs: Vec::new(),
        });
    }

    Ok(LocalImageGenerationTaskDetail {
        task_id: task.task_id,
        status: "succeeded".to_string(),
        model: task.model,
        created_at: now.clone(),
        updated_at: now.clone(),
        completed_at: Some(now),
        error_code: None,
        error_message: None,
        outputs,
    })
}

async fn execute_image_generation_for_task(
    app: &AppHandle,
    app_state: &AppState,
    task: &LocalImageGenerationTaskRecord,
) -> (Vec<LocalImageGenerationOutputItem>, Option<String>, String) {
    let raw = match request_provider_image_generation(app_state, task, None).await {
        Ok(raw) => raw,
        Err(err) => return (Vec::new(), Some(err), String::new()),
    };

    let upstream_mode = raw
        .get("_async_mode")
        .and_then(|value| value.as_str())
        .unwrap_or("direct")
        .to_string();
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

    (outputs, None, upstream_mode)
}
