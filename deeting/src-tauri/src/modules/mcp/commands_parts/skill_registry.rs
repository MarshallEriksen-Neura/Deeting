use super::{common_impl::to_string, support::*};

pub(crate) fn normalize_skill_dir_name(skill_id: &str) -> String {
    let mut out = String::with_capacity(skill_id.len());
    for ch in skill_id.chars() {
        if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' || ch == '.' {
            out.push(ch);
        } else {
            out.push('_');
        }
    }
    let normalized = out.trim_matches('_').trim().to_string();
    if normalized.is_empty() {
        "skill".to_string()
    } else {
        normalized
    }
}

pub(crate) fn resolve_local_skill_scan_targets(
    app: &AppHandle,
) -> Result<Vec<(std::path::PathBuf, &'static str)>, String> {
    let official_skills_dir = app
        .path()
        .resource_dir()
        .ok()
        .map(|p| p.join("official-skills"))
        .filter(|p| p.exists())
        .unwrap_or_else(|| {
            std::env::current_dir()
                .unwrap_or_default()
                .join("packages")
                .join("official-skills")
        });
    let user_skills_dir = app.path().app_data_dir().map_err(to_string)?.join("skills");
    if !user_skills_dir.exists() {
        let _ = std::fs::create_dir_all(&user_skills_dir);
    }

    Ok(vec![
        (official_skills_dir, "system_plugin"),
        (user_skills_dir, "user_skill"),
    ])
}

async fn index_local_skill_tool_asset(
    provider_state: std::sync::Arc<crate::modules::providers::ProviderState>,
    memory_state: std::sync::Arc<crate::modules::memory::MemoryState>,
    tool_id: String,
    tool_name: String,
    tool_desc: String,
    final_pkg_name: String,
    final_source_type: String,
) {
    let text = format!("name: {}\ndescription: {}", tool_name, tool_desc);
    if let Ok(vector) = provider_state.embedding.embed_text(&text).await {
        let _ = memory_state
            .store
            .upsert_asset(
                tool_id,
                tool_name,
                tool_desc,
                "tool".to_string(),
                final_source_type,
                Some(final_pkg_name),
                vector,
                None,
            )
            .await;
    }
}

pub(crate) async fn register_local_skills_from_scan_targets_inner(
    scan_targets: &[(std::path::PathBuf, &'static str)],
    sdk_pythonpath: &str,
    store: &crate::modules::mcp::store::McpStore,
    provider_state: std::sync::Arc<crate::modules::providers::ProviderState>,
    memory_state: std::sync::Arc<crate::modules::memory::MemoryState>,
    wait_for_vector_index: bool,
) -> Result<usize, String> {
    let mut total_indexed = 0;

    for (dir_path, source_prefix) in scan_targets {
        if !dir_path.exists() {
            continue;
        }
        for entry in std::fs::read_dir(dir_path).map_err(to_string)? {
            let skill_path = entry.map_err(to_string)?.path();
            if !skill_path.is_dir() {
                continue;
            }
            let deeting_json_path = skill_path.join("deeting.json");
            if !deeting_json_path.exists() {
                continue;
            }

            let deeting_json_str =
                std::fs::read_to_string(&deeting_json_path).map_err(to_string)?;
            let manifest = match parse_deeting_manifest(&deeting_json_str) {
                Ok(m) => m,
                Err(e) => {
                    warn!("skipping skill at {}: {}", skill_path.display(), e);
                    continue;
                }
            };

            let id = &manifest.id;
            if id.trim().is_empty() {
                continue;
            }
            let tool_desc_prefix = manifest.description.as_deref().unwrap_or("");
            let version = manifest.version.as_deref();
            let runtime_str = manifest.runtime.join(",");
            let runtime = Some(runtime_str.as_str());
            let mut skill_capabilities = vec![source_prefix.to_string()];
            if manifest.restricted {
                skill_capabilities.push("restricted".to_string());
                for role in &manifest.allowed_roles {
                    skill_capabilities.push(format!("role:{}", role));
                }
            }

            store
                .upsert_local_skill_install(
                    id,
                    version,
                    runtime,
                    &deeting_json_str,
                    &skill_path.to_string_lossy(),
                )
                .await
                .map_err(to_string)?;

            let source_name = format!("skill:{}", id);
            let trust_level = if *source_prefix == "system_plugin" {
                McpTrustLevel::Official
            } else {
                McpTrustLevel::Community
            };
            let is_read_only = *source_prefix == "system_plugin";
            let skill_source = store
                .upsert_skill_source(
                    &source_name,
                    &skill_path.to_string_lossy(),
                    trust_level,
                    is_read_only,
                )
                .await
                .map_err(to_string)?;
            let source_id = skill_source.id.clone();

            let llm_tool_path = skill_path.join("llm-tool.yaml");
            if !llm_tool_path.exists() {
                continue;
            }
            let llm_tool_str = std::fs::read_to_string(llm_tool_path).map_err(to_string)?;
            let llm_tools: serde_json::Value =
                serde_yaml::from_str(&llm_tool_str).map_err(to_string)?;

            let mut env = HashMap::new();
            let existing_pypath = std::env::var("PYTHONPATH").unwrap_or_default();
            let pathsep = if cfg!(windows) { ";" } else { ":" };
            let pypath = if existing_pypath.is_empty() {
                sdk_pythonpath.to_string()
            } else {
                format!("{}{}{}", sdk_pythonpath, pathsep, &existing_pypath)
            };
            env.insert("PYTHONPATH".to_string(), pypath);
            for env_name in &manifest.env_requirements {
                if let Ok(val) = std::env::var(env_name) {
                    env.insert(env_name.to_string(), val);
                }
            }
            if manifest
                .env_requirements
                .iter()
                .any(|name| name == SCOUT_SERVICE_URL_ENV_KEY)
            {
                env.remove(SCOUT_SERVICE_URL_ENV_KEY);
                if let Ok(Some(val)) = resolve_effective_desktop_scout_base_url(store).await {
                    env.insert(SCOUT_SERVICE_URL_ENV_KEY.to_string(), val);
                }
            }

            if let Some(tools_array) = llm_tools.get("tools").and_then(|v| v.as_array()) {
                for tool_def in tools_array {
                    let tool_name = tool_def["name"].as_str().unwrap();
                    let tool_desc = tool_def["description"].as_str().unwrap_or(tool_desc_prefix);
                    let mut enriched_tool_def = tool_def.clone();
                    enriched_tool_def["execution"] = serde_json::json!({
                        "timeout_seconds": manifest.execution.timeout_seconds
                    });
                    let config_json = serde_json::to_string(&enriched_tool_def).unwrap();
                    let full_main_path = skill_path.join("main.py");

                    let upsert = ToolUpsert {
                        id: None,
                        source_id: source_id.clone(),
                        identifier: Some(format!("{}/{}", id, tool_name)),
                        name: tool_name.to_string(),
                        source_type: McpSourceType::Local,
                        status: McpToolStatus::Healthy,
                        ping_ms: None,
                        capabilities: skill_capabilities.clone(),
                        description: tool_desc.to_string(),
                        error: None,
                        command: Some("python3".to_string()),
                        args: Some(vec![full_main_path.to_string_lossy().to_string()]),
                        env: if env.is_empty() {
                            None
                        } else {
                            Some(env.clone())
                        },
                        config_json,
                        config_hash: "system_builtin".to_string(),
                        pending_config_json: None,
                        pending_config_hash: None,
                        conflict_status: McpConflictStatus::None,
                        is_read_only: true,
                        is_new: false,
                    };

                    if let Ok(tool) = store.upsert_tool(upsert).await {
                        total_indexed += 1;
                        let final_pkg_name = id.to_string();
                        let final_source_type = if *source_prefix == "system_plugin" {
                            "builtin"
                        } else {
                            "user"
                        }
                        .to_string();
                        if wait_for_vector_index {
                            index_local_skill_tool_asset(
                                provider_state.clone(),
                                memory_state.clone(),
                                tool.id.clone(),
                                tool.name.clone(),
                                tool.description.clone(),
                                final_pkg_name,
                                final_source_type,
                            )
                            .await;
                        } else {
                            let provider_state_clone = provider_state.clone();
                            let memory_state_clone = memory_state.clone();
                            let tool_id = tool.id.clone();
                            let tool_name = tool.name.clone();
                            let tool_desc = tool.description.clone();
                            tauri::async_runtime::spawn(async move {
                                index_local_skill_tool_asset(
                                    provider_state_clone,
                                    memory_state_clone,
                                    tool_id,
                                    tool_name,
                                    tool_desc,
                                    final_pkg_name,
                                    final_source_type,
                                )
                                .await;
                            });
                        }
                    }
                }
            }
        }
    }

    Ok(total_indexed)
}

fn is_allowed_skill_repo_url(repo_url: &str) -> bool {
    let normalized = repo_url.trim().to_ascii_lowercase();
    normalized.starts_with("https://github.com/") || normalized.starts_with("git@github.com:")
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct DeetingManifestExecution {
    #[serde(default = "default_timeout")]
    pub timeout_seconds: u64,
}

fn default_timeout() -> u64 {
    60
}

impl Default for DeetingManifestExecution {
    fn default() -> Self {
        Self {
            timeout_seconds: default_timeout(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct DeetingManifest {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub entry: Option<serde_json::Value>,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default)]
    pub restricted: bool,
    #[serde(default)]
    pub allowed_roles: Vec<String>,
    #[serde(default = "default_runtime")]
    pub runtime: Vec<String>,
    #[serde(default)]
    pub execution: DeetingManifestExecution,
    #[serde(default)]
    pub env_requirements: Vec<String>,
    #[serde(default)]
    pub capabilities: Option<serde_json::Value>,
}

fn default_runtime() -> Vec<String> {
    vec!["cloud".to_string(), "local".to_string()]
}

fn parse_deeting_manifest(raw: &str) -> Result<DeetingManifest, String> {
    serde_json::from_str::<DeetingManifest>(raw).map_err(|e| format!("invalid deeting.json: {}", e))
}

pub(crate) async fn try_clone_skill_repo(
    target_dir: &Path,
    repo_url: &str,
    revision: Option<&str>,
) -> Result<(), String> {
    if let Some(parent) = target_dir.parent() {
        std::fs::create_dir_all(parent).map_err(to_string)?;
    }
    if target_dir.exists() {
        return Ok(());
    }
    let normalized_repo = repo_url.trim();
    if normalized_repo.is_empty() {
        return Err("source repo is empty".to_string());
    }
    if !is_allowed_skill_repo_url(normalized_repo) {
        return Err("source repo is not in the allowed host list".to_string());
    }
    let revision = revision
        .map(|raw| raw.trim().to_string())
        .filter(|raw| !raw.is_empty())
        .ok_or_else(|| "pinned revision is required for reinstall".to_string())?;
    let mut cmd = tokio::process::Command::new("git");
    cmd.arg("clone").arg("--depth").arg("1");
    cmd.arg("--branch").arg(revision);
    cmd.arg(normalized_repo).arg(target_dir);
    let output = cmd.output().await.map_err(to_string)?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let _ = std::fs::remove_dir_all(target_dir);
    Err(if stderr.is_empty() {
        "git clone failed".to_string()
    } else {
        format!("git clone failed: {}", stderr)
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct SkillInstallResult {
    pub skill_id: String,
    pub tool_count: usize,
    pub install_path: String,
}

pub(crate) async fn install_skill_to_local(
    app: &AppHandle,
    app_state: &AppState,
    repo_url: &str,
    revision: Option<&str>,
) -> Result<SkillInstallResult, String> {
    let skill_install_start = std::time::Instant::now();
    let normalized_repo = repo_url.trim();
    if normalized_repo.is_empty() {
        return Err("repo_url is empty".to_string());
    }
    if !is_allowed_skill_repo_url(normalized_repo) {
        return Err("repo URL is not in the allowed host list".to_string());
    }

    let skills_dir = app.path().app_data_dir().map_err(to_string)?.join("skills");
    if !skills_dir.exists() {
        std::fs::create_dir_all(&skills_dir).map_err(to_string)?;
    }

    let temp_name = format!("_installing_{}", uuid::Uuid::new_v4());
    let temp_dir = skills_dir.join(&temp_name);

    let mut cmd = tokio::process::Command::new("git");
    cmd.arg("clone").arg("--depth").arg("1");
    if let Some(rev) = revision.map(|r| r.trim()).filter(|r| !r.is_empty()) {
        cmd.arg("--branch").arg(rev);
    }
    cmd.arg(normalized_repo).arg(&temp_dir);
    let output = cmd.output().await.map_err(to_string)?;
    if !output.status.success() {
        let _ = std::fs::remove_dir_all(&temp_dir);
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!(
            "git clone failed: {}",
            if stderr.is_empty() {
                "unknown error"
            } else {
                &stderr
            }
        ));
    }

    let manifest_path = temp_dir.join("deeting.json");
    if !manifest_path.exists() {
        let _ = std::fs::remove_dir_all(&temp_dir);
        return Err("cloned repo has no deeting.json".to_string());
    }
    let manifest_str = std::fs::read_to_string(&manifest_path).map_err(|e| {
        let _ = std::fs::remove_dir_all(&temp_dir);
        to_string(e)
    })?;
    let manifest = match parse_deeting_manifest(&manifest_str) {
        Ok(m) => m,
        Err(e) => {
            let _ = std::fs::remove_dir_all(&temp_dir);
            return Err(format!("invalid deeting.json: {}", e));
        }
    };

    let skill_id = manifest.id.clone();
    if skill_id.trim().is_empty() {
        let _ = std::fs::remove_dir_all(&temp_dir);
        return Err("manifest id is empty".to_string());
    }

    let final_dir = skills_dir.join(&skill_id);
    if final_dir.exists() {
        let _ = std::fs::remove_dir_all(&final_dir);
    }
    std::fs::rename(&temp_dir, &final_dir).map_err(|e| {
        let _ = std::fs::remove_dir_all(&temp_dir);
        format!("failed to move skill to final location: {}", e)
    })?;

    let store = &app_state.mcp.store;
    let version = manifest.version.as_deref();
    let runtime_str = manifest.runtime.join(",");
    store
        .upsert_local_skill_install(
            &skill_id,
            version,
            Some(&runtime_str),
            &manifest_str,
            &final_dir.to_string_lossy(),
        )
        .await
        .map_err(to_string)?;

    let indexed_tools = register_local_skills_inner(app.clone(), app_state)
        .await
        .unwrap_or(0);

    let bandit_store = app_state.providers.store.clone();
    let bandit_skill_id = skill_id.clone();
    let bandit_elapsed = skill_install_start.elapsed().as_millis() as f64;
    tauri::async_runtime::spawn(async move {
        if let Err(e) = bandit_store
            .record_feedback_simple("router:skill", &bandit_skill_id, true, Some(bandit_elapsed))
            .await
        {
            log::warn!("bandit feedback failed for router:skill install: {}", e);
        }
    });

    Ok(SkillInstallResult {
        skill_id,
        tool_count: indexed_tools,
        install_path: final_dir.to_string_lossy().to_string(),
    })
}

pub(crate) async fn uninstall_local_skill(
    app: &AppHandle,
    app_state: &AppState,
    skill_id: &str,
) -> Result<(), String> {
    let store = &app_state.mcp.store;
    let source_name = format!("skill:{}", skill_id);

    if let Some(source) = store
        .find_source_by_name(&source_name)
        .await
        .map_err(to_string)?
    {
        if source.is_read_only {
            return Err("cannot uninstall official (read-only) skills".to_string());
        }
        let deleted = store
            .delete_tools_by_source_id(&source.id)
            .await
            .map_err(to_string)?;
        log::info!(
            "uninstall_local_skill {}: deleted {} tools",
            skill_id,
            deleted
        );
        store.delete_source(&source.id).await.map_err(to_string)?;
    }

    store
        .delete_local_skill_install(skill_id)
        .await
        .map_err(to_string)?;
    if let Err(e) = app_state
        .memory
        .service
        .delete_assets_by_package(skill_id)
        .await
    {
        warn!(
            "uninstall_local_skill {}: failed to delete embeddings: {}",
            skill_id, e
        );
    }

    let install_path = app
        .path()
        .app_data_dir()
        .map_err(to_string)?
        .join("skills")
        .join(skill_id);
    if install_path.exists() {
        std::fs::remove_dir_all(&install_path).map_err(to_string)?;
    }
    log::info!("uninstall_local_skill {}: complete", skill_id);
    Ok(())
}

#[tauri::command]
pub async fn register_local_skills(
    app: AppHandle,
    app_state: State<'_, AppState>,
) -> Result<usize, String> {
    register_local_skills_inner(app, app_state.inner()).await
}

#[tauri::command]
pub async fn install_skill_from_repo(
    app: AppHandle,
    app_state: State<'_, AppState>,
    repo_url: String,
    revision: Option<String>,
) -> Result<SkillInstallResult, String> {
    install_skill_to_local(&app, app_state.inner(), &repo_url, revision.as_deref()).await
}

#[tauri::command]
pub async fn uninstall_skill(
    app: AppHandle,
    app_state: State<'_, AppState>,
    skill_id: String,
) -> Result<(), String> {
    uninstall_local_skill(&app, app_state.inner(), &skill_id).await
}

pub(crate) async fn register_local_skills_inner(
    app: AppHandle,
    app_state: &AppState,
) -> Result<usize, String> {
    let scan_targets = resolve_local_skill_scan_targets(&app)?;
    let sdk_dir = app
        .path()
        .resource_dir()
        .ok()
        .map(|p| p.join("deeting-sdk"))
        .filter(|p| p.exists())
        .unwrap_or_else(|| {
            std::env::current_dir()
                .unwrap_or_default()
                .join("packages")
                .join("deeting-sdk")
        });
    let sdk_pythonpath = sdk_dir.to_string_lossy().to_string();
    register_local_skills_from_scan_targets_inner(
        &scan_targets,
        &sdk_pythonpath,
        app_state.mcp.store.as_ref(),
        app_state.providers.clone(),
        app_state.memory.clone(),
        false,
    )
    .await
}
