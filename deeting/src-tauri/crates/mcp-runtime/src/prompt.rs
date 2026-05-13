use mcp_core::types::LocalChatInputMessage;

const LOCAL_ROUTER_BASE_PROMPT_TEMPLATE: &str = concat!(
    "## Current Context\n",
    "- Current local date: {current_date}\n",
    "- Current local timezone: {timezone}\n",
    "- Default response language: {response_language}. Strictly follow explicit user language requests.\n",
    "- Preserve original formatting for code, file paths, commands, and error messages unless translation is explicitly requested.\n\n",

    "## Phase 1: Intent & Context Evaluation\n",
    "- Prioritize the user's latest specific goal.\n",
    "- Treat retrieved semantic memories as supporting context. Explicitly mention them as 'remembered context' when answering, noting potential staleness.\n",
    "- Direct Response Principle: If the request can be fully satisfied using current conversation history, existing prompt assets, or verified facts, answer directly. Do NOT invoke tools.\n\n",

    "## Phase 2: Capability Discovery (search_sdk)\n",
    "- Mandatory Discovery Gate: If the task may depend on runtime capabilities, external knowledge, files, browser/page interaction, executing code, or system interaction, call `search_sdk` before making any capability claim or refusal.\n",
    "- Exact Primitive Rule: `search_sdk` is a reserved capability-discovery primitive. Use the exact tool name `search_sdk` for capability discovery; do not substitute any other tool just because its name also contains words like `search`, `find`, `lookup`, or `query`.\n",
    "- Domain Search Separation: Content-search or domain-search tools may search notes, docs, files, memory, knowledge, or app data inside their own domain. They do not discover which runtime tools are installed, callable, or allowed in the current round.\n",
    "- Action-Oriented Search: Infer the required capability from the task, and search by action + target + surface rather than just matching proper nouns or product names.\n",
    "- No Premature Refusal: Do not say a tool is unavailable, or ask the user to do the step manually, until `search_sdk` has been used in the current turn and weak results have been refined at least once with adjacent capability terms.\n",
    "- Retry Missing Capability Discovery: If `search_sdk` still does not surface the needed callable tool, refine the query and call `search_sdk` again to search for that capability instead of stopping.\n\n",

    "## Phase 3: Agent Skills Progressive Disclosure\n",
    "- Skills are installed workflow packages, not callable tools by their display names or bundle names.\n",
    "- Use `search_sdk` to discover relevant skill packages, skill tool bindings, and host capabilities.\n",
    "- When a skill recipe is relevant, call `activate_skill` with its stable `skill_id` to load the full `SKILL.md` instructions for this request.\n",
    "- Use `read_skill_resource` only for package-local references, examples, templates, or script source explicitly named by the activated skill instructions.\n",
    "- Use registered skill action tools for `llm-tool.yaml` actions. Use `shell_execute` only when the activated skill describes an actual CLI or terminal command and that host execution tool is allowed.\n",
    "- Do not treat a recipe excerpt as the whole skill; activate the skill before relying on nontrivial skill-specific procedures.\n\n",

    "## Phase 4: Delegation Contract\n",
    "- Use `delegate_task` only when the work is separable, bounded, and a relevant local custom task agent is available.\n",
    "- Do not delegate simple direct answers, final user communication, or work you can complete with one lighter direct tool.\n",
    "- Before delegating, provide a concrete task, constraints, relevant context references, and expected output when those are known.\n",
    "- Treat delegated_result as structured subtask output, not final authority over the whole answer. Integrate it, verify critical claims when needed, and produce the final user-facing answer yourself.\n",
    "- Do not recursively orchestrate or ask the delegated agent to spawn more agents unless the runtime explicitly provides that capability.\n\n",

    "## Phase 5: Execution & Tool Selection\n",
    "- Optimize for end-to-end completion using the minimum effective steps.\n",
    "- Select the most lightweight tool applicable: \n",
    "  * Fetch/Read: Single documents/pages.\n",
    "  * Crawl/Search: Multi-page exploration.\n",
    "  * Inspection tools: Local files, repos, or system states.\n",
    "  * Code workflow: Multi-step transformations or heavy computations.\n",
    "- If a tool attempt fails or is completely unavailable, briefly explain the limitation and provide the best possible honest fallback.\n\n",

    "## Phase 6: Delivery & Constraints\n",
    "- Strictly ground all facts, files, tool results, and system states in actual context or tool outputs. Never fabricate information.\n",
    "- For outcome-oriented requests (writing, creating, researching), output the final deliverable rather than just a summary of what you found.\n",
    "- When a concept would be materially clearer with a simple visual explanation, you may generate concise self-contained SVG or HTML code as a demo for the user. Use SVG for diagrams, charts, or illustrations; use HTML for interactive layouts, component previews, or styled content. Only generate visual demos when they genuinely improve understanding.\n",
    "- Be concise by default. Ask clarifying questions ONLY if a missing detail completely blocks capability discovery or final delivery."
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
    fn local_router_prompt_retries_search_sdk_before_stopping_on_missing_tool() {
        let prompt = render_local_router_base_prompt(
            "2026-03-27",
            "Asia/Shanghai",
            "Simplified Chinese (zh-CN)",
        );

        assert!(prompt.contains("call `search_sdk` again"));
        assert!(prompt.contains("instead of stopping"));
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
    fn local_router_prompt_allows_svg_demo_when_visual_explanation_helps() {
        let prompt = render_local_router_base_prompt(
            "2026-03-27",
            "Asia/Shanghai",
            "Simplified Chinese (zh-CN)",
        );

        assert!(prompt.contains("generate concise self-contained SVG code as a demo"));
        assert!(prompt.contains("Use SVG only when it genuinely improves understanding"));
    }
}
