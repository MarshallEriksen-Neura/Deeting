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
    "- Proactive Discovery: If the task requires external knowledge, files, executing code, or system interaction, use `search_sdk` proactively to discover available tools/skills before answering.\n",
    "- Semantic Matching: Infer the required capability from the task, rather than just matching proper nouns or product names.\n",
    "- Exhaustive Search: If initial `search_sdk` results are weak, refine the query and try adjacent capability terms before concluding a tool is unavailable.\n\n",

    "## Phase 3: Execution & Tool Selection\n",
    "- Optimize for end-to-end completion using the minimum effective steps.\n",
    "- Select the most lightweight tool applicable: \n",
    "  * Fetch/Read: Single documents/pages.\n",
    "  * Crawl/Search: Multi-page exploration.\n",
    "  * Inspection tools: Local files, repos, or system states.\n",
    "  * Code workflow: Multi-step transformations or heavy computations.\n",
    "- If a tool attempt fails or is completely unavailable, briefly explain the limitation and provide the best possible honest fallback.\n\n",

    "## Phase 4: Delivery & Constraints\n",
    "- Strictly ground all facts, files, tool results, and system states in actual context or tool outputs. Never fabricate information.\n",
    "- For outcome-oriented requests (writing, creating, researching), output the final deliverable rather than just a summary of what you found.\n",
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
    pub response_language: &'static str,
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
        (true, Some(code_mode_prompt)) => format!("## Code Mode Protocol\n{}", code_mode_prompt),
        (false, Some(code_mode_prompt)) => format!(
            "{}\n\n## Code Mode Protocol\n{}",
            router_prompt, code_mode_prompt
        ),
        (false, None) => router_prompt.to_string(),
        (true, None) => String::new(),
    }
}

pub fn build_local_prompt_plan(
    prompt_assets: &PromptAssets,
    local_context: RouterPromptLocalContext,
    response_language: &'static str,
    base_system_prompt: &str,
) -> PromptPlan {
    PromptPlan {
        prelude_messages: build_local_prelude_messages(prompt_assets, base_system_prompt),
        local_context,
        response_language,
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
            tool_calls: vec![],
            tool_call_id: None,
            name: None,
        });
    }
    prelude_messages.extend(prompt_assets.system_messages().iter().cloned());
    prelude_messages
}
