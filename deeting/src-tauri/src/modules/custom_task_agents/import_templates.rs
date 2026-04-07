use crate::modules::mcp::store::McpStore;

#[derive(Debug, Clone, Default)]
pub(crate) struct ImportBindingDefaults {
    pub callable_mcp_tool_ids: Vec<String>,
    pub guidance_skill_ids: Vec<String>,
}

pub(crate) async fn resolve_import_binding_defaults(
    store: &McpStore,
    tags: &[String],
    relative_path: &str,
    name: &str,
) -> Result<ImportBindingDefaults, String> {
    let tools = store.list_tools().await.map_err(|err| err.to_string())?;
    let skills = store
        .list_local_skill_installs()
        .await
        .map_err(|err| err.to_string())?;

    let text = format!(
        "{} {} {}",
        tags.join(" "),
        relative_path.to_ascii_lowercase(),
        name.to_ascii_lowercase()
    );

    let wants_engineering = contains_any(
        &text,
        &[
            "engineering",
            "developer",
            "backend",
            "frontend",
            "devops",
            "code",
            "cli",
            "terminal",
        ],
    );
    let wants_browser = contains_any(
        &text,
        &[
            "browser", "web", "crawler", "scrape", "research", "search", "site",
        ],
    );
    let wants_design = contains_any(&text, &["design", "image", "visual", "ux", "ui", "brand"]);

    let mut result = ImportBindingDefaults::default();

    if wants_engineering {
        try_bind_tool(
            &tools,
            &mut result.callable_mcp_tool_ids,
            &["shell_execute"],
        );
    }

    if wants_browser {
        try_bind_tool(
            &tools,
            &mut result.callable_mcp_tool_ids,
            &["browser_open_tab", "browser_click", "browser_type"],
        );
        try_bind_skill(
            &skills
                .iter()
                .map(|item| item.skill_id.as_str())
                .collect::<Vec<_>>(),
            &mut result.guidance_skill_ids,
            &["official.skills.crawler"],
        );
    }

    if wants_design {
        try_bind_tool(
            &tools,
            &mut result.callable_mcp_tool_ids,
            &["image", "generate image", "image.generate"],
        );
    }

    dedupe(&mut result.callable_mcp_tool_ids);
    dedupe(&mut result.guidance_skill_ids);
    Ok(result)
}

fn contains_any(text: &str, patterns: &[&str]) -> bool {
    let lower = text.to_ascii_lowercase();
    patterns.iter().any(|pattern| lower.contains(pattern))
}

fn try_bind_tool(
    tools: &[mcp_core::types::McpTool],
    bound: &mut Vec<String>,
    desired_patterns: &[&str],
) {
    for tool in tools {
        let haystack = format!(
            "{} {} {}",
            tool.id.to_ascii_lowercase(),
            tool.name.to_ascii_lowercase(),
            tool.description.to_ascii_lowercase()
        );
        if desired_patterns
            .iter()
            .any(|pattern| haystack.contains(&pattern.to_ascii_lowercase()))
        {
            bound.push(tool.id.clone());
        }
    }
}

fn try_bind_skill(installed_skill_ids: &[&str], bound: &mut Vec<String>, desired_ids: &[&str]) {
    for desired in desired_ids {
        if installed_skill_ids
            .iter()
            .any(|installed| installed == desired)
        {
            bound.push((*desired).to_string());
        }
    }
}

fn dedupe(values: &mut Vec<String>) {
    let mut seen = std::collections::HashSet::new();
    values.retain(|value| seen.insert(value.clone()));
}

#[cfg(test)]
mod tests {
    use super::contains_any;

    #[test]
    fn contains_any_matches_case_insensitively() {
        assert!(contains_any("Engineering Frontend Agent", &["engineering"]));
        assert!(contains_any("Research Browser Agent", &["browser"]));
        assert!(!contains_any("Finance Agent", &["browser"]));
    }
}
