use super::control_plane::LocalExecutionPolicy;
use super::prompt_assets::PromptAssets;
use crate::modules::code_mode::prompt::render_code_mode_capability_prompt;
use mcp_core::types::LocalChatInputMessage;

use mcp_runtime::prompt::{
    build_local_prelude_messages as build_local_prelude_messages_inner,
    build_local_prompt_plan as build_local_prompt_plan_inner,
};
pub(crate) use mcp_runtime::prompt::{
    parse_router_prompt_local_context, render_local_base_system_prompt,
    render_local_router_base_prompt, router_prompt_default_local_context,
    router_prompt_response_language_for_locale_pref, PromptPlan, RouterPromptLocalContext,
};

fn query_router_prompt_local_context_from_system() -> Option<RouterPromptLocalContext> {
    #[cfg(target_os = "windows")]
    let output = std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "(Get-Date).ToString('yyyy-MM-dd') + '|' + (Get-TimeZone).Id",
        ])
        .output()
        .ok()?;

    #[cfg(not(target_os = "windows"))]
    let output = std::process::Command::new("date")
        .arg("+%F|%Z")
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let raw = String::from_utf8(output.stdout).ok()?;
    parse_router_prompt_local_context(&raw)
}

pub(crate) fn router_prompt_local_context() -> RouterPromptLocalContext {
    query_router_prompt_local_context_from_system()
        .unwrap_or_else(router_prompt_default_local_context)
}

pub(crate) fn router_prompt_default_response_language() -> &'static str {
    router_prompt_response_language_for_locale_pref(crate::tray::desktop_prefers_zh())
}

pub(crate) fn build_local_prompt_plan(
    prompt_assets: &PromptAssets,
    execution_policy: Option<&LocalExecutionPolicy>,
) -> PromptPlan {
    let code_mode_prompt = execution_policy.and_then(|policy| {
        let tool_names = policy.prompt_tool_names();
        (!tool_names.is_empty())
            .then(|| render_code_mode_capability_prompt(&tool_names))
            .filter(|prompt| !prompt.trim().is_empty())
    });
    let local_context = router_prompt_local_context();
    let response_language = router_prompt_default_response_language();
    let local_router_prompt = render_local_router_base_prompt(
        &local_context.current_date,
        &local_context.timezone,
        response_language,
    );
    let base_system_prompt =
        render_local_base_system_prompt(&local_router_prompt, code_mode_prompt.as_deref());

    build_local_prompt_plan_inner(
        prompt_assets,
        local_context,
        response_language,
        &base_system_prompt,
    )
}

pub(crate) fn build_local_prelude_messages(
    prompt_assets: &PromptAssets,
    execution_policy: Option<&LocalExecutionPolicy>,
) -> Vec<LocalChatInputMessage> {
    let code_mode_prompt = execution_policy.and_then(|policy| {
        let tool_names = policy.prompt_tool_names();
        (!tool_names.is_empty())
            .then(|| render_code_mode_capability_prompt(&tool_names))
            .filter(|prompt| !prompt.trim().is_empty())
    });
    let local_context = router_prompt_local_context();
    let response_language = router_prompt_default_response_language();
    let local_router_prompt = render_local_router_base_prompt(
        &local_context.current_date,
        &local_context.timezone,
        response_language,
    );
    let base_system_prompt =
        render_local_base_system_prompt(&local_router_prompt, code_mode_prompt.as_deref());

    build_local_prelude_messages_inner(prompt_assets, &base_system_prompt)
}
