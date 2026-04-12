use super::*;

pub(super) fn finalize_tool_round(
    orchestrated_messages: &mut Vec<LocalChatInputMessage>,
    active_capability: &mut Option<LocalCapabilityActivationState>,
    protocol_family: &str,
    round: usize,
    response: &serde_json::Value,
    tool_call_meta: &[serde_json::Value],
    results: &[String],
) {
    apply_capability_update(
        orchestrated_messages,
        active_capability,
        derive_capability_update_from_tool_call_meta(tool_call_meta),
    );

    if let Some(replay_messages) =
        build_structured_tool_replay_messages(protocol_family, response, tool_call_meta)
    {
        orchestrated_messages.extend(replay_messages);
        return;
    }

    let effective_tool_call_meta = build_effective_tool_call_meta(response, tool_call_meta);
    let tool_feedback = build_tool_loop_feedback(round, &effective_tool_call_meta, results);
    let assistant_content = response
        .get("content")
        .and_then(|v| v.as_str())
        .map(|v| v.trim().to_string())
        .unwrap_or_default();
    if !assistant_content.is_empty() {
        orchestrated_messages.push(LocalChatInputMessage {
            role: "assistant".to_string(),
            content: assistant_content,
            tool_calls: vec![],
            tool_call_id: None,
            name: None,
        });
    }
    orchestrated_messages.push(LocalChatInputMessage {
        role: "user".to_string(),
        content: tool_feedback,
        tool_calls: vec![],
        tool_call_id: None,
        name: None,
    });
}

pub(super) fn build_structured_tool_replay_messages(
    protocol_family: &str,
    response: &serde_json::Value,
    tool_call_meta: &[serde_json::Value],
) -> Option<Vec<LocalChatInputMessage>> {
    if protocol_family != "openai_chat"
        && protocol_family != "openai_responses"
        && protocol_family != "anthropic_messages"
        && protocol_family != "google_gemini"
    {
        return None;
    }

    let tool_calls = extract_chat_tool_calls(response);
    if tool_calls.is_empty() {
        return None;
    }
    let effective_tool_call_meta = build_effective_tool_call_meta(response, tool_call_meta);
    if effective_tool_call_meta.is_empty() {
        return None;
    }

    let mut ordered_tool_meta = Vec::with_capacity(tool_calls.len());
    for tool_call in &tool_calls {
        let Some(call_id) = tool_call
            .id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            log::warn!("structured tool replay skipped because a tool call is missing call_id");
            return None;
        };

        let Some(meta) = effective_tool_call_meta
            .iter()
            .find(|item| tool_call_meta_matches_call_id(item, call_id))
        else {
            log::warn!(
                "structured tool replay skipped because tool output is missing for call_id={}",
                call_id
            );
            return None;
        };

        ordered_tool_meta.push((call_id.to_string(), meta));
    }

    let assistant_content = response
        .get("content")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .trim()
        .to_string();
    let mut messages = Vec::with_capacity(1 + ordered_tool_meta.len());
    messages.push(LocalChatInputMessage {
        role: "assistant".to_string(),
        content: assistant_content,
        tool_calls,
        tool_call_id: None,
        name: None,
    });

    for (call_id, item) in ordered_tool_meta {
        messages.push(LocalChatInputMessage {
            role: "tool".to_string(),
            content: serialize_tool_replay_content(item),
            tool_calls: vec![],
            tool_call_id: Some(call_id),
            name: item
                .get("name")
                .and_then(|value| value.as_str())
                .map(|value| value.to_string()),
        });
    }

    Some(messages)
}

pub(super) fn serialize_tool_replay_content(item: &serde_json::Value) -> String {
    if let Some(result) = item.get("result") {
        if let Some(text) = result.as_str() {
            return text.to_string();
        }
        if let Some(structured) = result
            .get("structuredContent")
            .filter(|value| !value.is_null())
        {
            return serde_json::to_string(structured).unwrap_or_else(|_| "{}".to_string());
        }
        if let Some(extracted) = extract_mcp_result_text_content(result) {
            return extracted;
        }
        return serde_json::to_string(result).unwrap_or_else(|_| "{}".to_string());
    }

    serde_json::to_string(&serde_json::json!({
        "status": item.get("status").cloned().unwrap_or(serde_json::json!("unknown")),
        "error": item.get("error").cloned().unwrap_or(serde_json::json!(null)),
        "error_code": item.get("error_code").cloned().unwrap_or(serde_json::json!(null)),
    }))
    .unwrap_or_else(|_| "{}".to_string())
}

fn extract_mcp_result_text_content(result: &serde_json::Value) -> Option<String> {
    let object = result.as_object()?;
    let content = object.get("content")?.as_array()?;
    let mut parts = Vec::new();

    for item in content {
        let Some(block) = item.as_object() else {
            continue;
        };
        let block_type = block
            .get("type")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .unwrap_or_default();

        match block_type {
            "text" => {
                let text = block
                    .get("text")
                    .or_else(|| block.get("content"))
                    .and_then(|value| value.as_str())
                    .map(str::trim)
                    .filter(|value| !value.is_empty());
                if let Some(text) = text {
                    parts.push(text.to_string());
                }
            }
            "image" => parts.push("[Image Content]".to_string()),
            _ => {}
        }
    }

    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n"))
    }
}

fn apply_capability_update(
    orchestrated_messages: &mut Vec<LocalChatInputMessage>,
    active_capability: &mut Option<LocalCapabilityActivationState>,
    capability_update: Option<LocalCapabilityTransition>,
) {
    if let Some(update) = capability_update {
        match update {
            LocalCapabilityTransition::Activate(next_active) => {
                let capability_name = next_active.capability_name.clone();
                let capability_summary = next_active.capability_summary.clone();
                *active_capability = Some(next_active);
                orchestrated_messages.push(LocalChatInputMessage {
                    role: "system".to_string(),
                    content: format!(
                        "[Expert Capability Attached: {}]\n\nAttach this as domain capability guidance only. Keep the fixed desktop persona, tone, and reply style unchanged.\n\n{}",
                        capability_name,
                        if capability_summary.trim().is_empty() {
                            "Use the attached expert capability only to improve domain depth and tool choice.".to_string()
                        } else {
                            format!("Relevant capability focus: {}", capability_summary.trim())
                        },
                    ),
                    tool_calls: vec![],
                    tool_call_id: None,
                    name: None,
                });
            }
            LocalCapabilityTransition::Deactivate {
                _capability_id: _,
                capability_name,
            } => {
                *active_capability = None;
                let label = capability_name.unwrap_or_else(|| "expert capability".to_string());
                orchestrated_messages.push(LocalChatInputMessage {
                    role: "system".to_string(),
                    content: format!(
                        "[Expert Capability Detached: {}]\n\nReturn to the default capability-neutral state for this request while keeping the fixed desktop persona unchanged.",
                        label,
                    ),
                    tool_calls: vec![],
                    tool_call_id: None,
                    name: None,
                });
            }
        }
    }
}

pub(super) fn derive_capability_update_from_tool_call_meta(
    tool_call_meta: &[serde_json::Value],
) -> Option<LocalCapabilityTransition> {
    for item in tool_call_meta.iter().rev() {
        let result = item.get("result")?.as_object()?;
        let transition = result.get("capability_transition")?.as_object()?;
        let action = transition
            .get("action")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())?;

        match action {
            "activated" => {
                let capability_id = result
                    .get("capability_id")
                    .and_then(serde_json::Value::as_str)
                    .or_else(|| {
                        transition
                            .get("capability_id")
                            .and_then(serde_json::Value::as_str)
                    })
                    .map(str::trim)
                    .filter(|value| !value.is_empty())?
                    .to_string();
                let capability_name = result
                    .get("capability_name")
                    .and_then(serde_json::Value::as_str)
                    .or_else(|| {
                        transition
                            .get("capability_name")
                            .and_then(serde_json::Value::as_str)
                    })
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or("expert capability")
                    .to_string();
                let capability_summary = result
                    .get("capability_summary")
                    .and_then(serde_json::Value::as_str)
                    .map(str::trim)
                    .unwrap_or_default()
                    .to_string();
                return Some(LocalCapabilityTransition::Activate(
                    LocalCapabilityActivationState {
                        capability_id,
                        capability_name,
                        capability_summary,
                    },
                ));
            }
            "deactivated" => {
                let capability_name = result
                    .get("capability_name")
                    .and_then(serde_json::Value::as_str)
                    .or_else(|| {
                        transition
                            .get("capability_name")
                            .and_then(serde_json::Value::as_str)
                    })
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string);
                let capability_id = result
                    .get("capability_id")
                    .and_then(serde_json::Value::as_str)
                    .or_else(|| {
                        transition
                            .get("capability_id")
                            .and_then(serde_json::Value::as_str)
                    })
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string);
                return Some(LocalCapabilityTransition::Deactivate {
                    _capability_id: capability_id,
                    capability_name,
                });
            }
            _ => {}
        }
    }
    None
}
