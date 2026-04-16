use super::resolve_render_runtime_cache_dir;
use super::resolve_render_runtime_manual_dir;
use super::schema::schema_fingerprint;
use super::store::init_render_runtime_tables;
use super::types::{
    AssistantRenderEnvelope, RenderCacheEntry, RenderRequest, RenderTemplateManifest,
};
use crate::modules::mcp::store::McpStore;
use handlebars::Handlebars;
use serde_json::{json, Value};
use sha2::Digest;
use tauri::Manager;
use time::OffsetDateTime;

#[derive(Debug, Clone, Default)]
pub(crate) struct ResponseRenderResolution {
    pub summary_text: Option<String>,
    pub blocks: Vec<Value>,
    pub consumed_content: bool,
}

pub(crate) async fn resolve_response_rendering<R: tauri::Runtime>(
    app_handle: &tauri::AppHandle<R>,
    store: &McpStore,
    response_json: &Value,
) -> ResponseRenderResolution {
    let Some((envelope, consumed_content)) = resolve_assistant_render_envelope(response_json)
    else {
        return ResponseRenderResolution::default();
    };
    let Some(mut render) = envelope.render else {
        return ResponseRenderResolution::default();
    };

    let summary_text = envelope
        .summary
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let app_data_dir = app_handle.path().app_data_dir().ok();
    let manual_dir = resolve_render_runtime_manual_dir(app_data_dir.clone());
    let cache_dir = resolve_render_runtime_cache_dir(app_data_dir.clone());

    let _ = init_render_runtime_tables(store).await;
    let asset_id = render
        .asset_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let saved_asset = match asset_id.as_deref() {
        Some(value) => store.get_local_asset_record(value).await.ok().flatten(),
        None => None,
    };
    if render.hint.trim().is_empty() {
        render.hint = saved_asset
            .as_ref()
            .and_then(|record| record.render_hint.clone())
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| {
                saved_asset
                    .as_ref()
                    .map(|record| record.title.clone())
                    .unwrap_or_default()
            });
    }
    if render.hint.trim().is_empty() {
        return ResponseRenderResolution::default();
    }

    let schema = schema_fingerprint(&render.data);
    let runtime_mode = render
        .preferred_runtime
        .clone()
        .unwrap_or_else(|| "html_static".to_string());
    let normalized_runtime_mode = normalize_runtime_mode(Some(runtime_mode.as_str()));
    let cache_key_basis = asset_id
        .as_deref()
        .map(|value| format!("asset:{value}"))
        .unwrap_or_else(|| render.hint.trim().to_string());
    let cache_key = build_render_cache_key(&cache_key_basis, &schema, normalized_runtime_mode);
    let template_resolution = resolve_template_source(
        &manual_dir,
        &cache_dir,
        store,
        &render,
        &cache_key,
        &schema,
        normalized_runtime_mode,
    )
    .await;
    let snapshot_created_at = current_time_rfc3339();
    let height = clamp_iframe_height(
        template_resolution
            .manifest
            .preferred_height
            .or(render.preferred_height),
    );
    let snapshot_html = resolve_snapshot_html(
        &template_resolution,
        summary_text.as_deref(),
        &render,
        &schema,
    );
    let block_id = format!("render-{}", &cache_key[..cache_key.len().min(16)]);

    let block = json!({
        "id": block_id,
        "type": "ui",
        "viewType": "html.v1",
        "displayMode": "widget",
        "title": template_resolution
            .manifest
            .title
            .clone()
            .unwrap_or_else(|| render.hint.trim().to_string()),
        "payload": {
            "snapshot_html": snapshot_html,
            "summary": summary_text,
            "asset_id": asset_id,
            "render_hint": render.hint.trim(),
            "render_data": render.data,
            "initial_data": render.data,
        },
        "metadata": {
            "renderer_origin": "assistant_render",
            "asset_id": saved_asset.as_ref().map(|record| record.asset_id.clone()),
            "data_mode": saved_asset.as_ref().and_then(|record| record.data_mode.clone()),
            "html_entry": saved_asset.as_ref().and_then(|record| record.html_entry.clone()),
            "render_hint": render.hint.trim(),
            "schema_fingerprint": schema,
            "cache_key": cache_key,
            "runtime_mode": normalized_runtime_mode,
            "template_id": template_resolution.template_id,
            "template_source": template_resolution.source,
            "template_version": template_resolution
                .manifest
                .template_version
                .clone()
                .unwrap_or_else(|| "v1".to_string()),
            "snapshot_mode": "frozen",
            "snapshot_created_at": snapshot_created_at,
            "iframe_height": height,
        }
    });

    ResponseRenderResolution {
        summary_text,
        blocks: vec![block],
        consumed_content,
    }
}

fn resolve_assistant_render_envelope(
    response_json: &Value,
) -> Option<(AssistantRenderEnvelope, bool)> {
    if let Some(envelope) = assistant_render_envelope_from_value(response_json) {
        return Some((envelope, false));
    }

    response_json
        .get("content")
        .and_then(assistant_render_envelope_from_content_value)
        .map(|envelope| (envelope, true))
}

fn assistant_render_envelope_from_content_value(
    content: &Value,
) -> Option<AssistantRenderEnvelope> {
    match content {
        Value::String(text) => assistant_render_envelope_from_text(text),
        Value::Array(items) => items
            .iter()
            .find_map(assistant_render_envelope_from_content_item),
        Value::Object(object) => assistant_render_envelope_from_content_object(object),
        _ => None,
    }
}

fn assistant_render_envelope_from_content_item(item: &Value) -> Option<AssistantRenderEnvelope> {
    let object = item.as_object()?;
    assistant_render_envelope_from_content_object(object)
}

fn assistant_render_envelope_from_content_object(
    object: &serde_json::Map<String, Value>,
) -> Option<AssistantRenderEnvelope> {
    assistant_render_envelope_from_value(&Value::Object(object.clone())).or_else(|| {
        object
            .get("text")
            .and_then(Value::as_str)
            .or_else(|| object.get("content").and_then(Value::as_str))
            .or_else(|| object.get("output_text").and_then(Value::as_str))
            .and_then(assistant_render_envelope_from_text)
    })
}

fn assistant_render_envelope_from_value(value: &Value) -> Option<AssistantRenderEnvelope> {
    let envelope = serde_json::from_value::<AssistantRenderEnvelope>(value.clone()).ok()?;
    envelope.render.as_ref()?;
    Some(envelope)
}

fn assistant_render_envelope_from_text(raw: &str) -> Option<AssistantRenderEnvelope> {
    let cleaned = strip_markdown_code_fence(raw.trim());
    assistant_render_envelope_from_json_str(cleaned).or_else(|| {
        extract_json_object_substring(cleaned).and_then(assistant_render_envelope_from_json_str)
    })
}

fn assistant_render_envelope_from_json_str(raw: &str) -> Option<AssistantRenderEnvelope> {
    let parsed = serde_json::from_str::<Value>(raw).ok()?;
    assistant_render_envelope_from_value(&parsed)
}

fn strip_markdown_code_fence(raw: &str) -> &str {
    if !raw.starts_with("```") {
        return raw;
    }

    raw.trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim()
}

fn extract_json_object_substring(raw: &str) -> Option<&str> {
    let start = raw.find('{')?;
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;

    for (index, ch) in raw[start..].char_indices() {
        if in_string {
            if escaped {
                escaped = false;
                continue;
            }
            match ch {
                '\\' => escaped = true,
                '"' => in_string = false,
                _ => {}
            }
            continue;
        }

        match ch {
            '"' => in_string = true,
            '{' => depth = depth.saturating_add(1),
            '}' => {
                if depth == 0 {
                    return None;
                }
                depth -= 1;
                if depth == 0 {
                    let end = start + index + ch.len_utf8();
                    return Some(&raw[start..end]);
                }
            }
            _ => {}
        }
    }

    None
}

fn normalize_runtime_mode(value: Option<&str>) -> &'static str {
    match value.map(str::trim).filter(|value| !value.is_empty()) {
        Some("html_interactive") => "html_interactive",
        Some("trusted_local_bundle") => "trusted_local_bundle",
        _ => "html_static",
    }
}

fn clamp_iframe_height(value: Option<u32>) -> u32 {
    value.unwrap_or(520).clamp(360, 960)
}

struct TemplateResolution {
    template_id: String,
    source: String,
    manifest: RenderTemplateManifest,
    template_html: String,
}

fn resolve_snapshot_html(
    template_resolution: &TemplateResolution,
    summary_text: Option<&str>,
    render: &RenderRequest,
    schema_fingerprint: &str,
) -> String {
    render_template_snapshot(
        &template_resolution.template_html,
        summary_text,
        render,
        schema_fingerprint,
    )
}

fn build_render_cache_key(hint: &str, schema_fingerprint: &str, runtime_mode: &str) -> String {
    let normalized_hint = hint.trim().to_ascii_lowercase();
    let digest = sha2::Sha256::digest(
        format!("{normalized_hint}|{schema_fingerprint}|{runtime_mode}|v1").as_bytes(),
    );
    hex::encode(digest)
}

async fn resolve_template_source(
    manual_dir: &std::path::Path,
    cache_dir: &std::path::Path,
    store: &McpStore,
    render: &RenderRequest,
    cache_key: &str,
    schema_fingerprint: &str,
    runtime_mode: &str,
) -> TemplateResolution {
    if let Some(manual) = load_manual_template(manual_dir, render.hint.trim()) {
        return manual;
    }

    if let Ok(Some(entry)) = store.get_render_cache_entry(cache_key).await {
        let artifact_path = std::path::PathBuf::from(&entry.artifact_path);
        if let Some(cached) = load_cached_template(&artifact_path, &entry) {
            return cached;
        }
    }

    let template_id = format!("gen://{}", &cache_key[..cache_key.len().min(16)]);
    let artifact_dir = cache_dir.join(cache_key);
    let template_path = artifact_dir.join("template.html");
    let manifest_path = artifact_dir.join("manifest.json");
    let manifest = RenderTemplateManifest {
        id: Some(template_id.clone()),
        title: Some(render.hint.trim().to_string()),
        render_hint: Some(render.hint.trim().to_string()),
        runtime_mode: Some(runtime_mode.to_string()),
        preferred_height: render.preferred_height,
        template_version: Some("v1".to_string()),
        allow_live_updates: Some(false),
        refresh_interval_ms: render.refresh_interval_ms,
    };
    let template_html = default_template_source();

    if std::fs::create_dir_all(&artifact_dir).is_ok()
        && std::fs::write(&template_path, template_html.as_bytes()).is_ok()
    {
        let _ = std::fs::write(
            &manifest_path,
            serde_json::to_string_pretty(&manifest).unwrap_or_else(|_| "{}".to_string()),
        );
        let now = OffsetDateTime::now_utc()
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string());
        let entry = RenderCacheEntry {
            cache_key: cache_key.to_string(),
            template_id: template_id.clone(),
            render_hint: render.hint.trim().to_string(),
            schema_fingerprint: schema_fingerprint.to_string(),
            runtime_mode: runtime_mode.to_string(),
            artifact_path: template_path.to_string_lossy().to_string(),
            source: "generated_cache".to_string(),
            created_at: now.clone(),
            updated_at: now,
        };
        let _ = store.upsert_render_cache_entry(&entry).await;
    }

    TemplateResolution {
        template_id,
        source: "generated_default".to_string(),
        manifest,
        template_html,
    }
}

fn load_manual_template(manual_dir: &std::path::Path, hint: &str) -> Option<TemplateResolution> {
    let slug = sanitize_hint_slug(hint);
    if slug.is_empty() {
        return None;
    }
    let root = manual_dir.join(&slug);
    let template_path = root.join("template.html");
    let template_html = std::fs::read_to_string(&template_path).ok()?;
    let manifest = read_manifest(root.join("manifest.json")).unwrap_or_default();
    Some(TemplateResolution {
        template_id: manifest
            .id
            .clone()
            .unwrap_or_else(|| format!("manual://{slug}")),
        source: "manual".to_string(),
        manifest,
        template_html,
    })
}

fn load_cached_template(
    template_path: &std::path::Path,
    entry: &RenderCacheEntry,
) -> Option<TemplateResolution> {
    let template_html = std::fs::read_to_string(template_path).ok()?;
    let manifest = read_manifest(
        template_path
            .parent()
            .unwrap_or(template_path)
            .join("manifest.json"),
    )
    .unwrap_or_else(|| RenderTemplateManifest {
        id: Some(entry.template_id.clone()),
        title: Some(entry.render_hint.clone()),
        render_hint: Some(entry.render_hint.clone()),
        runtime_mode: Some(entry.runtime_mode.clone()),
        preferred_height: None,
        template_version: Some("v1".to_string()),
        allow_live_updates: Some(false),
        refresh_interval_ms: None,
    });
    Some(TemplateResolution {
        template_id: entry.template_id.clone(),
        source: entry.source.clone(),
        manifest,
        template_html,
    })
}

fn read_manifest(path: std::path::PathBuf) -> Option<RenderTemplateManifest> {
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str::<RenderTemplateManifest>(&raw).ok()
}

fn render_template_snapshot(
    template_source: &str,
    summary_text: Option<&str>,
    render: &RenderRequest,
    schema_fingerprint: &str,
) -> String {
    let summary = summary_text
        .unwrap_or("Rendered widget snapshot")
        .to_string();
    let pretty_data =
        serde_json::to_string_pretty(&render.data).unwrap_or_else(|_| "{}".to_string());
    let mut handlebars = Handlebars::new();
    if handlebars
        .register_template_string("renderer", template_source)
        .is_err()
    {
        return build_default_snapshot_html(&summary, render, schema_fingerprint, &pretty_data);
    }
    let context = json!({
        "render": {
            "hint": render.hint.clone(),
            "summary": summary,
            "schema_fingerprint": schema_fingerprint,
            "schema_fingerprint_short": &schema_fingerprint[..schema_fingerprint.len().min(12)],
            "pretty_data": pretty_data,
            "data": render.data.clone(),
        }
    });
    handlebars.render("renderer", &context).unwrap_or_else(|_| {
        build_default_snapshot_html(
            context["render"]["summary"]
                .as_str()
                .unwrap_or("Rendered widget snapshot"),
            render,
            schema_fingerprint,
            context["render"]["pretty_data"].as_str().unwrap_or("{}"),
        )
    })
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn sanitize_hint_slug(value: &str) -> String {
    value
        .trim()
        .chars()
        .map(|char| match char {
            char if char.is_ascii_alphanumeric() => char.to_ascii_lowercase(),
            char if char.is_alphanumeric() => char,
            _ => '-',
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

fn default_template_source() -> String {
    r#"<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root {
        color-scheme: light dark;
        font-family: "Segoe UI", "PingFang SC", sans-serif;
      }
      body {
        margin: 0;
        padding: 16px;
        background: linear-gradient(135deg, #f6f8fb, #eef2ff);
        color: #111827;
      }
      .card {
        border-radius: 16px;
        border: 1px solid rgba(148, 163, 184, 0.22);
        background: rgba(255, 255, 255, 0.92);
        box-shadow: 0 14px 34px rgba(15, 23, 42, 0.08);
        padding: 16px;
      }
      .eyebrow {
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #64748b;
        margin-bottom: 8px;
      }
      h1 {
        font-size: 18px;
        line-height: 1.25;
        margin: 0 0 8px;
      }
      p {
        margin: 0 0 12px;
        color: #334155;
      }
      pre {
        margin: 0;
        padding: 12px;
        border-radius: 12px;
        background: #0f172a;
        color: #e2e8f0;
        overflow: auto;
        font-size: 12px;
        line-height: 1.5;
      }
    </style>
  </head>
  <body>
    <section class="card">
      <div class="eyebrow">{{render.hint}}</div>
      <h1>{{render.summary}}</h1>
      <p>schema {{render.schema_fingerprint_short}}</p>
      <pre>{{render.pretty_data}}</pre>
    </section>
  </body>
</html>"#
        .to_string()
}

fn current_time_rfc3339() -> String {
    OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

fn build_default_snapshot_html(
    summary: &str,
    render: &RenderRequest,
    schema_fingerprint: &str,
    pretty_data: &str,
) -> String {
    default_template_source()
        .replace("{{render.hint}}", &escape_html(render.hint.trim()))
        .replace("{{render.summary}}", &escape_html(summary))
        .replace(
            "{{render.schema_fingerprint_short}}",
            &escape_html(&schema_fingerprint[..schema_fingerprint.len().min(12)]),
        )
        .replace("{{render.pretty_data}}", &escape_html(pretty_data))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn manual_template_slug_normalization_is_stable() {
        assert_eq!(
            sanitize_hint_slug("Weather Card Compact"),
            "weather-card-compact"
        );
        assert_eq!(
            sanitize_hint_slug("Stock Dashboard Compact"),
            "stock-dashboard-compact"
        );
    }

    #[test]
    fn render_template_snapshot_renders_handlebars_template() {
        let html = render_template_snapshot(
            "<h1>{{render.summary}}</h1><div>{{render.data.location}}</div>",
            Some("Cloudy"),
            &RenderRequest {
                hint: "weather-card".to_string(),
                asset_id: None,
                data: json!({"location": "Beijing"}),
                preferred_runtime: None,
                preferred_height: None,
                live_channel_id: None,
                refresh_interval_ms: None,
                expires_at_ms: None,
                refresh_spec: None,
            },
            "abcd1234",
        );

        assert!(html.contains("Cloudy"));
        assert!(html.contains("Beijing"));
    }

    #[test]
    fn load_manual_template_reads_template_and_manifest() {
        let temp_dir =
            std::env::temp_dir().join(format!("render-runtime-test-{}", uuid::Uuid::new_v4()));
        let manual_dir = temp_dir.join("manual");
        let template_dir = manual_dir.join("weather-card-compact");
        std::fs::create_dir_all(&template_dir).expect("create template dir");
        std::fs::write(
            template_dir.join("template.html"),
            "<article>{{render.summary}}</article>",
        )
        .expect("write template");
        std::fs::write(
            template_dir.join("manifest.json"),
            serde_json::to_string(&RenderTemplateManifest {
                id: Some("manual://weather-card-compact".to_string()),
                title: Some("Weather Card".to_string()),
                render_hint: Some("weather-card-compact".to_string()),
                runtime_mode: Some("html_static".to_string()),
                preferred_height: Some(240),
                template_version: Some("v1".to_string()),
                allow_live_updates: Some(false),
                refresh_interval_ms: None,
            })
            .expect("serialize manifest"),
        )
        .expect("write manifest");

        let resolved =
            load_manual_template(&manual_dir, "Weather Card Compact").expect("manual template");

        assert_eq!(resolved.template_id, "manual://weather-card-compact");
        assert_eq!(resolved.manifest.title.as_deref(), Some("Weather Card"));

        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn resolve_snapshot_html_no_longer_bypasses_asset_registry_templates() {
        let template_resolution = TemplateResolution {
            template_id: "asset://weather-ios18-card".to_string(),
            source: "asset_registry".to_string(),
            manifest: RenderTemplateManifest {
                id: Some("asset://weather-ios18-card".to_string()),
                title: Some("Weather Card".to_string()),
                render_hint: Some("weather-card".to_string()),
                runtime_mode: Some("html_interactive".to_string()),
                preferred_height: Some(320),
                template_version: Some("v1".to_string()),
                allow_live_updates: Some(false),
                refresh_interval_ms: None,
            },
            template_html:
                "<!doctype html><html><body><div>{{render.summary}}</div><div>{{render.data.temp_c}}</div></body></html>"
                    .to_string(),
        };
        let html = resolve_snapshot_html(
            &template_resolution,
            Some("Cloudy"),
            &RenderRequest {
                hint: "weather-card".to_string(),
                asset_id: Some("weather-ios18-card".to_string()),
                data: json!({"temp_c": 22}),
                preferred_runtime: Some("html_static".to_string()),
                preferred_height: None,
                live_channel_id: None,
                refresh_interval_ms: None,
                expires_at_ms: None,
                refresh_spec: None,
            },
            "abcd1234",
        );

        assert!(html.contains("Cloudy"));
        assert!(html.contains("22"));
        assert!(!html.contains("{{render.summary}}"));
    }

    #[test]
    fn clamp_iframe_height_uses_larger_readable_defaults() {
        assert_eq!(clamp_iframe_height(None), 520);
        assert_eq!(clamp_iframe_height(Some(280)), 360);
        assert_eq!(clamp_iframe_height(Some(1200)), 960);
    }

    #[test]
    fn assistant_render_envelope_from_text_extracts_embedded_json_object() {
        let envelope = assistant_render_envelope_from_text(
            "基于获取到的天气信息，我来为您展示天津今天的天气情况：\n\n{\n  \"summary\": \"多云\",\n  \"render\": {\n    \"asset_id\": \"ios18-weather-cards\",\n    \"hint\": \"iOS 18 风格天气卡片\",\n    \"data\": {\n      \"temperature\": \"12.4C\"\n    }\n  }\n}",
        )
        .expect("embedded envelope should parse");

        assert_eq!(envelope.summary.as_deref(), Some("多云"));
        assert_eq!(
            envelope
                .render
                .as_ref()
                .and_then(|render| render.asset_id.as_deref()),
            Some("ios18-weather-cards")
        );
        assert_eq!(
            envelope.render.as_ref().map(|render| render.hint.as_str()),
            Some("iOS 18 风格天气卡片")
        );
    }

    #[test]
    fn assistant_render_envelope_from_content_value_reads_text_blocks() {
        let envelope = assistant_render_envelope_from_content_value(&json!([
            {
                "type": "output_text",
                "text": "{\"summary\":\"Cloudy\",\"render\":{\"hint\":\"weather-card\",\"data\":{\"temp_c\":22}}}"
            }
        ]))
        .expect("content blocks should parse");

        assert_eq!(envelope.summary.as_deref(), Some("Cloudy"));
        assert_eq!(
            envelope.render.as_ref().map(|render| render.hint.as_str()),
            Some("weather-card")
        );
    }
}
