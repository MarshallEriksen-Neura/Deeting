use super::control_plane::LocalExecutionPolicy;
use super::prompt_assets::PromptAssets;
use crate::modules::code_mode::prompt::{
    render_code_mode_capability_prompt, render_runtime_capability_prompt,
};
#[cfg(target_os = "windows")]
use crate::utils::configure_background_std_command;
#[cfg(test)]
use mcp_core::types::LocalChatInputMessage;

#[cfg(test)]
use mcp_runtime::prompt::build_local_prelude_messages as build_local_prelude_messages_inner;
use mcp_runtime::prompt::build_local_prompt_plan as build_local_prompt_plan_inner;
pub(crate) use mcp_runtime::prompt::{
    parse_router_prompt_local_context, render_local_router_base_prompt,
    router_prompt_default_local_context, router_prompt_response_language_for_locale_pref,
    PromptPlan, RouterPromptLocalContext,
};

const PRE_TOOL_VISIBILITY_PROMPT: &str = concat!(
    "Before a user-visible tool call, briefly state what you are about to check or do in one natural sentence when that helps the user follow the action.\n",
    "Keep the pre-tool note short and specific.\n",
    "Do not add a pre-tool note when you can answer directly without tools.\n",
    "Do not repeat the same pre-tool note for every immediate sub-tool call in one continuous action.\n",
    "Prefer emitting that note as the assistant's normal text content before the tool call rather than as a separate empty update."
);

fn query_router_prompt_local_context_from_system() -> Option<RouterPromptLocalContext> {
    #[cfg(target_os = "windows")]
    let output = {
        let mut command = std::process::Command::new("powershell");
        configure_background_std_command(&mut command);
        command
            .args([
                "-NoProfile",
                "-Command",
                "(Get-Date).ToString('yyyy-MM-dd') + '|' + (Get-TimeZone).Id",
            ])
            .output()
            .ok()?
    };

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

pub(crate) fn render_local_runtime_system_prompt(
    router_prompt: &str,
    runtime_capability_prompt: Option<&str>,
    execution_tool_prompt: Option<&str>,
) -> String {
    let mut sections = Vec::new();
    let router_prompt = router_prompt.trim();
    if !router_prompt.is_empty() {
        sections.push(router_prompt.to_string());
    }

    if let Some(prompt) = runtime_capability_prompt
        .map(str::trim)
        .filter(|prompt| !prompt.is_empty())
    {
        sections.push(format!("## Runtime Capability Contract\n{}", prompt));
    }

    if let Some(prompt) = execution_tool_prompt
        .map(str::trim)
        .filter(|prompt| !prompt.is_empty())
    {
        sections.push(format!("## Execution Tool Protocol\n{}", prompt));
    }

    sections.push(format!(
        "## User-Visible Tool Call Updates\n{}",
        PRE_TOOL_VISIBILITY_PROMPT
    ));

    sections.join("\n\n")
}

pub(crate) fn build_local_prompt_plan(
    prompt_assets: &PromptAssets,
    execution_policy: Option<&LocalExecutionPolicy>,
) -> PromptPlan {
    let runtime_capability_prompt = execution_policy.and_then(|policy| {
        let tool_names = policy.prompt_tool_names();
        (!tool_names.is_empty())
            .then(|| render_runtime_capability_prompt(&tool_names))
            .filter(|prompt| !prompt.trim().is_empty())
    });
    let execution_tool_prompt = execution_policy.and_then(|policy| {
        let tool_names = policy.prompt_tool_names();
        (policy.inject_execution_protocol && !tool_names.is_empty())
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
    let base_system_prompt = render_local_runtime_system_prompt(
        &local_router_prompt,
        runtime_capability_prompt.as_deref(),
        execution_tool_prompt.as_deref(),
    );

    build_local_prompt_plan_inner(
        prompt_assets,
        local_context,
        response_language,
        &base_system_prompt,
    )
}

#[cfg(test)]
pub(crate) fn build_local_prelude_messages(
    prompt_assets: &PromptAssets,
    execution_policy: Option<&LocalExecutionPolicy>,
) -> Vec<LocalChatInputMessage> {
    let runtime_capability_prompt = execution_policy.and_then(|policy| {
        let tool_names = policy.prompt_tool_names();
        (!tool_names.is_empty())
            .then(|| render_runtime_capability_prompt(&tool_names))
            .filter(|prompt| !prompt.trim().is_empty())
    });
    let execution_tool_prompt = execution_policy.and_then(|policy| {
        let tool_names = policy.prompt_tool_names();
        (policy.inject_execution_protocol && !tool_names.is_empty())
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
    let base_system_prompt = render_local_runtime_system_prompt(
        &local_router_prompt,
        runtime_capability_prompt.as_deref(),
        execution_tool_prompt.as_deref(),
    );

    build_local_prelude_messages_inner(prompt_assets, &base_system_prompt)
}
