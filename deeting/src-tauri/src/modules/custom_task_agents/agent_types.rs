use super::types::{
    CustomTaskAgentInvocationKind, CustomTaskAgentProfile, CustomTaskAgentSkillActionRef,
};
use serde::Deserialize;
use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct AgentTypeTemplate {
    pub(crate) name: String,
    pub(crate) description: String,
    pub(crate) display_name: Option<String>,
    pub(crate) system_prompt: String,
    pub(crate) callable_mcp_tool_ids: Vec<String>,
    pub(crate) guidance_skill_ids: Vec<String>,
    pub(crate) callable_skill_action_refs: Vec<CustomTaskAgentSkillActionRef>,
    pub(crate) model_config: Option<Value>,
    pub(crate) thinking_level: Option<String>,
    pub(crate) max_rounds: Option<u32>,
    pub(crate) tags: Vec<String>,
    pub(crate) source_path: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct EphemeralAgentProfile {
    pub(crate) profile: CustomTaskAgentProfile,
    pub(crate) max_rounds: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct EphemeralAgentSpec {
    #[serde(default)]
    pub(crate) name: Option<String>,
    #[serde(default)]
    pub(crate) callable_mcp_tool_ids: Option<Vec<String>>,
    #[serde(default)]
    pub(crate) guidance_skill_ids: Option<Vec<String>>,
    #[serde(default)]
    pub(crate) callable_skill_action_refs: Option<Vec<CustomTaskAgentSkillActionRef>>,
    #[serde(default)]
    pub(crate) model_config: Option<Value>,
    #[serde(default)]
    pub(crate) thinking_level: Option<String>,
    #[serde(default)]
    pub(crate) max_rounds: Option<u32>,
    #[serde(default)]
    pub(crate) tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
struct AgentTypeConfig {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    display_name: Option<String>,
    #[serde(default)]
    callable_mcp_tool_ids: Option<Vec<String>>,
    #[serde(default)]
    guidance_skill_ids: Option<Vec<String>>,
    #[serde(default)]
    callable_skill_action_refs: Option<Vec<CustomTaskAgentSkillActionRef>>,
    #[serde(default)]
    model_config: Option<Value>,
    #[serde(default)]
    thinking_level: Option<String>,
    #[serde(default)]
    max_rounds: Option<u32>,
    #[serde(default)]
    tags: Option<Vec<String>>,
}

pub(crate) fn parse_ephemeral_agent_spec(
    raw: Option<&Value>,
) -> Result<Option<EphemeralAgentSpec>, String> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    if raw
        .get("system_prompt")
        .or_else(|| raw.get("task_prompt"))
        .is_some()
    {
        return Err(
            "agent_spec cannot include system_prompt or task_prompt; choose an agent_type template instead"
                .to_string(),
        );
    }
    serde_json::from_value(raw.clone())
        .map(Some)
        .map_err(|err| format!("invalid agent_spec: {err}"))
}

pub(crate) fn load_agent_type_template(agent_type: &str) -> Result<AgentTypeTemplate, String> {
    validate_agent_type_name(agent_type)?;
    let project_dir = std::env::current_dir().ok();
    let home_dir = dirs::home_dir();
    load_agent_type_template_from_dirs(agent_type, project_dir.as_deref(), home_dir.as_deref())
}

pub(crate) fn load_agent_type_template_from_dirs(
    agent_type: &str,
    project_dir: Option<&Path>,
    home_dir: Option<&Path>,
) -> Result<AgentTypeTemplate, String> {
    validate_agent_type_name(agent_type)?;

    if let Some(project_dir) = project_dir {
        if let Some(path) = find_project_template_path(project_dir, agent_type) {
            return load_agent_type_template_from_file(agent_type, path);
        }
    }

    if let Some(home_dir) = home_dir {
        let path = home_dir
            .join(".claude")
            .join("agents")
            .join(format!("{agent_type}.md"));
        if path.exists() {
            return load_agent_type_template_from_file(agent_type, path);
        }
    }

    load_builtin_template(agent_type)
}

fn find_project_template_path(project_dir: &Path, agent_type: &str) -> Option<PathBuf> {
    project_dir.ancestors().find_map(|dir| {
        let path = dir
            .join(".claude")
            .join("agents")
            .join(format!("{agent_type}.md"));
        path.exists().then_some(path)
    })
}

pub(crate) fn build_ephemeral_agent_profile(
    agent_type: &str,
    agent_spec: Option<EphemeralAgentSpec>,
    batch_id: &str,
    child_index: usize,
) -> Result<EphemeralAgentProfile, String> {
    let template = load_agent_type_template(agent_type)?;
    let agent_spec = agent_spec.unwrap_or(EphemeralAgentSpec {
        name: None,
        callable_mcp_tool_ids: None,
        guidance_skill_ids: None,
        callable_skill_action_refs: None,
        model_config: None,
        thinking_level: None,
        max_rounds: None,
        tags: None,
    });
    Ok(build_ephemeral_agent_profile_from_template(
        agent_type,
        template,
        agent_spec,
        batch_id,
        child_index,
    ))
}

fn build_ephemeral_agent_profile_from_template(
    agent_type: &str,
    template: AgentTypeTemplate,
    agent_spec: EphemeralAgentSpec,
    batch_id: &str,
    child_index: usize,
) -> EphemeralAgentProfile {
    let name = agent_spec
        .name
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| template.display_name.clone())
        .unwrap_or_else(|| template.name.clone());
    let now = chrono::Utc::now().to_rfc3339();
    let thinking_level = agent_spec
        .thinking_level
        .clone()
        .or_else(|| template.thinking_level.clone());
    let model_config = merge_model_config(
        agent_spec
            .model_config
            .clone()
            .or(template.model_config.clone()),
        thinking_level.as_deref(),
    );
    let mut tags = agent_spec.tags.unwrap_or_else(|| template.tags.clone());
    if !tags.iter().any(|tag| tag == "ephemeral") {
        tags.push("ephemeral".to_string());
    }
    if !tags.iter().any(|tag| tag == agent_type) {
        tags.push(agent_type.to_string());
    }

    EphemeralAgentProfile {
        profile: CustomTaskAgentProfile {
            id: format!("ephemeral:{batch_id}:{child_index}"),
            name,
            description: Some(template.description),
            task_prompt: template.system_prompt,
            invocation_kind: CustomTaskAgentInvocationKind::Chat,
            preferred_for_image_generation: false,
            model_config,
            callable_mcp_tool_ids: agent_spec
                .callable_mcp_tool_ids
                .unwrap_or(template.callable_mcp_tool_ids),
            guidance_skill_ids: agent_spec
                .guidance_skill_ids
                .unwrap_or(template.guidance_skill_ids),
            callable_skill_action_refs: agent_spec
                .callable_skill_action_refs
                .unwrap_or(template.callable_skill_action_refs),
            bound_asset_id: None,
            tags,
            discoverable: false,
            is_enabled: true,
            is_deleted: false,
            source_kind: Some("agent_type_template".to_string()),
            source_path: template.source_path,
            source_repo: None,
            source_ref: None,
            source_hash: None,
            created_at: now.clone(),
            updated_at: now,
        },
        max_rounds: agent_spec.max_rounds.or(template.max_rounds),
    }
}

fn merge_model_config(model_config: Option<Value>, thinking_level: Option<&str>) -> Option<Value> {
    let thinking_level = thinking_level
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    match (model_config, thinking_level) {
        (None, None) => None,
        (None, Some(thinking_level)) => {
            let mut object = Map::new();
            object.insert("thinking_level".to_string(), Value::String(thinking_level));
            Some(Value::Object(object))
        }
        (Some(Value::Object(mut object)), Some(thinking_level)) => {
            object.insert("thinking_level".to_string(), Value::String(thinking_level));
            Some(Value::Object(object))
        }
        (Some(value), None) => Some(value),
        (Some(value), Some(thinking_level)) => {
            let mut object = Map::new();
            object.insert("config".to_string(), value);
            object.insert("thinking_level".to_string(), Value::String(thinking_level));
            Some(Value::Object(object))
        }
    }
}

fn load_agent_type_template_from_file(
    agent_type: &str,
    path: PathBuf,
) -> Result<AgentTypeTemplate, String> {
    let content = fs::read_to_string(&path).map_err(|err| {
        format!(
            "failed to read agent type template {}: {err}",
            path.display()
        )
    })?;
    let mut template = parse_agent_template_md(agent_type, &content)?;
    template.source_path = Some(path.display().to_string());
    Ok(template)
}

fn parse_agent_template_md(agent_type: &str, content: &str) -> Result<AgentTypeTemplate, String> {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return Err(format!(
            "agent type template '{agent_type}' must start with YAML frontmatter"
        ));
    }
    let after_open = &trimmed[3..];
    let Some(close_idx) = after_open.find("\n---") else {
        return Err(format!(
            "agent type template '{agent_type}' is missing closing YAML frontmatter marker"
        ));
    };
    let frontmatter = &after_open[..close_idx];
    let body = after_open[close_idx + 4..].trim();
    if body.is_empty() {
        return Err(format!(
            "agent type template '{agent_type}' must include a Markdown body system prompt"
        ));
    }

    let config: AgentTypeConfig = serde_yaml::from_str(frontmatter)
        .map_err(|err| format!("invalid YAML frontmatter for agent type '{agent_type}': {err}"))?;
    Ok(AgentTypeTemplate {
        name: config.name.unwrap_or_else(|| agent_type.to_string()),
        description: config.description.unwrap_or_default(),
        display_name: config.display_name,
        system_prompt: body.to_string(),
        callable_mcp_tool_ids: config.callable_mcp_tool_ids.unwrap_or_default(),
        guidance_skill_ids: config.guidance_skill_ids.unwrap_or_default(),
        callable_skill_action_refs: config.callable_skill_action_refs.unwrap_or_default(),
        model_config: config.model_config,
        thinking_level: config.thinking_level,
        max_rounds: config.max_rounds,
        tags: config.tags.unwrap_or_default(),
        source_path: None,
    })
}

fn load_builtin_template(agent_type: &str) -> Result<AgentTypeTemplate, String> {
    let (description, prompt, tools, tags, thinking_level, max_rounds) = match agent_type {
        "explore" => (
            "Code exploration and file discovery agent",
            "You are a code exploration agent specialized in finding files and understanding code structure.\n\nYour responsibilities:\n- Search for files matching specific patterns or containing specific content.\n- Provide file paths with brief summaries.\n- Identify code patterns and architectural structures.\n- Cite specific file and line references when available.\n\nGuidelines:\n- Use search and file-read tools efficiently to narrow scope.\n- Read files only after identifying candidates.\n- Provide concise summaries, not full file dumps.",
            vec!["read_file", "grep", "glob"],
            vec!["read-only", "exploration"],
            Some("medium"),
            Some(10),
        ),
        "plan" => (
            "Task planning and design agent",
            "You are a planning agent specialized in turning bounded requirements into implementation-ready plans.\n\nYour responsibilities:\n- Clarify scope, constraints, sequencing, and risks.\n- Produce concise plans with verification steps.\n- Keep recommendations grounded in the provided task context.\n\nGuidelines:\n- Do not modify files.\n- Prefer existing architecture and local patterns.\n- Surface blockers and assumptions explicitly.",
            vec!["read_file", "grep", "glob"],
            vec!["read-only", "planning"],
            Some("medium"),
            Some(10),
        ),
        "implement" => (
            "Code implementation agent",
            "You are an implementation agent specialized in making bounded code changes.\n\nYour responsibilities:\n- Implement the requested scoped change using existing project patterns.\n- Keep edits small and reversible.\n- Run or recommend focused verification for the changed behavior.\n\nGuidelines:\n- Stay within the delegated task scope.\n- Do not re-plan the parent task.\n- Report changed files, verification, and blockers.",
            vec!["read_file", "grep", "glob", "write_file", "edit_file"],
            vec!["implementation"],
            Some("medium"),
            Some(15),
        ),
        "review" => (
            "Code review agent",
            "You are a code review agent focused on defects, regressions, and missing verification.\n\nYour responsibilities:\n- Review the delegated scope for concrete bugs and risks.\n- Prioritize findings by severity.\n- Cite files and lines where possible.\n\nGuidelines:\n- Do not modify files.\n- Avoid style-only findings unless they affect correctness.\n- If no issues are found, state residual risks and test gaps.",
            vec!["read_file", "grep", "glob"],
            vec!["read-only", "review"],
            Some("high"),
            Some(12),
        ),
        _ => {
            return Err(format!(
                "unknown agent_type '{agent_type}'. Available built-in agent_types: explore, plan, implement, review. \
                 For registered agents (custom_task_agents), use agent_id instead of agent_type."
            ))
        }
    };

    Ok(AgentTypeTemplate {
        name: agent_type.to_string(),
        description: description.to_string(),
        display_name: Some(
            match agent_type {
                "explore" => "Explorer",
                "plan" => "Planner",
                "implement" => "Implementer",
                "review" => "Reviewer",
                _ => agent_type,
            }
            .to_string(),
        ),
        system_prompt: prompt.to_string(),
        callable_mcp_tool_ids: tools.into_iter().map(str::to_string).collect(),
        guidance_skill_ids: Vec::new(),
        callable_skill_action_refs: Vec::new(),
        model_config: None,
        thinking_level: thinking_level.map(str::to_string),
        max_rounds,
        tags: tags.into_iter().map(str::to_string).collect(),
        source_path: None,
    })
}

fn validate_agent_type_name(agent_type: &str) -> Result<(), String> {
    let normalized = agent_type.trim();
    if normalized.is_empty() {
        return Err("agent_type is required".to_string());
    }
    if normalized
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        Ok(())
    } else {
        Err(format!(
            "invalid agent_type '{agent_type}': only ASCII letters, numbers, '-' and '_' are allowed"
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_frontmatter_and_body_as_system_prompt() {
        let template = parse_agent_template_md(
            "custom",
            r#"---
name: custom
description: Custom agent
display_name: Custom Agent
callable_mcp_tool_ids: ["read_file"]
thinking_level: high
max_rounds: 7
tags: ["read-only"]
---

You are the custom system prompt.
"#,
        )
        .expect("template should parse");

        assert_eq!(template.name, "custom");
        assert_eq!(template.display_name.as_deref(), Some("Custom Agent"));
        assert_eq!(template.system_prompt, "You are the custom system prompt.");
        assert_eq!(template.callable_mcp_tool_ids, vec!["read_file"]);
        assert_eq!(template.thinking_level.as_deref(), Some("high"));
        assert_eq!(template.max_rounds, Some(7));
    }

    #[test]
    fn rejects_agent_spec_system_prompt_override() {
        let err = parse_ephemeral_agent_spec(Some(&json!({
            "name": "Bad",
            "system_prompt": "override"
        })))
        .expect_err("system_prompt override should fail");

        assert!(err.contains("agent_spec cannot include system_prompt"));
    }

    #[test]
    fn project_template_takes_priority_over_global_and_builtin() {
        let suffix = uuid::Uuid::new_v4().to_string();
        let base = std::env::temp_dir().join(format!("deeting-agent-type-test-{suffix}"));
        let project_dir = base.join("project");
        let home_dir = base.join("home");
        let project_agents_dir = project_dir.join(".claude").join("agents");
        let home_agents_dir = home_dir.join(".claude").join("agents");
        fs::create_dir_all(&project_agents_dir).expect("project dir");
        fs::create_dir_all(&home_agents_dir).expect("home dir");
        fs::write(
            home_agents_dir.join("explore.md"),
            "---\nname: global\n---\n\nGlobal prompt",
        )
        .expect("write global");
        fs::write(
            project_agents_dir.join("explore.md"),
            "---\nname: project\n---\n\nProject prompt",
        )
        .expect("write project");

        let template =
            load_agent_type_template_from_dirs("explore", Some(&project_dir), Some(&home_dir))
                .expect("template should load");
        assert_eq!(template.name, "project");
        assert_eq!(template.system_prompt, "Project prompt");

        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn ephemeral_profile_keeps_template_system_prompt() {
        let template = AgentTypeTemplate {
            name: "explore".to_string(),
            description: "desc".to_string(),
            display_name: Some("Explorer".to_string()),
            system_prompt: "template prompt".to_string(),
            callable_mcp_tool_ids: vec!["read_file".to_string()],
            guidance_skill_ids: Vec::new(),
            callable_skill_action_refs: Vec::new(),
            model_config: None,
            thinking_level: Some("medium".to_string()),
            max_rounds: Some(3),
            tags: vec!["read-only".to_string()],
            source_path: None,
        };
        let profile = build_ephemeral_agent_profile_from_template(
            "explore",
            template,
            EphemeralAgentSpec {
                name: Some("Auth Explorer".to_string()),
                callable_mcp_tool_ids: Some(vec!["grep".to_string()]),
                guidance_skill_ids: None,
                callable_skill_action_refs: None,
                model_config: Some(json!({"temperature": 0.1})),
                thinking_level: Some("high".to_string()),
                max_rounds: Some(5),
                tags: None,
            },
            "batch-1",
            0,
        );

        assert_eq!(profile.profile.id, "ephemeral:batch-1:0");
        assert_eq!(profile.profile.name, "Auth Explorer");
        assert_eq!(profile.profile.task_prompt, "template prompt");
        assert_eq!(profile.profile.callable_mcp_tool_ids, vec!["grep"]);
        assert_eq!(profile.max_rounds, Some(5));
        assert_eq!(
            profile
                .profile
                .model_config
                .as_ref()
                .and_then(|value| value.get("thinking_level"))
                .and_then(Value::as_str),
            Some("high")
        );
    }
}
