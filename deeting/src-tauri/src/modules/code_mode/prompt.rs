use std::collections::BTreeSet;
use std::path::PathBuf;

const DEFAULT_RUNTIME_CAPABILITY_PROMPT: &str = "The tools listed for this request are the only model-callable tools in the current round: {{allowed_tools}}.\n\nCapability contract:\n- `search_sdk` is the discovery source of truth for what is available right now.\n- `query_task_policy` returns bounded prior hints for one decision point such as discovery, capability_attach, execution, or verification.\n- Policy hints are advisory execution metadata. They must not create a new user goal, replace the user's requested deliverable, or make you narrate verification unless the user explicitly asked for verification details.\n- Before claiming a capability is unavailable, refusing a tool-dependent request, or asking the user to do the step manually, call `search_sdk` in this request whenever the task may depend on runtime tools, browser/page/tab interaction, local inspection, filesystem/system access, or external lookup.\n- At explicit decision gates, prefer `query_task_policy` over vague self-reflection when you need structured priors about whether to search earlier, attach a capability, escalate into `execute_code_plan`, or gather stronger evidence for a user-requested verification.\n- If `search_sdk` returns a capability with `status.callable=true` and `invocation_mode=\"direct\"`, treat it as executable in this request when it also appears in the allowed tools list.\n- If `search_sdk` results are weak, refine with concrete action-and-target terms and adjacent verbs or nouns before concluding the tool is unavailable.\n- For browser/page/tab requests, search for the requested action and target first, then prefer matching browser tools over generic inability claims.\n- Follow the base Agent Skills Progressive Disclosure contract for skill packages; this section only defines the current callable tool allowlist.\n- Do not claim you cannot inspect the local machine, filesystem, terminal, or installed software when a relevant callable direct capability is already available.\n- If a required capability is absent from the allowlist, explain the real limitation briefly and use the best available fallback.\n\nDirect tool use:\n- Prefer the lightest direct callable tool that can finish the task.\n- When multiple direct tools are available, choose the most specific one for the user's intent.\n- Do not invent tool names from labels or summaries.\n- Do not pass positional dict args like `deeting.call_tool(name, {...})`.\n- Reusable local asset saving is temporarily disabled; return one-off content or use the best available non-persistent fallback.\n";
const DEFAULT_EXECUTION_TOOL_PROMPT: &str = "Use the codemode tool only when the task requires multi-step coordination, loops, conditional logic, broad file or system changes, or result aggregation.\n\nCodemode workflow:\n1) Use `search_sdk` before declaring capability limits, and refresh capability truth whenever the best execution path is unclear. If results are weak, refine once with more concrete action-and-target terms.\n2) Explicitly call `attach_capability` before attaching request-scoped expert capability when capability-specific help is needed.\n3) Reusable local asset saving is temporarily disabled; default to one-off output or the best available non-persistent fallback.\n4) If you use `execute_code_plan`, put one coherent executable Python script in the required `code` field.\n5) Keep planning implicit or as Python comments inside that script; do not send plan-only prose, markdown, pseudocode, or metadata instead of `code`.\n6) Execute `execute_code_plan` once per coherent bounded task, then summarize what changed, the key result, and any blocker or next step.\n\nExecution safety:\n- Prefer `from deeting_sdk import <tool_name>` only for direct callable host tools.\n- Or call direct tools with `deeting.call_tool(name, **kwargs)`.\n- `execute_code_plan.code` must be a non-empty Python source string that can run as-is in the sandbox.\n- Before any destructive or high-risk command, verify the current environment and working directory first.\n- Before modifying or deleting files, print or otherwise confirm the current working directory and the exact target path.\n- Preview the target before destructive changes when possible (for example by listing the directory or inspecting the file first).\n- Never use broad destructive targets like `rm -rf *`; always specify the exact file or directory path you intend to modify or remove.\n\nOutput contract:\n- Always emit final structured output with `deeting.log(json.dumps(result, ensure_ascii=False))`.\n";

fn execution_tool_prompt_template_path() -> PathBuf {
    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.push("..");
    path.push("..");
    path.push("packages");
    path.push("code-mode-contract");
    path.push("prompts");
    path.push("code-mode-capability.md");
    path
}

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
    let template = std::fs::read_to_string(execution_tool_prompt_template_path())
        .ok()
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
        .unwrap_or_else(|| DEFAULT_EXECUTION_TOOL_PROMPT.to_string());

    let rendered_tools = normalize_allowed_tools(allowed_tools)
        .into_iter()
        .map(|name| format!("`{name}`"))
        .collect::<Vec<String>>()
        .join(", ");

    template
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
    fn render_execution_tool_prompt_replaces_allowlist_placeholder() {
        let prompt = render_execution_tool_prompt(&[
            "search_sdk".to_string(),
            "execute_code_plan".to_string(),
        ]);
        assert!(prompt.contains("`search_sdk`"));
        assert!(prompt.contains("`execute_code_plan`"));
        assert!(!prompt.contains("{{allowed_direct_tools}}"));
    }

    #[test]
    fn render_execution_tool_prompt_includes_destructive_command_safety_guard() {
        let prompt = render_execution_tool_prompt(&["execute_code_plan".to_string()]);

        assert!(prompt.contains("verify the current environment and working directory first"));
        assert!(prompt.contains("confirm the current working directory and the exact target path"));
        assert!(prompt.contains("Preview the target before destructive changes when possible"));
        assert!(prompt.contains("Never use broad destructive targets like `rm -rf *`"));
        assert!(prompt.contains("specify the exact file or directory path"));
    }

    #[test]
    fn render_execution_tool_prompt_includes_codemode_guidance() {
        let prompt = render_execution_tool_prompt(&["search_sdk".to_string()]);

        assert!(prompt
            .contains("Use the codemode tool only when the task requires multi-step coordination"));
        assert!(prompt.contains(
            "Explicitly call `attach_capability` before attaching request-scoped expert capability"
        ));
        assert!(prompt.contains("Use `search_sdk` before declaring capability limits"));
        assert!(
            prompt.contains("Summarize what changed, the key result, and any blocker or next step")
        );
        assert!(prompt.contains("Reusable local asset saving is temporarily disabled"));
        assert!(prompt.contains("required `code` field"));
        assert!(prompt.contains("do not send plan-only prose"));
        assert!(prompt.contains("non-empty Python source string"));
    }

    #[test]
    fn render_runtime_prompt_uses_discovery_as_truth_source() {
        let prompt = render_runtime_capability_prompt(&[
            "search_sdk".to_string(),
            "shell_execute".to_string(),
        ]);

        assert!(prompt.contains("`search_sdk` is the discovery source of truth"));
        assert!(prompt.contains("build reusable HTML, widgets, cards, templates"));
        assert!(prompt.contains(
            "Before claiming a capability is unavailable, refusing a tool-dependent request"
        ));
        assert!(prompt.contains("Policy hints are advisory execution metadata"));
        assert!(prompt.contains("must not create a new user goal"));
        assert!(prompt.contains(
            "For browser/page/tab requests, search for the requested action and target first"
        ));
        assert!(prompt.contains("base Agent Skills Progressive Disclosure contract"));
        assert!(prompt.contains("Do not claim you cannot inspect the local machine"));
        assert!(prompt.contains("Reusable local asset saving is temporarily disabled"));
    }

    #[test]
    fn render_execution_tool_prompt_guides_reusable_asset_discovery() {
        let prompt = render_execution_tool_prompt(&[
            "search_sdk".to_string(),
            "save_asset".to_string(),
            "execute_code_plan".to_string(),
        ]);

        assert!(prompt.contains("Reusable local asset saving is temporarily disabled"));
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
