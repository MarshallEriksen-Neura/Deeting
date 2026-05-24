use crate::modules::desktop_runtime::runtime::LocalCapabilityActivationState;
use super::super::tool_execution::LocalCapabilityTransition;
use crate::modules::mcp::commands::support::LocalChatInputMessage;

pub(super) fn apply_capability_update(
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
                    reasoning_content: None,
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
                    reasoning_content: None,
                    tool_calls: vec![],
                    tool_call_id: None,
                    name: None,
                });
            }
        }
    }
}
