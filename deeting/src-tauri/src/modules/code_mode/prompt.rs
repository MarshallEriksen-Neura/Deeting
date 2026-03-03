use std::collections::BTreeSet;
use std::path::PathBuf;

const DEFAULT_CODE_MODE_CAPABILITY_PROMPT: &str = "**Code Mode Capability (MANDATORY)**:\n**In Code Mode, direct tool calls are blocked for most tools. Only these tools may be called directly: {{allowed_direct_tools}}. Direct calls to blocked tools WILL BE BLOCKED and return an error.**\n\nRequired workflow:\n1) Use `search_sdk` to discover precise tool signatures.\n2) Produce one coherent Python execution plan using discovered tools.\n3) Execute once with `execute_code_plan`.\n\nConventions:\n- Prefer `from deeting_sdk import <tool_name>` when available.\n- Or call tools with `deeting.call_tool(name, **kwargs)`.\n- Do NOT pass positional dict args like `deeting.call_tool(name, {...})`.\n- Always emit final structured output with `deeting.log(json.dumps(result, ensure_ascii=False))`.\n";

fn prompt_template_path() -> PathBuf {
    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.push("..");
    path.push("..");
    path.push("packages");
    path.push("code-mode-contract");
    path.push("prompts");
    path.push("code-mode-capability.md");
    path
}

pub fn render_code_mode_capability_prompt(allowed_direct_tools: &[String]) -> String {
    let template = std::fs::read_to_string(prompt_template_path())
        .ok()
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
        .unwrap_or_else(|| DEFAULT_CODE_MODE_CAPABILITY_PROMPT.to_string());

    let mut normalized = BTreeSet::new();
    for name in allowed_direct_tools {
        let trimmed = name.trim().to_lowercase();
        if !trimmed.is_empty() {
            normalized.insert(trimmed);
        }
    }
    if normalized.is_empty() {
        normalized.insert("search_sdk".to_string());
        normalized.insert("execute_code_plan".to_string());
    }
    let rendered_tools = normalized
        .into_iter()
        .map(|name| format!("`{name}`"))
        .collect::<Vec<String>>()
        .join(", ");

    template.replace("{{allowed_direct_tools}}", &rendered_tools)
}

#[cfg(test)]
mod tests {
    use super::render_code_mode_capability_prompt;

    #[test]
    fn render_prompt_replaces_allowlist_placeholder() {
        let prompt = render_code_mode_capability_prompt(&[
            "search_sdk".to_string(),
            "execute_code_plan".to_string(),
        ]);
        assert!(prompt.contains("`search_sdk`"));
        assert!(prompt.contains("`execute_code_plan`"));
        assert!(!prompt.contains("{{allowed_direct_tools}}"));
    }
}
