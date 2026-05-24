use crate::modules::custom_task_agents::service::create_custom_task_agent_service;
use crate::modules::custom_task_agents::types::CreateCustomTaskAgentRequest;
use crate::modules::desktop_runtime::runtime::install_local_skill_from_onboarding_request;
use crate::state::AppState;

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) struct OnboardingToolExecutionResult
{
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) meta: serde_json::Value,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) result_message: String,
}

fn format_tool_error_result_message(tool_name: &str, error_code: &str, error: &str) -> String {
    format!(
        "Tool call '{}' failed [{}]: {}",
        tool_name, error_code, error
    )
}

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) async fn execute_sys_submit_onboarding_request_tool(
    app: &tauri::AppHandle,
    app_state: &AppState,
    call_id: &str,
    tool_name: &str,
    arguments: &serde_json::Value,
) -> OnboardingToolExecutionResult {
    let asset_type = arguments
        .get("asset_type")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let payload = arguments
        .get("payload")
        .cloned()
        .unwrap_or(serde_json::json!({}));

    if asset_type == "assistant" {
        let create_req: Result<mcp_session::assistant::CreateLocalAssistantRequest, _> =
            serde_json::from_value(payload);
        return match create_req {
            Ok(req) => match app_state.mcp.store.create_local_assistant(req).await {
                Ok(id) => {
                    let result_message = format!("Assistant created successfully with ID: {}", id);
                    let meta = serde_json::json!({
                        "id": call_id,
                        "name": tool_name,
                        "status": "success",
                        "result": {
                            "action": "created",
                            "id": id,
                        },
                    });
                    OnboardingToolExecutionResult {
                        meta,
                        result_message,
                    }
                }
                Err(err) => {
                    let error = format!("assistant creation failed: {}", err);
                    let result_message = format_tool_error_result_message(
                        tool_name,
                        "LOCAL_ASSISTANT_CREATE_FAILED",
                        &error,
                    );
                    let meta = serde_json::json!({
                        "id": call_id,
                        "name": tool_name,
                        "status": "error",
                        "error_code": "LOCAL_ASSISTANT_CREATE_FAILED",
                        "error": error,
                    });
                    OnboardingToolExecutionResult {
                        meta,
                        result_message,
                    }
                }
            },
            Err(err) => {
                let error = format!("assistant onboarding payload could not be parsed: {}", err);
                let result_message = format_tool_error_result_message(
                    tool_name,
                    "INVALID_ONBOARDING_ASSISTANT_PAYLOAD",
                    &error,
                );
                let meta = serde_json::json!({
                    "id": call_id,
                    "name": tool_name,
                    "status": "error",
                    "error_code": "INVALID_ONBOARDING_ASSISTANT_PAYLOAD",
                    "error": error,
                });
                OnboardingToolExecutionResult {
                    meta,
                    result_message,
                }
            }
        };
    }

    if asset_type == "skill" {
        return match install_local_skill_from_onboarding_request(app, app_state, &payload).await {
            Ok(result) => {
                let result_message = format!(
                    "Skill onboarding request executed:\n{}",
                    serde_json::to_string_pretty(&result).unwrap_or_else(|_| "{}".to_string())
                );
                let meta = serde_json::json!({
                    "id": call_id,
                    "name": tool_name,
                    "status": "success",
                    "result": result,
                });
                OnboardingToolExecutionResult {
                    meta,
                    result_message,
                }
            }
            Err(err) => {
                let result_message = format!("Skill onboarding failed: {}", err);
                let meta = serde_json::json!({
                    "id": call_id,
                    "name": tool_name,
                    "status": "error",
                    "error": err,
                });
                OnboardingToolExecutionResult {
                    meta,
                    result_message,
                }
            }
        };
    }

    if asset_type == "custom_task_agent" {
        let create_req: Result<CreateCustomTaskAgentRequest, _> = serde_json::from_value(payload);
        return match create_req {
            Ok(req) => match create_custom_task_agent_service(app_state, req).await {
                Ok(profile) => {
                    let profile_id = profile.id.clone();
                    let result = serde_json::json!({
                        "action": "created",
                        "id": profile_id,
                        "status": "success",
                        "result": profile,
                    });
                    let meta = serde_json::json!({
                        "id": call_id,
                        "name": tool_name,
                        "status": "success",
                        "result": result,
                    });
                    OnboardingToolExecutionResult {
                        meta,
                        result_message: "Custom task agent created successfully.".to_string(),
                    }
                }
                Err(err) => {
                    let error = format!("custom task agent creation failed: {}", err);
                    let result_message = format_tool_error_result_message(
                        tool_name,
                        "LOCAL_CUSTOM_TASK_AGENT_CREATE_FAILED",
                        &error,
                    );
                    let meta = serde_json::json!({
                        "id": call_id,
                        "name": tool_name,
                        "status": "error",
                        "error_code": "LOCAL_CUSTOM_TASK_AGENT_CREATE_FAILED",
                        "error": error,
                    });
                    OnboardingToolExecutionResult {
                        meta,
                        result_message,
                    }
                }
            },
            Err(err) => {
                let error = format!(
                    "custom task agent onboarding payload could not be parsed: {}",
                    err
                );
                let result_message = format_tool_error_result_message(
                    tool_name,
                    "INVALID_ONBOARDING_CUSTOM_TASK_AGENT_PAYLOAD",
                    &error,
                );
                let meta = serde_json::json!({
                    "id": call_id,
                    "name": tool_name,
                    "status": "error",
                    "error_code": "INVALID_ONBOARDING_CUSTOM_TASK_AGENT_PAYLOAD",
                    "error": error,
                });
                OnboardingToolExecutionResult {
                    meta,
                    result_message,
                }
            }
        };
    }

    let asset_type_label = if asset_type.trim().is_empty() {
        "<empty>"
    } else {
        asset_type
    };
    let error = format!(
        "unsupported onboarding asset_type '{}'; expected 'assistant', 'skill', or 'custom_task_agent'",
        asset_type_label
    );
    let result_message =
        format_tool_error_result_message(tool_name, "UNSUPPORTED_ONBOARDING_ASSET_TYPE", &error);
    let meta = serde_json::json!({
        "id": call_id,
        "name": tool_name,
        "status": "error",
        "error_code": "UNSUPPORTED_ONBOARDING_ASSET_TYPE",
        "error": error,
    });
    OnboardingToolExecutionResult {
        meta,
        result_message,
    }
}
