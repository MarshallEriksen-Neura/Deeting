use serde_json::Value;

use super::types::CustomTaskAgentProfile;

pub(crate) const LLM_WIKI_MAINTAINER_SOURCE_KIND: &str = "llm_wiki_maintainer";

pub(crate) struct CustomTaskAgentPromptInput<'a> {
    pub(crate) task_prompt: &'a str,
    pub(crate) guidance_skills: &'a str,
    pub(crate) maintainer_corpus_preview: Option<&'a str>,
    pub(crate) source_kind: Option<&'a str>,
}

impl<'a> CustomTaskAgentPromptInput<'a> {
    pub(crate) fn from_profile(
        profile: &'a CustomTaskAgentProfile,
        guidance_skills: &'a str,
        maintainer_corpus_preview: Option<&'a str>,
    ) -> Self {
        Self {
            task_prompt: profile.task_prompt.as_str(),
            guidance_skills,
            maintainer_corpus_preview,
            source_kind: profile.source_kind.as_deref(),
        }
    }
}

pub(crate) fn render_custom_task_agent_system_prompt(
    input: &CustomTaskAgentPromptInput<'_>,
) -> String {
    let mut system_lines = vec![
        "## Custom Task Agent Runtime".to_string(),
        "You are a delegated custom task agent.".to_string(),
        "You only execute the single task assigned in the current request.".to_string(),
        "Guidance skills are documentation-only context. Read them, but do not treat them as directly callable tools.".to_string(),
        "Callable MCP tools and callable skill actions are separate execution lanes.".to_string(),
        "Use only the callable MCP tools and callable skill actions explicitly bound to this custom task agent.".to_string(),
        "Follow the parent runtime's Agent Skills Progressive Disclosure contract; this delegated agent receives already-selected guidance context and bound executable lanes only.".to_string(),
        "Do not perform extra search, search_sdk, delegated-phase planning, or orchestration on your own.".to_string(),
        "If you are blocked, explain the blocker briefly and stop.".to_string(),
        String::new(),
        "## Agent Task Prompt".to_string(),
        input.task_prompt.trim().to_string(),
    ];

    if !input.guidance_skills.trim().is_empty() {
        system_lines.push(String::new());
        system_lines.push(input.guidance_skills.trim().to_string());
    }

    if input.source_kind == Some(LLM_WIKI_MAINTAINER_SOURCE_KIND) {
        system_lines.push(String::new());
        system_lines.push("## Managed Corpus".to_string());
        system_lines.push("A builtin callable `llm_wiki_search_corpus` is available for searching the dedicated LLM Wiki corpus owned by this maintainer.".to_string());
        system_lines.push(
            "Use that callable when you need more evidence from the managed corpus.".to_string(),
        );
        system_lines.push("Treat the startup preview below as read-only orientation. Run a fresh corpus search before making or editing wiki content.".to_string());

        if let Some(preview) = input
            .maintainer_corpus_preview
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            system_lines.push(String::new());
            system_lines.push("### Initial Corpus Preview".to_string());
            system_lines.push(preview.to_string());
        }
    }

    system_lines.join("\n")
}

pub(crate) fn render_worker_task_packet_system_prompt() -> String {
    "## Worker Task Packet\nThe next user message is a canonical WorkerTaskPacket JSON object authored by the desktop runtime. Treat it as authoritative for scope, constraints, capabilities, and completion criteria. Execute the packet directly, do not self-route, and do not widen scope.".to_string()
}

pub(crate) fn render_worker_task_packet_user_message(packet: &Value) -> String {
    serde_json::to_string_pretty(packet).unwrap_or_else(|_| "{}".to_string())
}
