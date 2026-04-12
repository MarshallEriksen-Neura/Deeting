use handlebars::Handlebars;
use serde_json::{json, Map, Value};
use uuid::Uuid;

use crate::modules::ai_upstream::chat::{extract_upstream_error_message, truncate_upstream_body};
use crate::modules::ai_upstream::gateway_log_recorder::{
    build_gateway_log_meta, extract_billing_amount_from_response,
    extract_cache_details_from_response, extract_error_code_from_response,
    extract_ttft_ms_from_response, extract_usage_details_from_response, record_gateway_log,
    GatewayLogEntry,
};
use crate::modules::image_generation::types::LocalImageGenerationTaskRecord;
use crate::modules::mcp::commands::common_impl::to_string;
use crate::modules::providers::request_runtime::{
    send_prepared_json_request_with_retry, UpstreamRetryPolicy,
};
use crate::state::AppState;

pub(crate) async fn request_provider_image_generation(
    app_state: &AppState,
    task: &LocalImageGenerationTaskRecord,
    trace_id: Option<&str>,
) -> Result<Value, String> {
    let prompt = task.prompt.trim();
    if prompt.is_empty() {
        return Err("prompt is required".to_string());
    }

    let provider_model_uuid =
        Uuid::parse_str(task.provider_model_id.as_str()).map_err(to_string)?;
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

    let effective_model = if task.model.trim().is_empty() {
        model.model_id.clone()
    } else {
        task.model.clone()
    };
    let preset = app_state
        .providers
        .store
        .get_preset(&instance.preset_slug)
        .await
        .map_err(to_string)?;
    let request_data = build_image_request_data(task, effective_model.as_str(), prompt);
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
    let upstream_request_meta = serde_json::json!({
        "method": prepared.method,
        "url": prepared.display_url(),
    });
    let client = crate::modules::desktop_config::network::build_proxy_aware_reqwest_client(
        app_state.mcp.store.as_ref(),
    )
    .await?;
    let call_start = std::time::Instant::now();
    let (response, retry_count) =
        send_prepared_json_request_with_retry(&client, &prepared, UpstreamRetryPolicy::default())
            .await?;
    let status = response.status;
    let response_headers = response.headers.clone();
    let latency_ms = call_start.elapsed().as_millis() as f64;
    let raw_text = response.text;
    let raw_json = response.json;
    let success = status.is_success();
    let feedback = crate::modules::providers::types::BanditFeedbackRequest {
        scene: None,
        arm_id: task.provider_model_id.clone(),
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
        let raw_usage = raw_json
            .as_ref()
            .map(extract_usage_details_from_response)
            .unwrap_or_default();
        let cache_details = extract_cache_details_from_response(
            &response_headers,
            raw_json.as_ref(),
            Some(&raw_usage),
        );
        record_gateway_log(
            app_state.mcp.store.clone(),
            GatewayLogEntry {
                trace_id: trace_id.map(str::to_string),
                api_key_id: Some(instance.credentials_ref.clone())
                    .filter(|value| !value.trim().is_empty()),
                preset_id: Some(instance.preset_slug.clone())
                    .filter(|value| !value.trim().is_empty()),
                model: effective_model.clone(),
                status_code: status.as_u16() as i64,
                duration_ms: latency_ms as i64,
                retry_count,
                upstream_url: Some(prepared.display_url()),
                input_tokens: raw_usage.input_tokens,
                output_tokens: raw_usage.output_tokens,
                total_tokens: raw_usage.total_tokens,
                is_cached: cache_details.is_cached,
                error_code: extract_error_code_from_response(raw_json.as_ref()),
                meta: build_gateway_log_meta(
                    &raw_usage,
                    raw_usage.has_usage_details().then_some("provider_reported"),
                    &cache_details,
                    Some(&prepared.body),
                    Some(&upstream_request_meta),
                ),
                ..Default::default()
            },
        );
        return Err(extract_upstream_error_message(
            status,
            raw_json.as_ref(),
            raw_text.as_str(),
        ));
    }
    let submit_payload = raw_json.ok_or_else(|| {
        format!(
            "failed to parse upstream image generation response (status={}): {}",
            status.as_u16(),
            truncate_upstream_body(raw_text.as_str(), 300)
        )
    })?;
    let usage_details = extract_usage_details_from_response(&submit_payload);
    let cache_details = extract_cache_details_from_response(
        &response_headers,
        Some(&submit_payload),
        Some(&usage_details),
    );

    record_gateway_log(
        app_state.mcp.store.clone(),
        GatewayLogEntry {
            trace_id: trace_id.map(str::to_string),
            api_key_id: Some(instance.credentials_ref.clone())
                .filter(|value| !value.trim().is_empty()),
            preset_id: Some(instance.preset_slug.clone()).filter(|value| !value.trim().is_empty()),
            model: effective_model.clone(),
            status_code: status.as_u16() as i64,
            duration_ms: latency_ms as i64,
            ttft_ms: extract_ttft_ms_from_response(&submit_payload),
            retry_count,
            upstream_url: Some(prepared.display_url()),
            input_tokens: usage_details.input_tokens,
            output_tokens: usage_details.output_tokens,
            total_tokens: usage_details.total_tokens,
            cost_user: extract_billing_amount_from_response(&submit_payload).unwrap_or(0.0),
            is_cached: cache_details.is_cached,
            meta: build_gateway_log_meta(
                &usage_details,
                usage_details
                    .has_usage_details()
                    .then_some("provider_reported"),
                &cache_details,
                Some(&prepared.body),
                Some(&upstream_request_meta),
            ),
            ..Default::default()
        },
    );

    if prepared
        .async_config
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        let mut final_payload = poll_async_image_result(
            app_state,
            submit_payload,
            &prepared.url,
            &prepared.headers,
            &prepared.async_config,
        )
        .await?;
        if let Some(object) = final_payload.as_object_mut() {
            object.insert(
                "_async_mode".to_string(),
                Value::String("async".to_string()),
            );
        }
        return Ok(final_payload);
    }

    let mut payload = submit_payload;
    if let Some(object) = payload.as_object_mut() {
        object.insert(
            "_async_mode".to_string(),
            Value::String("direct".to_string()),
        );
    }
    Ok(payload)
}

fn build_image_request_data(
    task: &LocalImageGenerationTaskRecord,
    effective_model: &str,
    prompt: &str,
) -> Value {
    let mut request_data = Map::new();
    request_data.insert(
        "model".to_string(),
        Value::String(effective_model.to_string()),
    );
    request_data.insert("prompt".to_string(), Value::String(prompt.to_string()));
    request_data.insert(
        "n".to_string(),
        Value::from(task.num_outputs.unwrap_or(1).max(1)),
    );
    if let Some(value) = task
        .negative_prompt
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        request_data.insert(
            "negative_prompt".to_string(),
            Value::String(value.trim().to_string()),
        );
    }
    if let Some(value) = task.width {
        request_data.insert("width".to_string(), Value::from(value));
    }
    if let Some(value) = task.height {
        request_data.insert("height".to_string(), Value::from(value));
    }
    if let Some(value) = task
        .aspect_ratio
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        request_data.insert(
            "aspect_ratio".to_string(),
            Value::String(value.trim().to_string()),
        );
    }
    if let Some(value) = task.num_outputs {
        request_data.insert("num_outputs".to_string(), Value::from(value.max(1)));
    }
    if let Some(value) = task.steps {
        request_data.insert("steps".to_string(), Value::from(value));
    }
    if let Some(value) = task.cfg_scale {
        request_data.insert("cfg_scale".to_string(), json!(value));
    }
    if let Some(value) = task.seed {
        request_data.insert("seed".to_string(), Value::from(value));
    }
    if let Some(value) = task
        .sampler_name
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        request_data.insert(
            "sampler_name".to_string(),
            Value::String(value.trim().to_string()),
        );
    }
    if let Some(value) = task
        .quality
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        request_data.insert(
            "quality".to_string(),
            Value::String(value.trim().to_string()),
        );
    }
    if let Some(value) = task
        .style
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        request_data.insert("style".to_string(), Value::String(value.trim().to_string()));
    }
    if let Some(value) = task
        .response_format
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        request_data.insert(
            "response_format".to_string(),
            Value::String(value.trim().to_string()),
        );
    }
    if let Some(value) = task
        .image_url
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        request_data.insert(
            "image_url".to_string(),
            Value::String(value.trim().to_string()),
        );
    }
    if !task.image_urls.is_empty() {
        request_data.insert(
            "input_images".to_string(),
            Value::Array(
                task.image_urls
                    .iter()
                    .filter_map(|value| {
                        let trimmed = value.trim();
                        (!trimmed.is_empty()).then(|| Value::String(trimmed.to_string()))
                    })
                    .collect(),
            ),
        );
    }
    if let Some(extra_params) = task.extra_params.as_ref() {
        if !extra_params.is_null() {
            request_data.insert("extra_params".to_string(), extra_params.clone());
        }
    }
    Value::Object(request_data)
}

async fn poll_async_image_result(
    app_state: &AppState,
    submit_payload: Value,
    submit_url: &str,
    base_headers: &std::collections::BTreeMap<String, String>,
    async_config: &Value,
) -> Result<Value, String> {
    let extraction = async_config
        .get("task_id_extraction")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let task_id_path = extraction
        .get("key_path")
        .or_else(|| extraction.get("path"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    let task_id = extract_by_path(&submit_payload, task_id_path.as_str())
        .and_then(value_to_string)
        .ok_or_else(|| "async task_id extraction failed".to_string())?;

    let poll = async_config
        .get("poll")
        .and_then(Value::as_object)
        .cloned()
        .ok_or_else(|| "async poll config missing".to_string())?;
    let url_template = poll
        .get("url_template")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "async poll.url_template missing".to_string())?;
    let base_url = submit_url
        .split('?')
        .next()
        .unwrap_or(submit_url)
        .rsplit_once('/')
        .map(|(value, _)| format!("{}/", value))
        .unwrap_or_else(|| submit_url.to_string());
    let render_context = json!({
        "task_id": task_id,
        "base_url": base_url,
    });
    let poll_url = render_string_template(url_template, &render_context)?;

    let mut poll_headers = serde_json::Map::new();
    for (key, value) in base_headers {
        poll_headers.insert(key.clone(), Value::String(value.clone()));
    }
    if let Some(extra_headers) = poll.get("headers").and_then(Value::as_object) {
        for (key, value) in extra_headers {
            poll_headers.insert(key.clone(), value.clone());
        }
    }
    let poll_headers = render_value_recursive(&Value::Object(poll_headers), &render_context);
    let status_check = poll
        .get("status_check")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let status_path = status_check
        .get("location")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("");
    let success_values = to_string_set(status_check.get("success_values"));
    let fail_values = to_string_set(status_check.get("fail_values"));
    let pending_values = to_string_set(status_check.get("pending_values"));
    let interval_secs = poll.get("interval").and_then(Value::as_u64).unwrap_or(5);
    let timeout_secs = poll.get("timeout").and_then(Value::as_u64).unwrap_or(300);
    let method = poll
        .get("method")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("GET");

    let started = std::time::Instant::now();
    loop {
        let mut request = app_state.mcp.transport.client.request(
            reqwest::Method::from_bytes(method.as_bytes()).unwrap_or(reqwest::Method::GET),
            poll_url.as_str(),
        );
        if let Some(object) = poll_headers.as_object() {
            for (key, value) in object {
                if let Some(text) = value.as_str() {
                    request = request.header(key, text);
                }
            }
        }
        let response = request.send().await.map_err(|e| e.to_string())?;
        if !response.status().is_success() {
            return Err(format!(
                "async image poll failed status={}",
                response.status()
            ));
        }
        let text = response.text().await.map_err(|e| e.to_string())?;
        let payload =
            serde_json::from_str::<Value>(&text).unwrap_or_else(|_| Value::String(text.clone()));
        let status_value = extract_by_path(&payload, status_path)
            .and_then(value_to_string)
            .unwrap_or_default();

        if !success_values.is_empty() && success_values.contains(status_value.as_str()) {
            return extract_async_result(&payload, async_config);
        }
        if !fail_values.is_empty() && fail_values.contains(status_value.as_str()) {
            return Err(format!("async image task failed status={}", status_value));
        }
        if started.elapsed().as_secs() >= timeout_secs {
            return Err("async image task timeout".to_string());
        }
        if !pending_values.is_empty() && !pending_values.contains(status_value.as_str()) {
            log::warn!(
                "async image task unexpected pending status={}",
                status_value
            );
        }
        tokio::time::sleep(std::time::Duration::from_secs(interval_secs.max(1))).await;
    }
}

fn extract_async_result(payload: &Value, async_config: &Value) -> Result<Value, String> {
    let extraction = async_config
        .get("result_extraction")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    if extraction.is_empty() {
        return Ok(payload.clone());
    }
    let key_path = extraction
        .get("key_path")
        .or_else(|| extraction.get("path"))
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("");
    let extracted = if key_path.is_empty() {
        payload.clone()
    } else {
        extract_by_path(payload, key_path)
            .cloned()
            .unwrap_or_else(|| Value::Null)
    };
    let result_format = extraction
        .get("result_format")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("");
    match result_format {
        "url_list" => {
            let urls = extracted.as_array().cloned().unwrap_or_default();
            Ok(json!({
                "data": urls
                    .into_iter()
                    .filter_map(|item| item.as_str().map(|value| json!({"url": value})))
                    .collect::<Vec<_>>()
            }))
        }
        "b64_list" => {
            let items = extracted.as_array().cloned().unwrap_or_default();
            Ok(json!({
                "data": items
                    .into_iter()
                    .filter_map(|item| item.as_str().map(|value| json!({"b64_json": value})))
                    .collect::<Vec<_>>()
            }))
        }
        _ => Ok(extracted),
    }
}

fn render_string_template(template: &str, context: &Value) -> Result<String, String> {
    if !template.contains("{{") {
        return Ok(template.to_string());
    }
    let mut hb = Handlebars::new();
    hb.set_strict_mode(false);
    hb.render_template(template, context).map_err(to_string)
}

fn render_value_recursive(value: &Value, context: &Value) -> Value {
    match value {
        Value::String(text) => render_string_template(text, context)
            .map(Value::String)
            .unwrap_or_else(|_| Value::String(text.clone())),
        Value::Array(items) => Value::Array(
            items
                .iter()
                .map(|item| render_value_recursive(item, context))
                .collect(),
        ),
        Value::Object(map) => Value::Object(
            map.iter()
                .map(|(key, value)| (key.clone(), render_value_recursive(value, context)))
                .collect::<Map<String, Value>>(),
        ),
        _ => value.clone(),
    }
}

fn extract_by_path<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    if path.trim().is_empty() {
        return Some(value);
    }
    let mut current = value;
    for part in path.split('.') {
        match current {
            Value::Array(items) => {
                let index = part.parse::<usize>().ok()?;
                current = items.get(index)?;
            }
            Value::Object(map) => {
                current = map.get(part)?;
            }
            _ => return None,
        }
    }
    Some(current)
}

fn value_to_string(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
        .or_else(|| value.as_i64().map(|number| number.to_string()))
        .or_else(|| value.as_u64().map(|number| number.to_string()))
}

fn to_string_set(value: Option<&Value>) -> std::collections::HashSet<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(value_to_string)
                .collect::<std::collections::HashSet<_>>()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::build_image_request_data;
    use crate::modules::image_generation::types::LocalImageGenerationTaskRecord;
    use serde_json::json;

    #[test]
    fn build_image_request_data_includes_structured_image_fields() {
        let task = LocalImageGenerationTaskRecord {
            task_id: "task-1".to_string(),
            session_id: None,
            request_id: None,
            model: "Qwen-Image".to_string(),
            provider_model_id: "provider-1".to_string(),
            prompt: "draw a cat".to_string(),
            prompt_encrypted: false,
            image_urls: vec![
                "https://example.com/reference.png".to_string(),
                "https://example.com/reference-2.png".to_string(),
            ],
            negative_prompt: Some("blurry".to_string()),
            width: Some(1024),
            height: Some(768),
            aspect_ratio: Some("4:3".to_string()),
            num_outputs: Some(2),
            steps: Some(30),
            cfg_scale: Some(7.5),
            seed: Some(42),
            sampler_name: Some("euler".to_string()),
            quality: Some("high".to_string()),
            style: Some("photorealistic".to_string()),
            response_format: Some("url".to_string()),
            image_url: Some("https://example.com/reference.png".to_string()),
            extra_params: Some(json!({ "prompt_optimizer": true })),
            status: "queued".to_string(),
        };

        let payload = build_image_request_data(&task, "Qwen-Image", "draw a cat");

        assert_eq!(payload["model"], json!("Qwen-Image"));
        assert_eq!(payload["prompt"], json!("draw a cat"));
        assert_eq!(payload["n"], json!(2));
        assert_eq!(payload["negative_prompt"], json!("blurry"));
        assert_eq!(payload["width"], json!(1024));
        assert_eq!(payload["height"], json!(768));
        assert_eq!(payload["aspect_ratio"], json!("4:3"));
        assert_eq!(payload["steps"], json!(30));
        assert_eq!(payload["cfg_scale"], json!(7.5));
        assert_eq!(
            payload["image_url"],
            json!("https://example.com/reference.png")
        );
        assert_eq!(
            payload["input_images"],
            json!([
                "https://example.com/reference.png",
                "https://example.com/reference-2.png"
            ])
        );
        assert_eq!(payload["extra_params"], json!({ "prompt_optimizer": true }));
    }
}
