use std::collections::BTreeSet;
use std::path::PathBuf;

const DEFAULT_CODE_MODE_CAPABILITY_PROMPT: &str = "**Code Mode Capability (MANDATORY)**:\n**In Code Mode, direct tool calls are blocked for most tools. Only these tools may be called directly: {{allowed_direct_tools}}. Direct calls to blocked tools WILL BE BLOCKED and return an error.**\n\n## When to Use Code Mode\nUse Code Mode only when the task requires tool discovery, execution, installation, file or system changes, or expert capability attachment.\n\n## Required Workflow\nRequired workflow:\n1) If expert capability may help, call `consult_expert_network` to inspect candidates.\n2) Explicitly call `attach_capability` before attaching request-scoped expert capability.\n3) Use installed skill documentation or `search_sdk` recipes to understand available skill bundles.\n4) Use `search_sdk` direct capabilities only for real host tools that are explicitly surfaced as callable.\n5) Produce one coherent Python execution plan.\n6) Execute once with `execute_code_plan`.\n7) Summarize what you changed, the key result, and any blocker or next step.\n\n## Behavior Rules\nBehavior rules:\n- Treat skills as docs-first guidance bundles, not as direct tools.\n- Answer directly instead of using Code Mode when no execution or tool interaction is needed.\n- If required inputs, permissions, or tools are missing, stop and report the blocker instead of guessing.\n- Do not keep looping once enough evidence or results have been obtained.\n- Attach expert capability only when a specialist materially improves the task, and use `detach_capability` when returning to the default capability-neutral context.\n\n## Execution Safety\nConventions:\n- Prefer `from deeting_sdk import <tool_name>` only for direct callable host tools.\n- Or call direct tools with `deeting.call_tool(name, **kwargs)`.\n- Do NOT assume a skill bundle name is a callable tool name.\n- Do NOT pass positional dict args like `deeting.call_tool(name, {...})`.\n- Before any destructive or high-risk command, verify the current environment and working directory first.\n- Before modifying or deleting files, print or otherwise confirm the current working directory and the exact target path.\n- Preview the target before destructive changes when possible (for example by listing the directory or inspecting the file first).\n- Never use broad destructive targets like `rm -rf *`; always specify the exact file or directory path you intend to modify or remove.\n\n## Output Contract\n- Always emit final structured output with `deeting.log(json.dumps(result, ensure_ascii=False))`.\n";

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

    #[test]
    fn render_prompt_includes_destructive_command_safety_guard() {
        let prompt = render_code_mode_capability_prompt(&["execute_code_plan".to_string()]);

        assert!(prompt.contains("verify the current environment and working directory first"));
        assert!(prompt.contains("confirm the current working directory and the exact target path"));
        assert!(prompt.contains("Preview the target before destructive changes when possible"));
        assert!(prompt.contains("Never use broad destructive targets like `rm -rf *`"));
        assert!(prompt.contains("specify the exact file or directory path"));
    }

    #[test]
    fn render_prompt_includes_code_mode_usage_and_stop_rules() {
        let prompt = render_code_mode_capability_prompt(&["search_sdk".to_string()]);

        assert!(prompt.contains("## When to Use Code Mode"));
        assert!(prompt.contains("## Required Workflow"));
        assert!(prompt.contains("## Behavior Rules"));
        assert!(prompt.contains("## Execution Safety"));
        assert!(prompt.contains("## Output Contract"));
        assert!(prompt.contains("Use Code Mode only when the task requires tool discovery"));
        assert!(prompt.contains("call `consult_expert_network` to inspect candidates"));
        assert!(prompt.contains(
            "Explicitly call `attach_capability` before attaching request-scoped expert capability"
        ));
        assert!(prompt
            .contains("Summarize what you changed, the key result, and any blocker or next step"));
        assert!(prompt.contains("If required inputs, permissions, or tools are missing, stop and report the blocker instead of guessing"));
        assert!(prompt
            .contains("Do not keep looping once enough evidence or results have been obtained"));
        assert!(prompt.contains("Treat skills as docs-first guidance bundles, not as direct tools"));
    }
}
