use super::control_plane::LocalExecutionPolicy;
use super::prompt_assets::PromptAssets;
use crate::modules::code_mode::prompt::{
    render_execution_tool_prompt, render_runtime_capability_prompt,
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
    "Tool calls are visible to the user as live cards. Communicate around them with this discipline:\n",
    "\n",
    "1. Read-only tools (search, read_file, list, grep, fetch_url): DO NOT pre-announce. ",
    "The tool card itself documents the action — narrating it is noise.\n",
    "2. Side-effect tools (write, execute, send, modify state, call external API with cost): ",
    "Before the call, emit ONE short sentence stating what you are about to do AND why. Not a paragraph.\n",
    "3. A batch of related tools fired back-to-back (e.g. reading 5 files to map an interface): ",
    "Narrate the intent ONCE before the batch, not before each individual call.\n",
    "4. Never use filler openers before a tool: \"let me check\", \"I'll help you with that\", \"好的\", \"我来\" add zero information.\n",
    "5. Emit pre-tool notes as regular assistant text immediately before the tool call, ",
    "not as a separate empty update."
);

const POST_REPLY_STYLE_PROMPT: &str = concat!(
    "After all tool work is done, your final reply must answer the user directly. Specifically:\n",
    "\n",
    "1. DO NOT recap what tools you called or what you found step-by-step. ",
    "The tool cards above already show this — repeating it is pure noise.\n",
    "2. DO NOT write meta-narrative like \"Based on my research above\", \"In summary, I have done X, Y, Z\", ",
    "\"综上所述\", \"经过以上分析\". Just state the conclusion or answer.\n",
    "3. DO NOT open with \"好的\" / \"OK\" / \"Sure\" / \"Let me explain\" / \"我来为你...\". ",
    "Start with the substance of the answer.\n",
    "4. If the answer is a single fact or short conclusion, write it in one or two sentences — ",
    "do not pad it to look thorough.\n",
    "5. Only structure the reply (headings, lists) when the answer genuinely has multiple parallel parts. ",
    "A single conclusion does not need a heading."
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

    sections.push(format!(
        "## Final Reply Style\n{}",
        POST_REPLY_STYLE_PROMPT
    ));

    sections.join("\n\n")
}

pub(crate) fn build_local_prompt_plan(
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
        (policy.inject_execution_protocol && !tool_names.is_empty())
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

    build_local_prompt_plan_inner(
        prompt_assets,
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
    let runtime_capability_prompt = execution_policy.and_then(|policy| {
        let tool_names = policy.prompt_tool_names();
        (!tool_names.is_empty())
            .then(|| render_runtime_capability_prompt(&tool_names))
            .filter(|prompt| !prompt.trim().is_empty())
    });
    let execution_tool_prompt = execution_policy.and_then(|policy| {
        let tool_names = policy.prompt_tool_names();
        (policy.inject_execution_protocol && !tool_names.is_empty())
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

    build_local_prelude_messages_inner(prompt_assets, &base_system_prompt)
}
