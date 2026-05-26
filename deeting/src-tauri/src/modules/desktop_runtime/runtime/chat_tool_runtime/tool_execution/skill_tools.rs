use crate::modules::desktop_runtime::runtime::{
    activate_skill_from_args, read_skill_resource_from_args, ActiveSkillContextState,
};
use crate::state::AppState;

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) struct SkillToolExecutionResult
{
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) active_skill:
        ActiveSkillContextState,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) meta: serde_json::Value,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) result_message: String,
}

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) struct SkillIndexRefreshExecutionResult
{
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) meta: serde_json::Value,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) result_message: String,
}

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) async fn execute_activate_skill_tool(
    app_state: &AppState,
    call_id: &str,
    tool_name: &str,
    arguments: &serde_json::Value,
) -> Result<SkillToolExecutionResult, String> {
    let (active_skill, result) = activate_skill_from_args(app_state, arguments).await?;
    let result_message = format!(
        "Skill '{}' activated for this request. Use its SKILL.md instructions and read package resources only when needed.",
        active_skill.skill_id
    );
    Ok(SkillToolExecutionResult {
        active_skill,
        meta: serde_json::json!({
            "id": call_id,
            "name": tool_name,
            "status": "success",
            "result": result,
        }),
        result_message,
    })
}

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) async fn execute_read_skill_resource_tool(
    app_state: &AppState,
    active_skill_context: Option<&ActiveSkillContextState>,
    call_id: &str,
    tool_name: &str,
    arguments: &serde_json::Value,
) -> Result<SkillToolExecutionResult, String> {
    let (active_skill, result) =
        read_skill_resource_from_args(app_state, arguments, active_skill_context).await?;
    let result_message = format!(
        "Skill resource '{}' loaded as private context.",
        result
            .get("path")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("<unknown>")
    );
    let resource_path = result
        .get("path")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("<unknown>");
    Ok(SkillToolExecutionResult {
        active_skill,
        meta: serde_json::json!({
            "id": call_id,
            "name": tool_name,
            "status": "success",
            "result": result,
            "observation_patch": [{
                "text": format!("read skill resource {resource_path}"),
                "structured": {
                    "path": resource_path,
                },
            }],
        }),
        result_message,
    })
}

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) async fn refresh_skill_index(
    app: tauri::AppHandle,
    app_state: &AppState,
) -> Result<usize, String> {
    crate::modules::skills::commands::register_local_skills_inner(app, app_state)
        .await
        .map(|registered| registered as usize)
        .map_err(|err| err.to_string())
}

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) async fn execute_refresh_skill_index_tool(
    app: tauri::AppHandle,
    app_state: &AppState,
    call_id: &str,
    tool_name: &str,
) -> SkillIndexRefreshExecutionResult {
    match refresh_skill_index(app, app_state).await {
        Ok(registered) => SkillIndexRefreshExecutionResult {
            meta: serde_json::json!({
                "id": call_id,
                "name": tool_name,
                "status": "success",
                "result": {
                    "status": "ok",
                    "registered": registered,
                },
            }),
            result_message: format!(
                "Skill index refreshed successfully. Registered {} local skills.",
                registered
            ),
        },
        Err(err) => SkillIndexRefreshExecutionResult {
            meta: serde_json::json!({
                "id": call_id,
                "name": tool_name,
                "status": "error",
                "error": err.to_string(),
            }),
            result_message: format!("Skill index refresh failed: {}", err),
        },
    }
}
