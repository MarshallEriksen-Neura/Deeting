use super::control_plane::LocalExecutionPolicy;
use super::prompt_assets::PromptAssets;
use super::prompt_definitions::with_communication_style_message;
pub(crate) use super::prompt_definitions::{
    render_local_communication_style_prompt, render_local_runtime_system_prompt,
};
use crate::modules::code_mode::prompt::{
    render_execution_tool_prompt, render_runtime_capability_prompt,
};
#[cfg(target_os = "windows")]
use crate::utils::configure_background_std_command;
use mcp_core::types::LocalChatInputMessage;
#[cfg(test)]
use mcp_runtime::prompt::build_local_prelude_messages as build_local_prelude_messages_inner;
use mcp_runtime::prompt::build_local_prompt_plan as build_local_prompt_plan_inner;
pub(crate) use mcp_runtime::prompt::{
    parse_router_prompt_local_context, render_local_router_base_prompt,
    router_prompt_default_local_context, router_prompt_response_language_for_locale_pref,
    PromptPlan, RouterPromptLocalContext,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PromptPipeline {
    Chat,
    StructuredControl,
}

impl PromptPipeline {
    fn allows_chat_style_assets(self) -> bool {
        matches!(self, Self::Chat)
    }

    fn includes_execution_tool_protocol(self) -> bool {
        matches!(self, Self::Chat)
    }
}

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

pub(crate) fn build_local_prompt_plan(
    prompt_assets: &PromptAssets,
    execution_policy: Option<&LocalExecutionPolicy>,
    locale: Option<&str>,
) -> PromptPlan {
    build_local_prompt_plan_for_pipeline(
        PromptPipeline::Chat,
        prompt_assets,
        execution_policy,
        locale,
    )
}

pub(crate) fn build_local_structured_control_prompt_plan(
    execution_policy: Option<&LocalExecutionPolicy>,
    locale: Option<&str>,
) -> PromptPlan {
    build_local_prompt_plan_for_pipeline(
        PromptPipeline::StructuredControl,
        &PromptAssets::default(),
        execution_policy,
        locale,
    )
}

pub(crate) fn render_local_structured_control_prelude(
    execution_policy: Option<&LocalExecutionPolicy>,
    locale: Option<&str>,
) -> String {
    build_local_structured_control_prompt_plan(execution_policy, locale)
        .prelude_messages
        .iter()
        .map(|message| message.content.trim())
        .filter(|content| !content.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
}

pub(crate) fn build_local_prompt_plan_for_pipeline(
    pipeline: PromptPipeline,
    prompt_assets: &PromptAssets,
    execution_policy: Option<&LocalExecutionPolicy>,
    locale: Option<&str>,
) -> PromptPlan {
    let runtime_capability_prompt = execution_policy.and_then(|policy| {
        let tool_names = policy.prompt_tool_names();
        (!tool_names.is_empty())
            .then(|| render_runtime_capability_prompt(&tool_names))
            .filter(|prompt| !prompt.trim().is_empty())
    });
    let execution_tool_prompt = execution_policy.and_then(|policy| {
        let tool_names = policy.prompt_tool_names();
        (pipeline.includes_execution_tool_protocol()
            && policy.inject_execution_protocol
            && !tool_names.is_empty())
            .then(|| render_execution_tool_prompt(&tool_names))
            .filter(|prompt| !prompt.trim().is_empty())
    });
    let local_context = router_prompt_local_context();
    let response_language = locale
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .map(|l| {
            if l.to_lowercase().starts_with("zh") {
                "Simplified Chinese (zh-CN)".to_string()
            } else {
                "English (en)".to_string()
            }
        })
        .unwrap_or_else(|| router_prompt_default_response_language().to_string());
    let local_router_prompt = render_local_router_base_prompt(
        &local_context.current_date,
        &local_context.timezone,
        &response_language,
    );
    let base_system_prompt = render_local_runtime_system_prompt(
        &local_router_prompt,
        runtime_capability_prompt.as_deref(),
        execution_tool_prompt.as_deref(),
    );

    let prompt_assets = if pipeline.allows_chat_style_assets() {
        with_communication_style_message(prompt_assets)
    } else {
        PromptAssets::default()
    };

    build_local_prompt_plan_inner(
        &prompt_assets,
        local_context,
        &response_language,
        &base_system_prompt,
    )
}

#[cfg(test)]
pub(crate) fn build_local_prelude_messages(
    prompt_assets: &PromptAssets,
    execution_policy: Option<&LocalExecutionPolicy>,
) -> Vec<LocalChatInputMessage> {
    build_local_prelude_messages_for_pipeline(PromptPipeline::Chat, prompt_assets, execution_policy)
}

#[cfg(test)]
pub(crate) fn build_local_structured_control_prelude_messages(
    execution_policy: Option<&LocalExecutionPolicy>,
) -> Vec<LocalChatInputMessage> {
    build_local_prelude_messages_for_pipeline(
        PromptPipeline::StructuredControl,
        &PromptAssets::default(),
        execution_policy,
    )
}

#[cfg(test)]
pub(crate) fn build_local_prelude_messages_for_pipeline(
    pipeline: PromptPipeline,
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
        (pipeline.includes_execution_tool_protocol()
            && policy.inject_execution_protocol
            && !tool_names.is_empty())
            .then(|| render_execution_tool_prompt(&tool_names))
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

    let prompt_assets = if pipeline.allows_chat_style_assets() {
        with_communication_style_message(prompt_assets)
    } else {
        PromptAssets::default()
    };
    build_local_prelude_messages_inner(&prompt_assets, &base_system_prompt)
}
