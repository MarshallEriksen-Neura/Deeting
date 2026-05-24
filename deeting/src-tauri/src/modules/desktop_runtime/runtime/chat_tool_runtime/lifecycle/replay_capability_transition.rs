use super::super::tool_execution::LocalCapabilityTransition;
use crate::modules::desktop_runtime::runtime::LocalCapabilityActivationState;

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn derive_capability_update_from_tool_call_meta(
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
