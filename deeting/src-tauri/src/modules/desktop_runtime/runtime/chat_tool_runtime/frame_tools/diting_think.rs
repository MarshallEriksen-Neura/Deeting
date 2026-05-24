pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) const DITING_THINK_TOOL_NAME: &str = "diting_think";

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn inject_diting_think_tool(
    tools: Option<serde_json::Value>,
) -> Option<serde_json::Value> {
    let diting_think_entry = serde_json::json!({
        "type": "function",
        "function": {
            "name": DITING_THINK_TOOL_NAME,
            "description": "Structured deep-reasoning tool. Call this ONCE before executing any other tool when the task involves multi-step execution, ambiguous intent, or coordination across multiple capabilities. Analyze the user intent against the currently available tools and context, then output a concrete execution plan. Do NOT call this for trivial single-tool tasks. This tool is only available in the first round and disappears afterward.",
            "parameters": {
                "type": "object",
                "properties": {
                    "intent": {
                        "type": "string",
                        "description": "One-sentence summary of the user's core intent."
                    },
                    "context_assessment": {
                        "type": "string",
                        "description": "Relevant context already available: injected memories, prior conversation state, discovered capabilities. What do you already know that matters?"
                    },
                    "tool_plan": {
                        "type": "string",
                        "description": "Which tools to call, in what order, with what arguments. Be specific \u{2014} name exact tools and justify the sequence."
                    },
                    "constraints": {
                        "type": "string",
                        "description": "Key risks, edge cases, permission boundaries, or scope limits that could derail execution."
                    }
                },
                "required": ["intent", "tool_plan"]
            }
        }
    });
    match tools {
        Some(mut value) => {
            if let Some(arr) = value.get_mut("tools").and_then(|v| v.as_array_mut()) {
                arr.insert(0, diting_think_entry);
            }
            Some(value)
        }
        None => Some(serde_json::json!({ "tools": [diting_think_entry] })),
    }
}

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn format_diting_think_reasoning(arguments: &serde_json::Value) -> String {
    let mut parts = Vec::new();
    if let Some(intent) = arguments
        .get("intent")
        .and_then(|v| v.as_str())
        .filter(|v| !v.trim().is_empty())
    {
        parts.push(format!("[意图] {}", intent.trim()));
    }
    if let Some(context) = arguments
        .get("context_assessment")
        .and_then(|v| v.as_str())
        .filter(|v| !v.trim().is_empty())
    {
        parts.push(format!("[上下文] {}", context.trim()));
    }
    if let Some(plan) = arguments
        .get("tool_plan")
        .and_then(|v| v.as_str())
        .filter(|v| !v.trim().is_empty())
    {
        parts.push(format!("[执行计划] {}", plan.trim()));
    }
    if let Some(constraints) = arguments
        .get("constraints")
        .and_then(|v| v.as_str())
        .filter(|v| !v.trim().is_empty())
    {
        parts.push(format!("[约束] {}", constraints.trim()));
    }
    parts.join("\n")
}
