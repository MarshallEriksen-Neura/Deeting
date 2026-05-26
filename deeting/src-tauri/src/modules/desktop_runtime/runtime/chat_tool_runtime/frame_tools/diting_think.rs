use desktop_runtime_core::ExecutionStrategy;
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub(crate) const DITING_THINK_TOOL_NAME: &str = "diting_think";

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct DitingThinkExtract {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub intent: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub execution_strategy: Option<ExecutionStrategy>,
    pub facts: Vec<String>,
    pub assumptions: Vec<String>,
    pub verification_targets: Vec<String>,
    pub rules: Vec<String>,
}

pub(crate) fn parse_diting_think_arguments(args: &Value) -> DitingThinkExtract {
    let intent = args
        .get("intent")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let execution_strategy = args
        .get("execution_strategy")
        .and_then(Value::as_str)
        .and_then(parse_execution_strategy);
    let facts = args
        .get("context_assessment")
        .and_then(Value::as_str)
        .map(split_sentences)
        .unwrap_or_default();
    let assumptions = facts
        .iter()
        .filter(|sentence| is_assumption_sentence(sentence))
        .cloned()
        .collect();
    let verification_targets = args
        .get("tool_plan")
        .and_then(Value::as_str)
        .map(split_step_entries)
        .unwrap_or_default();
    let rules = args
        .get("constraints")
        .and_then(Value::as_str)
        .map(split_step_entries)
        .unwrap_or_default();

    DitingThinkExtract {
        intent,
        execution_strategy,
        facts,
        assumptions,
        verification_targets,
        rules,
    }
}

fn parse_execution_strategy(value: &str) -> Option<ExecutionStrategy> {
    match value.trim().to_ascii_lowercase().as_str() {
        "direct_iteration" | "directiteration" | "direct" => {
            Some(ExecutionStrategy::DirectIteration)
        }
        "delegated_workflow" | "delegatedworkflow" | "workflow" => {
            Some(ExecutionStrategy::DelegatedWorkflow)
        }
        "delegated_agent" | "delegatedagent" | "agent" | "worker" => {
            Some(ExecutionStrategy::DelegatedAgent)
        }
        "hybrid" => Some(ExecutionStrategy::Hybrid),
        _ => None,
    }
}

fn split_sentences(input: &str) -> Vec<String> {
    input
        .split(|ch| matches!(ch, '.' | '。' | ';' | '；'))
        .map(clean_entry)
        .filter(|entry| !entry.is_empty())
        .collect()
}

fn split_step_entries(input: &str) -> Vec<String> {
    input
        .lines()
        .flat_map(|line| line.split(|ch| matches!(ch, '.' | '。' | ';' | '；')))
        .map(clean_entry)
        .filter(|entry| !entry.is_empty())
        .collect()
}

fn clean_entry(value: &str) -> String {
    value
        .trim()
        .trim_start_matches(|ch: char| {
            ch.is_ascii_digit()
                || matches!(ch, '-' | '*' | '+' | ')' | '(' | ':' | '：' | '、')
                || ch.is_whitespace()
        })
        .trim()
        .to_string()
}

fn is_assumption_sentence(sentence: &str) -> bool {
    let normalized = sentence.to_ascii_lowercase();
    sentence.contains("假设")
        || sentence.contains("可能")
        || normalized.contains("likely")
        || normalized.contains("assume")
}

pub(crate) fn inject_diting_think_tool(
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
                    "execution_strategy": {
                        "type": "string",
                        "enum": ["direct_iteration", "delegated_workflow", "delegated_agent", "hybrid"],
                        "description": "Recommended execution strategy for this frame. Use direct_iteration for simple single-threaded chat, delegated_workflow for multi-step workflow orchestration, delegated_agent for worker delegation, and hybrid when tool use plus coordination are both required."
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

pub(crate) fn format_diting_think_reasoning(arguments: &serde_json::Value) -> String {
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
    if let Some(strategy) = arguments
        .get("execution_strategy")
        .and_then(|v| v.as_str())
        .filter(|v| !v.trim().is_empty())
    {
        parts.push(format!("[执行策略] {}", strategy.trim()));
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_diting_think_arguments_accepts_execution_strategy() {
        let extract = parse_diting_think_arguments(&serde_json::json!({
            "intent": "change config",
            "execution_strategy": "delegated_workflow",
            "context_assessment": "Need multiple dependent steps.",
            "tool_plan": "1. read file\n2. write file",
            "constraints": "Keep changes narrow",
        }));

        assert_eq!(
            extract.execution_strategy,
            Some(ExecutionStrategy::DelegatedWorkflow)
        );
        assert_eq!(extract.intent.as_deref(), Some("change config"));
    }

    #[test]
    fn parse_diting_think_arguments_ignores_unknown_execution_strategy() {
        let extract = parse_diting_think_arguments(&serde_json::json!({
            "intent": "answer",
            "execution_strategy": "made_up_strategy",
            "tool_plan": "answer directly",
        }));

        assert_eq!(extract.execution_strategy, None);
    }
}
