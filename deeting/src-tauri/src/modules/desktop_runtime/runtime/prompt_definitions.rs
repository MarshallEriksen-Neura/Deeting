use super::prompt_assets::PromptAssets;
use mcp_core::types::LocalChatInputMessage;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WorldModelUpdatePromptMode {
    Off,
    AllowedDelta,
    RequiredDelta,
    RequiredFull,
}

const COMMUNICATION_STYLE_PROMPT: &str = concat!(
    "Tool calls render as live cards in the UI; your final reply renders as assistant text. Communicate around them with this discipline.\n",
    "\n",
    "Before tools:\n",
    "1. Read-only tools (search, read_file, list, grep, fetch_url): do not pre-announce. The tool card already documents the action.\n",
    "2. Side-effect tools (write, execute, send, modify state, paid external API): emit ONE short sentence stating what you are about to do AND why. Not a paragraph.\n",
    "3. A batch of related tools fired back-to-back (e.g. reading 5 files to map an interface): narrate the intent ONCE before the batch, not before each call.\n",
    "4. Emit pre-tool notes as regular assistant text immediately before the tool call, not as a separate empty update.\n",
    "\n",
    "After tools (final reply):\n",
    "1. Do not recap which tools you called or what they returned — the tool cards already show that.\n",
    "2. Do not write meta-narrative like \"Based on my research above\", \"In summary, I have done X, Y, Z\", \"综上所述\", \"经过以上分析\". State the conclusion or answer directly.\n",
    "3. If the answer is a single fact or short conclusion, write it in one or two sentences — do not pad with unnecessary structure or repetition. Depth of content is controlled by response style; this rule is about expression efficiency, not content volume.\n",
    "4. Only add structure (headings, lists) when the answer genuinely has multiple parallel parts. A single conclusion does not need a heading.\n",
    "\n",
    "Always:\n",
    "- Never start a tool call or a final reply with filler openers (\"let me check\", \"I'll help you with that\", \"好的\", \"OK\", \"Sure\", \"我来...\"). Start with substance."
);

pub(crate) fn render_local_runtime_system_prompt(
    router_prompt: &str,
    runtime_capability_prompt: Option<&str>,
    execution_tool_prompt: Option<&str>,
) -> String {
    let mut sections = Vec::new();
    let router_prompt = router_prompt.trim();
    if !router_prompt.is_empty() {
        sections.push(format!(
            "<base_router_prompt>\n{}\n</base_router_prompt>",
            router_prompt
        ));
    }

    if let Some(prompt) = runtime_capability_prompt
        .map(str::trim)
        .filter(|prompt| !prompt.is_empty())
    {
        sections.push(format!(
            "<runtime_capability_contract>\n## Runtime Capability Contract\n{}\n</runtime_capability_contract>",
            prompt
        ));
    }

    if let Some(prompt) = execution_tool_prompt
        .map(str::trim)
        .filter(|prompt| !prompt.is_empty())
    {
        sections.push(format!(
            "<execution_tool_protocol>\n## Execution Tool Protocol\n{}\n</execution_tool_protocol>",
            prompt
        ));
    }

    sections.join("\n\n")
}

pub(crate) fn render_local_communication_style_prompt() -> String {
    format!(
        "<communication_style>\n## Communication Style\n{}\n</communication_style>",
        COMMUNICATION_STYLE_PROMPT
    )
}

pub(crate) fn local_communication_style_message() -> LocalChatInputMessage {
    LocalChatInputMessage {
        role: "system".to_string(),
        content: render_local_communication_style_prompt(),
        reasoning_content: None,
        tool_calls: vec![],
        tool_call_id: None,
        name: None,
    }
}

pub(crate) fn with_communication_style_message(prompt_assets: &PromptAssets) -> PromptAssets {
    let mut system_messages = vec![local_communication_style_message()];
    system_messages.extend(prompt_assets.system_messages().iter().cloned());
    PromptAssets::from_system_messages(&system_messages)
}

pub(crate) fn render_desktop_execution_tools_injection_prompt() -> String {
    concat!(
        "## Desktop Execution Tools\n",
        "- Environment: Deeting Desktop local runtime\n",
        "- Follow the base Agent Skills Progressive Disclosure contract for skill discovery, activation, resource reading, and execution boundaries.\n",
    )
    .to_string()
}

pub(crate) fn render_world_model_runtime_context(
    prompt_mode: WorldModelUpdatePromptMode,
) -> String {
    if matches!(prompt_mode, WorldModelUpdatePromptMode::Off) {
        return "[WORLD MODEL UPDATE PROTOCOL]\nDo not call world_model_update for this response unless a later instruction in this request explicitly requires it.".to_string();
    }

    let (mode_hint, requirement, mode_instruction) = match prompt_mode {
        WorldModelUpdatePromptMode::RequiredFull => (
            "full",
            "Required: call world_model_update tool in the same turn as your visible response.",
            "Provide a complete assessment: all known facts, assumptions, unknowns, verification targets, rules, and execution_strategy.",
        ),
        WorldModelUpdatePromptMode::RequiredDelta => (
            "delta",
            "Required: call world_model_update tool in the same turn as your visible response because runtime state changed.",
            "Only include NEW or CHANGED items since the last snapshot. Leave arrays empty if nothing changed.",
        ),
        WorldModelUpdatePromptMode::AllowedDelta => (
            "delta",
            "Optional: call world_model_update tool only if this response changes the task model.",
            "Only include NEW or CHANGED items since the last snapshot. Omit the tool call when nothing changed.",
        ),
        WorldModelUpdatePromptMode::Off => unreachable!("off mode returned above"),
    };

    format!(
        "[WORLD MODEL UPDATE PROTOCOL]\n\
         {requirement}\n\
         Mode: {mode}\n\
         {mode_instruction}\n\n\
         Tool: world_model_update\n\
         This is a meta-protocol tool - you don't wait for a response. Call it in the same turn as your visible text response.\n\n\
         Parameters:\n\
         {{\n  \"facts\": [\"confirmed facts about the task/project\"],\n  \"assumptions\": [\"unverified beliefs\"],\n  \"resolved_unknowns\": [\"questions now answered\"],\n  \"new_unknowns\": [\"new questions discovered\"],\n  \"verification_targets\": [\"conditions that must be true when done\"],\n  \"rules\": [\"constraints to follow\"],\n  \"execution_strategy\": \"direct_iteration | delegated_workflow | delegated_agent | hybrid\",\n  \"proposed_next_phase\": {{ \"step_type\": \"...\", \"rationale\": \"...\" }}\n}}\n\n\
         Rules:\n\
         - execution_strategy: only include when you believe the current strategy should change.\n\
         - proposed_next_phase: only include when you have a clear next step.\n\
         - Write string values in the user's current conversation language when possible; keep JSON keys exactly as shown.\n\
         - Keep entries concise. Each item should be one sentence.",
        mode = mode_hint,
        requirement = requirement,
        mode_instruction = mode_instruction,
    )
}

pub(crate) fn render_world_model_system_context(
    snapshot: &str,
    prompt_mode: WorldModelUpdatePromptMode,
) -> String {
    let runtime_context = render_world_model_runtime_context(prompt_mode);
    if runtime_context.trim().is_empty() {
        format!("[System runtime context — not user input]\n{snapshot}\n[/System runtime context]")
    } else {
        format!(
            "[System runtime context — not user input]\n{snapshot}\n\n{runtime_context}\n[/System runtime context]"
        )
    }
}

pub(crate) fn compact_replayed_system_prompt_content(content: &str) -> Option<String> {
    let trimmed = content.trim();
    if trimmed.starts_with("<base_router_prompt>")
        || trimmed.starts_with("<communication_style>")
        || trimmed.starts_with("## Desktop Execution Tools")
    {
        return Some(
            "[protocol_ref]\n\
             desktop-local-runtime@v2, communication-style@v2, tool-capability-contract@v2, execution-tool-protocol@v2\n\
             Static protocol text was provided earlier in this request. Continue following it. Dynamic tool allowlists, context manifests, skill candidates, and user messages below remain authoritative."
                .to_string(),
        );
    }
    None
}
