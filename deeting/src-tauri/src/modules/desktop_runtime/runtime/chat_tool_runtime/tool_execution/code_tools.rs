use super::super::runtime_state::LocalChatToolRuntimeState;
use super::super::streaming::LocalRealtimeToolTraceEmitter;
use super::{consult_task_policy_guidance, execute_code_mode_request};
use crate::modules::code_mode::types::ExecuteLocalCodemodeRequest;
use crate::modules::desktop_runtime::runtime::sovereign::DecisionLocus;
use crate::modules::desktop_runtime::runtime::CapabilityExecutionContract;
use crate::modules::sandbox::prepare_config::resolve_sandbox_prepare_config;
use crate::modules::sandbox::types::SandboxSnippetLanguage;
use crate::state::AppState;

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) struct CodePlanToolExecutionResult
{
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) meta: serde_json::Value,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) result_message: String,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) runtime_transition_block:
        Option<serde_json::Value>,
}

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) struct LocalCodeSnippetToolExecutionResult
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

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) async fn execute_code_plan_tool(
    app_state: &AppState,
    state: &LocalChatToolRuntimeState,
    last_capability_snapshot: Option<&serde_json::Value>,
    realtime_emitter: &LocalRealtimeToolTraceEmitter,
    call_id: &str,
    tool_name: &str,
    arguments: &serde_json::Value,
) -> CodePlanToolExecutionResult {
    let execution_gate_guidance = consult_task_policy_guidance(
        app_state,
        state.task_query.as_deref(),
        DecisionLocus::Execution,
    )
    .await;
    let code = arguments.get("code").and_then(|v| v.as_str()).unwrap_or("");
    let language = arguments
        .get("language")
        .and_then(|v| v.as_str())
        .unwrap_or("python");
    let execution_timeout = arguments
        .get("execution_timeout")
        .and_then(|v| v.as_u64())
        .map(|v| v.max(1));
    let dry_run = arguments
        .get("dry_run")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    let execution_contract =
        match CapabilityExecutionContract::from_search_result(last_capability_snapshot) {
            Ok(contract) => contract,
            Err(error) => {
                let result_message = format!(
                    "Codemode Tool Blocked [CODEMODE_SEARCH_REQUIRED]: {}",
                    error
                );
                let meta = serde_json::json!({
                    "id": call_id,
                    "name": tool_name,
                    "status": "error",
                    "error_code": "CODEMODE_SEARCH_REQUIRED",
                    "error": error,
                    "task_policy_gate": execution_gate_guidance
                        .as_ref()
                        .map(|guidance| guidance.gate_meta("execute_code_plan")),
                });
                return CodePlanToolExecutionResult {
                    meta,
                    result_message,
                    runtime_transition_block: None,
                };
            }
        };

    let runtime_transition_block = Some(execution_contract.project_runtime_transition_block(
        state.trace_id.as_str(),
        state.request_id.as_deref(),
        state.session_id.as_str(),
        call_id,
    ));

    if code.trim().is_empty() {
        let error = "execute_code_plan requires a non-empty 'code' argument";
        let meta = serde_json::json!({
            "id": call_id,
            "name": tool_name,
            "status": "error",
            "error_code": "CODEMODE_EMPTY_CODE",
            "error": error,
        });
        return CodePlanToolExecutionResult {
            meta,
            result_message: format_tool_error_result_message(
                tool_name,
                "CODEMODE_EMPTY_CODE",
                error,
            ),
            runtime_transition_block,
        };
    }

    let execution_request = ExecuteLocalCodemodeRequest {
        code: code.to_string(),
        task: arguments
            .get("task")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        scope: arguments.get("scope").cloned(),
        constraints: arguments.get("constraints").cloned(),
        session_id: Some(state.session_id.clone()),
        language: Some(language.to_string()),
        execution_timeout,
        dry_run: Some(dry_run),
        context: None,
        max_calls: None,
        allowed_tools: Some(execution_contract.allowed_tools.clone()),
        capability_snapshot: Some(execution_contract.capability_snapshot.clone()),
    };
    let execution_res =
        execute_code_mode_request(app_state, execution_request, realtime_emitter).await;
    match execution_res {
        Ok(res) => {
            let meta_status = if res.success { "success" } else { "error" };
            let result_message = if res.success {
                format!("Codemode Tool Result:\n{}", res.result.join("\n"))
            } else {
                format!(
                    "Codemode Tool Blocked: {}",
                    res.error
                        .clone()
                        .unwrap_or_else(|| "sandbox not ready".to_string())
                )
            };
            let meta = serde_json::json!({
                "id": call_id,
                "name": tool_name,
                "status": meta_status,
                "errorCode": res.error_code,
                "result": res,
                "task_policy_gate": execution_gate_guidance
                    .as_ref()
                    .map(|guidance| guidance.gate_meta("execute_code_plan")),
            });
            CodePlanToolExecutionResult {
                meta,
                result_message,
                runtime_transition_block,
            }
        }
        Err(err) => {
            let meta = serde_json::json!({
                "id": call_id,
                "name": tool_name,
                "status": "error",
                "error": err.to_string(),
                "task_policy_gate": execution_gate_guidance
                    .as_ref()
                    .map(|guidance| guidance.gate_meta("execute_code_plan")),
            });
            CodePlanToolExecutionResult {
                meta,
                result_message: format!("Codemode Tool Failed: {}", err),
                runtime_transition_block,
            }
        }
    }
}

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) async fn execute_local_code_snippet_tool(
    app_state: &AppState,
    session_id: &str,
    call_id: &str,
    tool_name: &str,
    arguments: &serde_json::Value,
) -> LocalCodeSnippetToolExecutionResult {
    let code = arguments.get("code").and_then(|v| v.as_str()).unwrap_or("");

    if code.trim().is_empty() {
        let error = "run_local_code_snippet requires a non-empty 'code' argument";
        let meta = serde_json::json!({
            "id": call_id,
            "name": tool_name,
            "status": "error",
            "error_code": "LOCAL_CODE_SNIPPET_EMPTY_CODE",
            "error": error,
        });
        return LocalCodeSnippetToolExecutionResult {
            meta,
            result_message: format_tool_error_result_message(
                tool_name,
                "LOCAL_CODE_SNIPPET_EMPTY_CODE",
                error,
            ),
        };
    }

    let language = arguments
        .get("language")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let snippet_language = match language.trim().to_ascii_lowercase().as_str() {
        "python" => SandboxSnippetLanguage::Python,
        "go" => SandboxSnippetLanguage::Go,
        "rust" => SandboxSnippetLanguage::Rust,
        "java" => SandboxSnippetLanguage::Java,
        _ => {
            let error = format!(
                "run_local_code_snippet only supports python, go, rust, and java; received '{}'",
                language
            );
            let result_message = format_tool_error_result_message(
                tool_name,
                "LOCAL_CODE_SNIPPET_UNSUPPORTED_LANGUAGE",
                &error,
            );
            let meta = serde_json::json!({
                "id": call_id,
                "name": tool_name,
                "status": "error",
                "error_code": "LOCAL_CODE_SNIPPET_UNSUPPORTED_LANGUAGE",
                "error": error,
            });
            return LocalCodeSnippetToolExecutionResult {
                meta,
                result_message,
            };
        }
    };

    let prepare_config = match resolve_sandbox_prepare_config(app_state).await {
        Ok(config) => config,
        Err(err) => {
            let result_message = format_tool_error_result_message(
                tool_name,
                "LOCAL_CODE_SNIPPET_PREPARE_CONFIG_ERROR",
                &err,
            );
            let meta = serde_json::json!({
                "id": call_id,
                "name": tool_name,
                "status": "error",
                "error_code": "LOCAL_CODE_SNIPPET_PREPARE_CONFIG_ERROR",
                "error": err,
            });
            return LocalCodeSnippetToolExecutionResult {
                meta,
                result_message,
            };
        }
    };

    let snippet_result = app_state
        .sandbox
        .manager
        .run_local_code_snippet_with_prepare_config(
            session_id,
            snippet_language,
            code,
            arguments.get("execution_timeout").and_then(|v| v.as_u64()),
            Some(&prepare_config),
        )
        .await;
    let meta_status = if snippet_result.success {
        "success"
    } else {
        "error"
    };
    let result_message = if meta_status == "success" {
        "Local code snippet executed successfully.".to_string()
    } else {
        "Local code snippet execution failed.".to_string()
    };
    let error_code = snippet_result.error_code.clone();
    let error = snippet_result.error.clone();
    let meta = serde_json::json!({
        "id": call_id,
        "name": tool_name,
        "status": meta_status,
        "error_code": error_code,
        "error": error,
        "result": snippet_result,
    });
    LocalCodeSnippetToolExecutionResult {
        meta,
        result_message,
    }
}
