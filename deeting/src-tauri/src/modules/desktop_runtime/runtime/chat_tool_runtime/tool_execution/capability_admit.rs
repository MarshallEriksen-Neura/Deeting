use crate::modules::desktop_runtime::runtime::sovereign::{DecisionLocus, Self_};
use crate::modules::desktop_runtime::runtime::{
    resolve_local_capability_activation_state, LocalCapabilityActivationState,
    LOCAL_ASSISTANT_ACTIVATION_FORMAT_VERSION,
};
use crate::modules::mcp::store::McpStore;

#[derive(Debug, Clone)]
pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) enum LocalCapabilityTransition {
    Activate(LocalCapabilityActivationState),
    Deactivate {
        _capability_id: Option<String>,
        capability_name: Option<String>,
    },
}

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) struct CapabilityAdmitResult {
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) meta: serde_json::Value,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) result_message: String,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) capability_update:
        Option<LocalCapabilityTransition>,
}

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) async fn handle_attach_capability_tool(
    store: &McpStore,
    state_task_query: Option<&str>,
    call_id: &str,
    tool_name: &str,
    arguments: &serde_json::Value,
) -> CapabilityAdmitResult {
    let attach_gate_guidance = match state_task_query {
        Some(query) => Some(Self_::consult(store, DecisionLocus::CapabilityAttach, query, 4).await),
        None => None,
    };
    let capability_id = arguments
        .get("capability_id")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let reason = arguments
        .get("reason")
        .and_then(|v| v.as_str())
        .unwrap_or("Explicit expert capability attach requested by the model.");

    let state = match resolve_local_capability_activation_state(store, capability_id).await {
        Ok(state) => state,
        Err(err) => {
            let meta = serde_json::json!({
                "id":call_id,
                "name":tool_name,
                "status":"error",
                "error_code":"CAPABILITY_ATTACH_FAILED",
                "error":err.clone(),
                "task_policy_gate": attach_gate_guidance
                    .as_ref()
                    .map(|guidance| guidance.gate_meta("attach_capability")),
            });
            return CapabilityAdmitResult {
                meta,
                result_message: format!("Expert capability attach failed: {}", err),
                capability_update: None,
            };
        }
    };
    let activated_capability_id = state.capability_id.clone();
    let meta = serde_json::json!({
        "id": call_id,
        "name": tool_name,
        "status": "success",
        "result": serde_json::json!({
            "action":"activated",
            "scope":"request",
            "format_version":LOCAL_ASSISTANT_ACTIVATION_FORMAT_VERSION,
            "activation_mode":"attach_capability",
            "capability_id":activated_capability_id,
            "capability_name":state.capability_name.clone(),
            "capability_summary":state.capability_summary.clone(),
            "reason":reason,
            "capability_transition":{
                "action":"activated",
                "capability_id":capability_id,
                "capability_name":state.capability_name.clone(),
                "reason":reason
            },
            "task_policy_gate": attach_gate_guidance
                .as_ref()
                .map(|guidance| guidance.gate_meta("attach_capability"))
        }),
    });

    CapabilityAdmitResult {
        meta,
        result_message: format!(
            "Expert capability '{}' attached for the current request.",
            state.capability_name
        ),
        capability_update: Some(LocalCapabilityTransition::Activate(state)),
    }
}

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn handle_detach_capability_tool(
    active_capability: Option<&LocalCapabilityActivationState>,
    call_id: &str,
    tool_name: &str,
    arguments: &serde_json::Value,
) -> CapabilityAdmitResult {
    let reason = arguments
        .get("reason")
        .and_then(|v| v.as_str())
        .unwrap_or("Explicit expert capability detach requested by the model.");
    let capability_id = active_capability.map(|v| v.capability_id.clone());
    let capability_name = active_capability.map(|v| v.capability_name.clone());
    let meta = serde_json::json!({
        "id": call_id,
        "name": tool_name,
        "status": "success",
        "result": serde_json::json!({
            "action":"deactivated",
            "scope":"request",
            "format_version":LOCAL_ASSISTANT_ACTIVATION_FORMAT_VERSION,
            "capability_id": capability_id.clone(),
            "capability_name": capability_name.clone(),
            "reason": reason,
            "capability_transition":{
                "action":"deactivated",
                "capability_id": capability_id,
                "capability_name": capability_name,
                "reason": reason
            }
        }),
    });

    CapabilityAdmitResult {
        meta,
        result_message: "Assistant deactivated for the current request.".to_string(),
        capability_update: Some(LocalCapabilityTransition::Deactivate {
            _capability_id: active_capability.map(|v| v.capability_id.clone()),
            capability_name: active_capability.map(|v| v.capability_name.clone()),
        }),
    }
}
