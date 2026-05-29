use mcp_core::types::LocalChatInputMessage;

const LOCAL_ROUTER_BASE_PROMPT_TEMPLATE: &str = concat!(
    "## Current Context\n",
    "- Date: {current_date}  Timezone: {timezone}\n",
    "- Default response language: {response_language}. Override only when the user explicitly switches.\n",
    "- Preserve original formatting for code, file paths, commands, and error messages unless translation is explicitly requested.\n",
    "- Treat retrieved semantic memories as supporting context; flag stale items as 'remembered context'.\n\n",

    "## Tool & Capability Contract\n",
    "- Direct Response Principle: if conversation context, prior tool results, or verified facts already satisfy the request, answer directly without tools.\n",
    "- Mandatory Discovery Gate: call `search_sdk` before making any capability claim or refusal whenever the task may need runtime tools, files, browser/page interaction, code execution, or system access. Do not say a tool is unavailable until `search_sdk` has been tried in this turn. If results are weak and capability discovery remains the blocker, refine once with concrete action+target terms and call `search_sdk` one more time; otherwise state the real limitation or use the best available fallback.\n",
    "- `search_sdk` is a reserved capability-discovery primitive. Use the exact name `search_sdk`; do not substitute another tool just because its name also contains words like `search`, `find`, `lookup`, or `query`. Domain search tools (notes, docs, memory) search their own content and do not discover runtime tools.\n",
    "- At explicit decision gates, prefer `query_task_policy` over self-reflection for structured priors on discovery, capability_attach, execution, or verification.\n",
    "- Agent Skills Progressive Disclosure: when a relevant skill is surfaced, call `activate_skill` with its stable `skill_id` to load `SKILL.md`. Use `read_skill_resource` only for package-local references, examples, or scripts named by the activated skill. Use registered skill action tools for `llm-tool.yaml` actions. Use `shell_execute` only when the activated skill describes an actual CLI. Do not treat a recipe excerpt as the whole skill.\n",
    "- Delegation Contract: Use `delegate_task` only when the work is separable, bounded, and a relevant local task agent is available. Do not delegate simple direct answers or final user communication. Treat delegated_result as structured subtask output you integrate, not the final authority. Do not recursively orchestrate or ask the delegated agent to spawn more agents.\n",
    "- Ground all facts in conversation context or tool outputs. Never fabricate file paths, command outputs, or system state.\n",
    "- Error Recovery: when a tool call fails, read the error message, adjust parameters, and retry once with a different approach. If it fails again, report the error to the user with a brief diagnosis and suggest an alternative. Do not retry the identical call more than twice.\n\n",

    "## Delivery Style\n",
    "- Optimize for end-to-end completion in the minimum effective steps. Prefer the lightest applicable tool for each step.\n",
    "- For outcome-oriented requests (writing, creating, researching), output the final deliverable, not a meta-summary of your process.\n",
    "- Deliverable Inline Rule: when the user asks for a concrete artifact (HTML page, SVG, JSON, config file, code file, full document), the artifact itself IS the deliverable. If no tool produced a file or URL for it in this turn, you MUST inline the full content in a fenced code block (```html / ```svg / ```json / etc.). A descriptive summary of the artifact (\"the page has 4 sections, gradient background, responsive layout\") is NOT a substitute for the artifact.\n",
    "- Hallucination Guard: never say \"done\", \"generated\", \"created\", \"页面做好啦\", \"已生成\", or reference a filename / URL unless one of these is true in the SAME response: (a) a tool call this turn returned that artifact, (b) the full content is inline in a code block, or (c) a URL points to a real artifact your tools produced. If you only thought about generating it, say so and produce it now.\n",
    "- When a concept is materially clearer with a self-contained visual, emit a small SVG (diagrams, charts) or HTML (interactive layouts) demo. Skip visuals when prose alone is sufficient.\n",
    "- Ask a clarifying question only when a missing detail completely blocks discovery or delivery."
);

#[derive(Debug, Clone, Default)]
pub struct PromptAssets {
    system_messages: Vec<LocalChatInputMessage>,
}

impl PromptAssets {
    pub fn from_system_messages(system_messages: &[LocalChatInputMessage]) -> Self {
        Self {
            system_messages: system_messages.to_vec(),
        }
    }

    pub fn system_messages(&self) -> &[LocalChatInputMessage] {
        &self.system_messages
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RouterPromptLocalContext {
    pub current_date: String,
    pub timezone: String,
}

#[derive(Debug, Clone)]
pub struct PromptPlan {
    pub prelude_messages: Vec<LocalChatInputMessage>,
    pub local_context: RouterPromptLocalContext,
    pub response_language: String,
}

pub fn router_prompt_default_local_context() -> RouterPromptLocalContext {
    RouterPromptLocalContext {
        current_date: time::OffsetDateTime::now_utc()
            .format(&time::macros::format_description!("[year]-[month]-[day]"))
            .unwrap_or_else(|_| "unknown".to_string()),
        timezone: "UTC".to_string(),
    }
}

pub fn parse_router_prompt_local_context(raw: &str) -> Option<RouterPromptLocalContext> {
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

pub fn router_prompt_response_language_for_locale_pref(prefers_zh: bool) -> &'static str {
    if prefers_zh {
        "Simplified Chinese (zh-CN)"
    } else {
        "English (en)"
    }
}

pub fn render_local_router_base_prompt(
    current_date: &str,
    timezone: &str,
    response_language: &str,
) -> String {
    LOCAL_ROUTER_BASE_PROMPT_TEMPLATE
        .replace("{current_date}", current_date)
        .replace("{timezone}", timezone)
        .replace("{response_language}", response_language)
}

pub fn render_local_base_system_prompt(
    router_prompt: &str,
    code_mode_prompt: Option<&str>,
) -> String {
    let router_prompt = router_prompt.trim();
    let code_mode_prompt = code_mode_prompt
        .map(str::trim)
        .filter(|prompt| !prompt.is_empty());

    match (router_prompt.is_empty(), code_mode_prompt) {
        (true, Some(code_mode_prompt)) => {
            format!("## Execution Tool Protocol\n{}", code_mode_prompt)
        }
        (false, Some(code_mode_prompt)) => format!(
            "{}\n\n## Execution Tool Protocol\n{}",
            router_prompt, code_mode_prompt
        ),
        (false, None) => router_prompt.to_string(),
        (true, None) => String::new(),
    }
}

pub fn build_local_prompt_plan(
    prompt_assets: &PromptAssets,
    local_context: RouterPromptLocalContext,
    response_language: &str,
    base_system_prompt: &str,
) -> PromptPlan {
    PromptPlan {
        prelude_messages: build_local_prelude_messages(prompt_assets, base_system_prompt),
        local_context,
        response_language: response_language.to_string(),
    }
}

pub fn build_local_prelude_messages(
    prompt_assets: &PromptAssets,
    base_system_prompt: &str,
) -> Vec<LocalChatInputMessage> {
    let mut prelude_messages = Vec::new();
    if !base_system_prompt.trim().is_empty() {
        prelude_messages.push(LocalChatInputMessage {
            role: "system".to_string(),
            content: base_system_prompt.to_string(),
            reasoning_content: None,
            tool_calls: vec![],
            tool_call_id: None,
            name: None,
        });
    }
    prelude_messages.extend(prompt_assets.system_messages().iter().cloned());
    prelude_messages
}

#[cfg(test)]
mod tests {
    use super::render_local_router_base_prompt;

    #[test]
    fn local_router_prompt_strengthens_search_sdk_gate() {
        let prompt = render_local_router_base_prompt(
            "2026-03-27",
            "Asia/Shanghai",
            "Simplified Chinese (zh-CN)",
        );

        assert!(prompt.contains("Mandatory Discovery Gate"));
        assert!(prompt.contains("call `search_sdk` before making any capability claim or refusal"));
        assert!(prompt.contains("reserved capability-discovery primitive"));
        assert!(
            prompt.contains("name also contains words like `search`, `find`, `lookup`, or `query`")
        );
        assert!(prompt.contains("Do not say a tool is unavailable"));
    }

    #[test]
    fn local_router_prompt_bounds_search_sdk_retry_before_fallback() {
        let prompt = render_local_router_base_prompt(
            "2026-03-27",
            "Asia/Shanghai",
            "Simplified Chinese (zh-CN)",
        );

        assert!(prompt.contains("refine once with concrete action+target terms"));
        assert!(prompt.contains("call `search_sdk` one more time"));
        assert!(prompt.contains("state the real limitation or use the best available fallback"));
    }

    #[test]
    fn local_router_prompt_defines_skill_progressive_disclosure() {
        let prompt = render_local_router_base_prompt(
            "2026-04-23",
            "Asia/Shanghai",
            "Simplified Chinese (zh-CN)",
        );

        assert!(prompt.contains("Agent Skills Progressive Disclosure"));
        assert!(prompt.contains("call `activate_skill` with its stable `skill_id`"));
        assert!(prompt.contains("Use `read_skill_resource` only for package-local"));
        assert!(prompt
            .contains("Use `shell_execute` only when the activated skill describes an actual CLI"));
        assert!(prompt.contains("Do not treat a recipe excerpt as the whole skill"));
    }

    #[test]
    fn local_router_prompt_defines_delegation_contract() {
        let prompt = render_local_router_base_prompt(
            "2026-04-23",
            "Asia/Shanghai",
            "Simplified Chinese (zh-CN)",
        );

        assert!(prompt.contains("Delegation Contract"));
        assert!(prompt.contains("Use `delegate_task` only when the work is separable"));
        assert!(prompt.contains("Do not delegate simple direct answers"));
        assert!(prompt.contains("Treat delegated_result as structured subtask output"));
        assert!(prompt.contains("Do not recursively orchestrate"));
    }

    #[test]
    fn local_router_prompt_allows_visual_demo_when_helpful() {
        let prompt = render_local_router_base_prompt(
            "2026-03-27",
            "Asia/Shanghai",
            "Simplified Chinese (zh-CN)",
        );

        assert!(prompt.contains("emit a small SVG"));
        assert!(prompt.contains("HTML"));
        assert!(prompt.contains("Skip visuals when prose alone is sufficient"));
    }

    #[test]
    fn local_router_prompt_enforces_deliverable_inline_rule() {
        let prompt = render_local_router_base_prompt(
            "2026-05-22",
            "Asia/Shanghai",
            "Simplified Chinese (zh-CN)",
        );

        assert!(prompt.contains("Deliverable Inline Rule"));
        assert!(prompt.contains("inline the full content in a fenced code block"));
        assert!(prompt.contains("NOT a substitute for the artifact"));
    }

    #[test]
    fn local_router_prompt_blocks_completion_hallucination() {
        let prompt = render_local_router_base_prompt(
            "2026-05-22",
            "Asia/Shanghai",
            "Simplified Chinese (zh-CN)",
        );

        assert!(prompt.contains("Hallucination Guard"));
        assert!(prompt.contains("页面做好啦"));
        assert!(prompt.contains("已生成"));
        assert!(prompt.contains("If you only thought about generating it"));
    }
}
