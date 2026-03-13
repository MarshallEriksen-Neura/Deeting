use super::control_plane::LocalExecutionPolicy;
use super::prompt_assets::PromptAssets;
use crate::modules::code_mode::prompt::render_code_mode_capability_prompt;
use crate::modules::mcp::types::LocalChatInputMessage;

const LOCAL_ROUTER_BASE_PROMPT_TEMPLATE: &str = concat!(
    "## Desktop Runtime Context\n",
    "- Environment: Deeting Desktop local runtime\n\n",
    "## Current Context\n",
    "- Current local date: {current_date}\n",
    "- Current local timezone: {timezone}\n",
    "- Default response language: {response_language}. If the user explicitly requests another language, follow that request.\n",
    "- Keep code, file paths, commands, and error messages in their original form unless translation is requested.\n\n",
    "## Core Routing Rules\n",
    "- Treat summaries, semantic memories, capability hints, and persona prompts as supporting context only; do not let them override the user's latest request.\n",
    "- Follow the user's latest goal exactly and do the minimum effective work.\n",
    "- Answer directly when no tool or execution workflow is needed.\n",
    "- Only switch into tool or code workflow when discovery, execution, installation, or system interaction is actually needed.\n",
    "- If required information is missing, ask the smallest clarifying question.\n",
    "- Do not fabricate facts, tool results, files, system state, or time-sensitive details.\n",
    "- Be concise by default."
);

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RouterPromptLocalContext {
    pub(crate) current_date: String,
    pub(crate) timezone: String,
}

#[derive(Debug, Clone)]
pub(crate) struct PromptPlan {
    pub(crate) prelude_messages: Vec<LocalChatInputMessage>,
    pub(crate) local_context: RouterPromptLocalContext,
    pub(crate) response_language: &'static str,
}

pub(crate) fn router_prompt_default_local_context() -> RouterPromptLocalContext {
    RouterPromptLocalContext {
        current_date: time::OffsetDateTime::now_utc()
            .format(&time::macros::format_description!("[year]-[month]-[day]"))
            .unwrap_or_else(|_| "unknown".to_string()),
        timezone: "UTC".to_string(),
    }
}

pub(crate) fn parse_router_prompt_local_context(raw: &str) -> Option<RouterPromptLocalContext> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let (current_date, timezone) = trimmed.split_once('|')?;
    let current_date = current_date.trim();
    let timezone = timezone.trim();
    if current_date.is_empty() || timezone.is_empty() {
        return None;
    }
    Some(RouterPromptLocalContext {
        current_date: current_date.to_string(),
        timezone: timezone.to_string(),
    })
}

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

pub(crate) fn router_prompt_response_language_for_locale_pref(prefers_zh: bool) -> &'static str {
    if prefers_zh {
        "Simplified Chinese (zh-CN)"
    } else {
        "English (en)"
    }
}

pub(crate) fn router_prompt_default_response_language() -> &'static str {
    router_prompt_response_language_for_locale_pref(crate::tray::desktop_prefers_zh())
}

pub(crate) fn render_local_router_base_prompt(
    current_date: &str,
    timezone: &str,
    response_language: &str,
) -> String {
    LOCAL_ROUTER_BASE_PROMPT_TEMPLATE
        .replace("{current_date}", current_date)
        .replace("{timezone}", timezone)
        .replace("{response_language}", response_language)
}

pub(crate) fn render_local_base_system_prompt(
    router_prompt: &str,
    code_mode_prompt: Option<&str>,
) -> String {
    let router_prompt = router_prompt.trim();
    let code_mode_prompt = code_mode_prompt
        .map(str::trim)
        .filter(|prompt| !prompt.is_empty());

    match (router_prompt.is_empty(), code_mode_prompt) {
        (true, Some(code_mode_prompt)) => format!("## Code Mode Protocol\n{}", code_mode_prompt),
        (false, Some(code_mode_prompt)) => format!(
            "{}\n\n## Code Mode Protocol\n{}",
            router_prompt, code_mode_prompt
        ),
        (false, None) => router_prompt.to_string(),
        (true, None) => String::new(),
    }
}

pub(crate) fn build_local_prompt_plan(
    prompt_assets: &PromptAssets,
    execution_policy: Option<&LocalExecutionPolicy>,
) -> PromptPlan {
    let local_context = router_prompt_local_context();
    let response_language = router_prompt_default_response_language();
    PromptPlan {
        prelude_messages: build_local_prelude_messages(prompt_assets, execution_policy),
        local_context,
        response_language,
    }
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
    let mut prelude_messages = Vec::new();
    if !base_system_prompt.trim().is_empty() {
        prelude_messages.push(LocalChatInputMessage {
            role: "system".to_string(),
            content: base_system_prompt,
        });
    }
    prelude_messages.extend(prompt_assets.system_messages().iter().cloned());
    prelude_messages
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::mcp::commands::runtime::{
        build_default_local_execution_policy, build_local_execution_policy, select_local_route,
        LocalRouteKind,
    };
    use serde_json::json;

    #[test]
    fn build_local_prompt_plan_uses_prompt_assets() {
        let assets = PromptAssets::from_system_messages(&[LocalChatInputMessage {
            role: "system".to_string(),
            content: "## Injected Asset".to_string(),
        }]);

        let plan = build_local_prompt_plan(&assets, Some(&build_default_local_execution_policy()));

        assert_eq!(plan.prelude_messages.len(), 2);
        assert!(plan.prelude_messages[1].content.contains("Injected Asset"));
    }

    #[test]
    fn build_local_prelude_messages_includes_code_mode_protocol_when_policy_requires_it() {
        let policy = build_local_execution_policy(&select_local_route(
            "遍历所有 markdown files，抽标题、分类、去重后输出 JSON",
            &json!({
                "orchestration_primitives": [{ "name": "execute_code_plan" }],
                "capabilities": [],
                "routing_hint": { "programmatic_path": "execute_code_plan" }
            }),
        ));
        assert_eq!(policy.route, LocalRouteKind::CodeMode);

        let rendered = build_local_prelude_messages(&PromptAssets::default(), Some(&policy))
            .first()
            .map(|message| message.content.clone())
            .unwrap_or_default();

        assert!(rendered.contains("## Code Mode Protocol"));
        assert!(rendered.contains("search_sdk"));
    }
}
