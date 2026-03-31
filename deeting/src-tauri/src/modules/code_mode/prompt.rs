use std::collections::BTreeSet;
use std::path::PathBuf;

const DEFAULT_RUNTIME_CAPABILITY_PROMPT: &str = "The tools listed for this request are the only model-callable tools in the current round: {{allowed_tools}}.\n\nCapability contract:\n- `search_sdk` is the discovery source of truth for what is available right now.\n- Before claiming a capability is unavailable, refusing a tool-dependent request, or asking the user to do the step manually, call `search_sdk` in this request whenever the task may depend on runtime tools, browser/page/tab interaction, local inspection, filesystem/system access, or external lookup.\n- For requests that ask to build reusable HTML, widgets, cards, templates, dashboards, or local visual assets, call `search_sdk` before deciding whether to save or reuse an asset.\n- If `search_sdk` returns a capability with `status.callable=true` and `invocation_mode=\"direct\"`, treat it as executable in this request when it also appears in the allowed tools list.\n- If `search_sdk` results are weak, refine with concrete action-and-target terms and adjacent verbs or nouns before concluding the tool is unavailable.\n- For browser/page/tab requests, search for the requested action and target first, then prefer matching browser tools over generic inability claims.\n- `recipes` are guidance entries only. A recipe title or skill bundle name is not callable by itself.\n- Do not claim you cannot inspect the local machine, filesystem, terminal, or installed software when a relevant callable direct capability is already available.\n- If a required capability is absent from the allowlist, explain the real limitation briefly and use the best available fallback.\n\nDirect tool use:\n- Prefer the lightest direct callable tool that can finish the task.\n- When multiple direct tools are available, choose the most specific one for the user's intent.\n- Do not invent tool names from recipe or bundle labels.\n- Do not pass positional dict args like `deeting.call_tool(name, {...})`.\n- If you author reusable HTML, CSS, or JavaScript intended to be reused for similar future requests, save it with `save_asset` instead of returning one-off raw HTML only.\n- After saving a reusable HTML asset, continue the same answer by returning a top-level `render` object that references the saved `asset_id` so the current chat can render that asset immediately.\n";
const DEFAULT_CODE_MODE_CAPABILITY_PROMPT: &str = "Use code orchestration only when the task requires multi-step coordination, loops, conditional logic, broad file or system changes, or result aggregation.\n\nCode orchestration workflow:\n1) If expert capability may help, call `consult_expert_network` to inspect candidates.\n2) Explicitly call `attach_capability` before attaching request-scoped expert capability.\n3) Use `search_sdk` before declaring capability limits, and refresh capability truth whenever the best execution path is unclear. If results are weak, refine once with more concrete action-and-target terms.\n4) For reusable HTML, widget, template, or asset creation requests, use `search_sdk` to discover `save_asset` before defaulting to one-off output.\n5) Produce one coherent Python execution plan.\n6) Execute once with `execute_code_plan`.\n7) Summarize what changed, the key result, and any blocker or next step.\n\nReusable HTML assets:\n- If you generate reusable HTML, CSS, or JavaScript for cards, widgets, dashboards, or local views that should be used again on similar requests, call `save_asset` with a stable `asset_id`, the HTML source, and lightweight match metadata.\n- After `save_asset`, return a top-level `render` object that references the same `asset_id` so the current chat renders the saved asset immediately.\n- Do not generate fresh HTML again on later similar requests when a saved asset can be reused.\n\nExecution safety:\n- Prefer `from deeting_sdk import <tool_name>` only for direct callable host tools.\n- Or call direct tools with `deeting.call_tool(name, **kwargs)`.\n- Before any destructive or high-risk command, verify the current environment and working directory first.\n- Before modifying or deleting files, print or otherwise confirm the current working directory and the exact target path.\n- Preview the target before destructive changes when possible (for example by listing the directory or inspecting the file first).\n- Never use broad destructive targets like `rm -rf *`; always specify the exact file or directory path you intend to modify or remove.\n\nOutput contract:\n- Always emit final structured output with `deeting.log(json.dumps(result, ensure_ascii=False))`.\n";

fn code_mode_prompt_template_path() -> PathBuf {
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

pub fn render_code_mode_capability_prompt(allowed_tools: &[String]) -> String {
    let template = std::fs::read_to_string(code_mode_prompt_template_path())
        .ok()
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
        .unwrap_or_else(|| DEFAULT_CODE_MODE_CAPABILITY_PROMPT.to_string());

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
    use super::{render_code_mode_capability_prompt, render_runtime_capability_prompt};

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
    fn render_code_mode_prompt_replaces_allowlist_placeholder() {
        let prompt = render_code_mode_capability_prompt(&[
            "search_sdk".to_string(),
            "execute_code_plan".to_string(),
        ]);
        assert!(prompt.contains("`search_sdk`"));
        assert!(prompt.contains("`execute_code_plan`"));
        assert!(!prompt.contains("{{allowed_direct_tools}}"));
    }

    #[test]
    fn render_code_mode_prompt_includes_destructive_command_safety_guard() {
        let prompt = render_code_mode_capability_prompt(&["execute_code_plan".to_string()]);

        assert!(prompt.contains("verify the current environment and working directory first"));
        assert!(prompt.contains("confirm the current working directory and the exact target path"));
        assert!(prompt.contains("Preview the target before destructive changes when possible"));
        assert!(prompt.contains("Never use broad destructive targets like `rm -rf *`"));
        assert!(prompt.contains("specify the exact file or directory path"));
    }

    #[test]
    fn render_code_mode_prompt_includes_code_orchestration_guidance() {
        let prompt = render_code_mode_capability_prompt(&["search_sdk".to_string()]);

        assert!(prompt.contains(
            "Use code orchestration only when the task requires multi-step coordination"
        ));
        assert!(prompt.contains("call `consult_expert_network` to inspect candidates"));
        assert!(prompt.contains(
            "Explicitly call `attach_capability` before attaching request-scoped expert capability"
        ));
        assert!(prompt.contains("Use `search_sdk` before declaring capability limits"));
        assert!(
            prompt.contains("Summarize what changed, the key result, and any blocker or next step")
        );
        assert!(prompt.contains("call `save_asset`"));
        assert!(prompt.contains("references the same `asset_id`"));
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
        assert!(prompt.contains(
            "For browser/page/tab requests, search for the requested action and target first"
        ));
        assert!(prompt.contains("`recipes` are guidance entries only"));
        assert!(prompt.contains("Do not claim you cannot inspect the local machine"));
        assert!(prompt.contains("save it with `save_asset`"));
        assert!(prompt.contains("references the saved `asset_id`"));
    }

    #[test]
    fn render_code_mode_prompt_guides_reusable_asset_discovery() {
        let prompt = render_code_mode_capability_prompt(&[
            "search_sdk".to_string(),
            "save_asset".to_string(),
            "execute_code_plan".to_string(),
        ]);

        assert!(prompt.contains("For reusable HTML, widget, template, or asset creation requests"));
        assert!(prompt.contains("discover `save_asset` before defaulting to one-off output"));
        assert!(prompt.contains("call `save_asset`"));
    }
}
