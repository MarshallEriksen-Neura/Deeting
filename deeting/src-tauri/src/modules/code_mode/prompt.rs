use std::collections::BTreeSet;

const DEFAULT_RUNTIME_CAPABILITY_PROMPT: &str = "The model-callable tools for this round are: {{allowed_tools}}.\n\n- Tool discovery and invocation rules are defined in the Tool & Capability Contract above. The allowlist here defines what is callable this round.\n- `query_task_policy` returns bounded prior hints for discovery, capability_attach, execution, or verification. Treat hints as advisory metadata; they must not create a new user goal, replace the user's requested deliverable, or make you narrate verification unless the user explicitly asked for it.\n- If a capability has `status.callable=true` and `invocation_mode=\"direct\"` and it appears in this round's allowed tools, treat it as executable.\n- Prefer the lightest direct tool that finishes the task; when multiple direct tools match, choose the most specific to user intent.\n- Do not invent tool names from labels or summaries. Do not pass positional dict args like `deeting.call_tool(name, {...})`.\n- Do not claim you cannot inspect the local machine, filesystem, terminal, or installed software when a relevant callable direct capability is already in this allowlist.\n- If a required capability is absent from the allowlist, explain the real limitation briefly and use the best available fallback.\n";

const EXECUTION_TOOL_PROMPT_TEMPLATE: &str =
    include_str!("../../../../../packages/code-mode-contract/prompts/code-mode-capability.md");

fn normalize_allowed_tools(allowed_tools: &[String]) -> Vec<String> {
    let mut normalized = BTreeSet::new();
    for name in allowed_tools {
        let trimmed = name.trim().to_lowercase();
        if !trimmed.is_empty() {
            normalized.insert(trimmed);
        }
    }
    if normalized.is_empty() {
        normalized.insert("search_sdk".to_string());
    }
    normalized.into_iter().collect()
}

pub fn render_runtime_capability_prompt(allowed_tools: &[String]) -> String {
    let rendered_tools = normalize_allowed_tools(allowed_tools)
        .into_iter()
        .map(|name| format!("`{name}`"))
        .collect::<Vec<String>>()
        .join(", ");

    DEFAULT_RUNTIME_CAPABILITY_PROMPT.replace("{{allowed_tools}}", &rendered_tools)
}

pub fn render_execution_tool_prompt(allowed_tools: &[String]) -> String {
    let rendered_tools = normalize_allowed_tools(allowed_tools)
        .into_iter()
        .map(|name| format!("`{name}`"))
        .collect::<Vec<String>>()
        .join(", ");

    EXECUTION_TOOL_PROMPT_TEMPLATE
        .replace("{{allowed_direct_tools}}", &rendered_tools)
        .replace("{{allowed_tools}}", &rendered_tools)
}

#[cfg(test)]
mod tests {
    use super::{render_execution_tool_prompt, render_runtime_capability_prompt};

    #[test]
    fn render_runtime_prompt_replaces_allowlist_placeholder() {
        let prompt = render_runtime_capability_prompt(&[
            "search_sdk".to_string(),
            "shell_execute".to_string(),
        ]);
        assert!(prompt.contains("`search_sdk`"));
        assert!(prompt.contains("`shell_execute`"));
        assert!(!prompt.contains("{{allowed_tools}}"));
    }

    #[test]
    fn render_execution_tool_prompt_references_runtime_capability_contract() {
        let prompt = render_execution_tool_prompt(&[
            "search_sdk".to_string(),
            "execute_code_plan".to_string(),
        ]);
        assert!(prompt.contains("Runtime Capability Contract"));
        assert!(!prompt.contains("{{allowed_direct_tools}}"));
        assert!(!prompt.contains("{{allowed_tools}}"));
    }

    #[test]
    fn render_execution_tool_prompt_includes_destructive_command_safety_guard() {
        let prompt = render_execution_tool_prompt(&["execute_code_plan".to_string()]);

        assert!(prompt.contains("verify the current environment and working directory first"));
        assert!(prompt.contains("confirm the current working directory and the exact target path"));
        assert!(prompt.contains("Preview the target"));
        assert!(prompt.contains("Never use broad destructive targets like `rm -rf *`"));
        assert!(prompt.contains("specify the exact file or directory path"));
    }

    #[test]
    fn render_execution_tool_prompt_includes_codemode_guidance() {
        let prompt = render_execution_tool_prompt(&["search_sdk".to_string()]);

        assert!(prompt.contains("Use `execute_code_plan` only when the task needs"));
        assert!(prompt.contains("Call `attach_capability` explicitly"));
        assert!(prompt.contains("Mandatory Discovery Gate"));
        assert!(prompt.contains("summarize what changed"));
        assert!(prompt.contains("required `code` field"));
        assert!(prompt.contains("do not send plan-only prose"));
        assert!(prompt.contains("non-empty Python source string"));
    }

    #[test]
    fn render_runtime_prompt_references_tool_capability_contract() {
        let prompt = render_runtime_capability_prompt(&[
            "search_sdk".to_string(),
            "shell_execute".to_string(),
        ]);

        assert!(prompt.contains(
            "Tool discovery and invocation rules are defined in the Tool & Capability Contract"
        ));
        assert!(prompt.contains("query_task_policy"));
        assert!(prompt.contains("Treat hints as advisory metadata"));
        assert!(prompt.contains("Do not claim you cannot inspect the local machine"));
    }

    #[test]
    fn render_execution_tool_prompt_no_longer_advertises_disabled_asset_helper() {
        let prompt = render_execution_tool_prompt(&[
            "search_sdk".to_string(),
            "save_asset".to_string(),
            "execute_code_plan".to_string(),
        ]);

        assert!(!prompt.contains("Reusable local asset saving"));
        assert!(!prompt.contains("call `save_asset`"));
    }

    #[test]
    fn render_execution_tool_prompt_keeps_skill_guidance_in_base_prompt() {
        let prompt = render_execution_tool_prompt(&[
            "search_sdk".to_string(),
            "activate_skill".to_string(),
            "read_skill_resource".to_string(),
            "shell_execute".to_string(),
            "execute_code_plan".to_string(),
        ]);

        assert!(!prompt.contains("dedicated skill action"));
        assert!(!prompt.contains("recipe excerpts describe a CLI"));
    }
}
