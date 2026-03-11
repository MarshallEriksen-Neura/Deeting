use serde_json::Value;
use uuid::Uuid;

use crate::modules::ai_upstream::chat::{extract_upstream_error_message, truncate_upstream_body};
use crate::modules::mcp::commands::common_impl::to_string;
use crate::state::AppState;

pub(crate) async fn request_provider_image_generation(
    app_state: &AppState,
    provider_model_id: &str,
    model_id: &str,
    prompt: &str,
    trace_id: Option<&str>,
) -> Result<Value, String> {
    let prompt = prompt.trim();
    if prompt.is_empty() {
        return Err("prompt is required".to_string());
    }

    let provider_model_uuid = Uuid::parse_str(provider_model_id).map_err(to_string)?;
    let model = app_state
        .providers
        .store
        .get_model(&provider_model_uuid)
        .await
        .map_err(to_string)?
        .ok_or_else(|| "provider model not found".to_string())?;
    let instance = app_state
        .providers
        .store
        .get_instance(&model.instance_id.to_string())
        .await
        .map_err(to_string)?
        .ok_or_else(|| "provider instance not found".to_string())?;
    let connection = app_state
        .providers
        .store
        .get_instance_connection(&model.instance_id.to_string())
        .await
        .map_err(to_string)?
        .ok_or_else(|| "provider instance connection not found".to_string())?;
    if connection
        .credential_source
        .as_deref()
        .map(|value| value.eq_ignore_ascii_case("platform"))
        .unwrap_or(false)
    {
        return Err(
            "platform image-generation models are not yet supported by custom task agents"
                .to_string(),
        );
    }

    let effective_model = if model_id.trim().is_empty() {
        model.model_id.clone()
    } else {
        model_id.to_string()
    };
    let preset = app_state
        .providers
        .store
        .get_preset(&instance.preset_slug)
        .await
        .map_err(to_string)?;
    let request_data = serde_json::json!({
        "model": effective_model,
        "prompt": prompt,
        "n": 1
    });
    let prepared = crate::modules::providers::request_runtime::prepare_provider_request(
        preset.as_ref(),
        &instance,
        &model,
        connection.secret_key.as_deref(),
        "image_generation",
        request_data,
        None,
        trace_id,
    )?;
    let call_start = std::time::Instant::now();
    let response = crate::modules::providers::request_runtime::send_prepared_json_request(
        &reqwest::Client::new(),
        &prepared,
    )
    .await?;
    let status = response.status;
    let latency_ms = call_start.elapsed().as_millis() as f64;
    let raw_text = response.text;
    let raw_json = response.json;
    let success = status.is_success();
    let feedback = crate::modules::providers::types::BanditFeedbackRequest {
        scene: None,
        arm_id: provider_model_id.to_string(),
        success,
        latency_ms: Some(latency_ms),
        cost: None,
        reward: Some(if success { 1.0 } else { 0.0 }),
        routing_config: None,
        reward_metric_type: None,
    };
    if let Err(err) = app_state
        .providers
        .store
        .record_bandit_feedback(feedback)
        .await
    {
        log::warn!("failed to record bandit feedback: {}", err);
    }
    if !success {
        return Err(extract_upstream_error_message(
            status,
            raw_json.as_ref(),
            raw_text.as_str(),
        ));
    }
    raw_json.ok_or_else(|| {
        format!(
            "failed to parse upstream image generation response (status={}): {}",
            status.as_u16(),
            truncate_upstream_body(raw_text.as_str(), 300)
        )
    })
}
