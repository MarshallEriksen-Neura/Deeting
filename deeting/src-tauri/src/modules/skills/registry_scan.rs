use std::path::{Path, PathBuf};

use serde_json::{json, Value as JsonValue};
use tauri::{AppHandle, Manager};

use crate::modules::skill_runtime::detect_local_skill_runtime;
use mcp_registry::types::LocalCapabilityRegistryUpsert;
use mcp_storage::types::LocalSkillInstallDetail;

use crate::modules::skills::registry_impl::{
    collect_local_skill_tool_bindings, resolve_local_skill_definition,
    resolve_skill_backend_entry_path, LocalSkillDefinition, LocalSkillToolBindingDefinition,
};

fn normalize_skill_install_path_for_compare(path: &Path) -> String {
    if let Ok(canonical) = std::fs::canonicalize(path) {
        return canonical
            .to_string_lossy()
            .replace('\\', "/")
            .to_ascii_lowercase();
    }
    path.to_string_lossy()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_ascii_lowercase()
}

fn local_skill_install_paths_match(left: &Path, right: &Path) -> bool {
    normalize_skill_install_path_for_compare(left)
        == normalize_skill_install_path_for_compare(right)
}

fn merge_local_skill_user_settings(
    primary: Option<&JsonValue>,
    legacy: Option<&JsonValue>,
) -> Option<JsonValue> {
    match (primary, legacy) {
        (Some(JsonValue::Object(primary_map)), Some(JsonValue::Object(legacy_map))) => {
            let mut merged = primary_map.clone();
            for (key, value) in legacy_map {
                merged.entry(key.clone()).or_insert_with(|| value.clone());
            }
            Some(JsonValue::Object(merged))
        }
        (Some(primary), _) => Some(primary.clone()),
        (None, Some(legacy)) => Some(legacy.clone()),
        (None, None) => None,
    }
}

async fn migrate_conflicting_local_skill_installs_for_path(
    store: &crate::modules::mcp::store::McpStore,
    canonical_skill_id: &str,
    install_path: &Path,
) -> Result<(), String> {
    let installs = store
        .list_local_skill_install_details()
        .await
        .map_err(|err| err.to_string())?;
    let Some(canonical_install) = installs
        .iter()
        .find(|item| {
            item.skill_id == canonical_skill_id
                && local_skill_install_paths_match(Path::new(&item.install_path), install_path)
        })
        .cloned()
    else {
        return Ok(());
    };

    let conflicting_installs = installs
        .into_iter()
        .filter(|item| item.skill_id != canonical_skill_id)
        .filter(|item| local_skill_install_paths_match(Path::new(&item.install_path), install_path))
        .collect::<Vec<_>>();
    if conflicting_installs.is_empty() {
        return Ok(());
    }

    let merged_settings = conflicting_installs.iter().fold(
        canonical_install.user_settings_json.clone(),
        |current, install| {
            merge_local_skill_user_settings(current.as_ref(), install.user_settings_json.as_ref())
        },
    );
    if merged_settings != canonical_install.user_settings_json {
        store
            .upsert_local_skill_install_state(
                &canonical_install.skill_id,
                canonical_install.installed_version.as_deref(),
                canonical_install.is_enabled,
                canonical_install.runtime.as_deref(),
                &canonical_install.manifest_json,
                &canonical_install.install_path,
                merged_settings.as_ref(),
            )
            .await
            .map_err(|err| err.to_string())?;
    }

    for conflicting in conflicting_installs {
        log::info!(
            "migrating legacy local skill install '{}' into canonical '{}'",
            conflicting.skill_id,
            canonical_skill_id
        );
        store
            .delete_local_skill_install(&conflicting.skill_id)
            .await
            .map_err(|err| err.to_string())?;
    }

    Ok(())
}

fn local_skill_bundle_capability_id(skill_id: &str) -> String {
    format!("skill_bundle::{skill_id}")
}

fn local_skill_tool_capability_id(skill_id: &str, tool_name: &str) -> String {
    format!("skill_tool::{skill_id}::{tool_name}")
}

fn build_local_skill_registry_entries(
    skill_path: &Path,
    skill_def: &LocalSkillDefinition,
    bindings: &[LocalSkillToolBindingDefinition],
    source_kind: &str,
    activation_state: &str,
    runtime_state: &str,
    search_index_state: &str,
    generation: i64,
) -> Result<Vec<LocalCapabilityRegistryUpsert>, String> {
    let manifest_value = serde_json::from_str::<JsonValue>(&skill_def.manifest_json)
        .map_err(|err| err.to_string())?;
    let compatibility = manifest_value.get("compatibility").cloned();
    let bundle_execution_surface = manifest_value
        .pointer("/compatibility/normalized_execution_surface")
        .and_then(JsonValue::as_str)
        .unwrap_or(if bindings.is_empty() {
            "recipe"
        } else {
            "desktop_capability"
        });
    let bundle_entry_path = resolve_skill_backend_entry_path(skill_path, &skill_def.manifest_json)?
        .map(|path| path.to_string_lossy().to_string());
    let bundle_runtime =
        (!skill_def.runtime_values.is_empty()).then(|| skill_def.runtime_values.join(","));

    let mut entries = Vec::with_capacity(bindings.len() + 1);
    entries.push(LocalCapabilityRegistryUpsert {
        capability_id: local_skill_bundle_capability_id(&skill_def.skill_id),
        source_kind: source_kind.to_string(),
        asset_kind: "skill_bundle".to_string(),
        package_id: skill_def.skill_id.clone(),
        package_version: skill_def.version.clone(),
        title: skill_def.display_name.clone(),
        description: skill_def.description.clone(),
        tool_name: None,
        callable_name: None,
        binding_kind: None,
        execution_surface: bundle_execution_surface.to_string(),
        runtime: bundle_runtime.clone(),
        entry_path: bundle_entry_path.clone(),
        is_direct_callable: false,
        activation_state: activation_state.to_string(),
        runtime_state: runtime_state.to_string(),
        search_index_state: search_index_state.to_string(),
        generation,
        descriptor_json: json!({
            "capability_id": local_skill_bundle_capability_id(&skill_def.skill_id),
            "source_kind": source_kind,
            "asset_kind": "skill_bundle",
            "skill_id": skill_def.skill_id.clone(),
            "display_name": skill_def.display_name.clone(),
            "version": skill_def.version.clone(),
            "description": skill_def.description.clone(),
            "doc_excerpt": skill_def.doc_excerpt.clone(),
            "execution_surface": bundle_execution_surface,
            "runtime_values": skill_def.runtime_values.clone(),
            "manifest": manifest_value.clone(),
        })
        .to_string(),
    });

    for binding in bindings {
        let execution_surface = if binding.binding_kind == "script_runner" {
            "script_runner"
        } else {
            "desktop_capability"
        };
        entries.push(LocalCapabilityRegistryUpsert {
            capability_id: local_skill_tool_capability_id(&skill_def.skill_id, &binding.tool_name),
            source_kind: source_kind.to_string(),
            asset_kind: "skill_tool".to_string(),
            package_id: skill_def.skill_id.clone(),
            package_version: skill_def.version.clone(),
            title: format!("{} / {}", skill_def.display_name, binding.tool_name),
            description: binding.description.clone(),
            tool_name: Some(binding.tool_name.clone()),
            callable_name: Some(binding.callable_name.clone()),
            binding_kind: Some(binding.binding_kind.clone()),
            execution_surface: execution_surface.to_string(),
            runtime: Some(binding.runtime.clone()),
            entry_path: Some(binding.entry_path.clone()),
            is_direct_callable: true,
            activation_state: activation_state.to_string(),
            runtime_state: runtime_state.to_string(),
            search_index_state: search_index_state.to_string(),
            generation,
            descriptor_json: json!({
                "capability_id": local_skill_tool_capability_id(&skill_def.skill_id, &binding.tool_name),
                "source_kind": source_kind,
                "asset_kind": "skill_tool",
                "skill_id": skill_def.skill_id.clone(),
                "display_name": skill_def.display_name.clone(),
                "version": skill_def.version.clone(),
                "binding_id": binding.binding_id.clone(),
                "binding_kind": binding.binding_kind.clone(),
                "callable_name": binding.callable_name.clone(),
                "tool_name": binding.tool_name.clone(),
                "description": binding.description.clone(),
                "execution_surface": execution_surface,
                "runtime": binding.runtime.clone(),
                "entry_path": binding.entry_path.clone(),
                "timeout_seconds": binding.timeout_seconds,
                "input_schema": binding.input_schema.clone(),
                "output_schema": binding.output_schema.clone(),
                "compatibility": compatibility.clone(),
                "restricted": skill_def.restricted,
                "allowed_roles": skill_def.allowed_roles.clone(),
            })
            .to_string(),
        });
    }

    Ok(entries)
}

fn registry_activation_state_for_install(install: &LocalSkillInstallDetail) -> &'static str {
    if install.is_enabled {
        "enabled"
    } else {
        "disabled"
    }
}

fn registry_runtime_state_for_install(install: &LocalSkillInstallDetail) -> String {
    let runtime = detect_local_skill_runtime(install);
    if runtime.supported {
        runtime.state.to_string()
    } else {
        "not_required".to_string()
    }
}

async fn index_local_skill_bundle_asset(
    provider_state: std::sync::Arc<crate::modules::providers::ProviderState>,
    memory_state: std::sync::Arc<crate::modules::memory::MemoryState>,
    skill_id: &str,
    display_name: &str,
    description: &str,
    doc_excerpt: Option<&str>,
    manifest_json: &str,
    source_type: &str,
) -> Result<(), String> {
    let mut body = format!(
        "skill: {}\ndescription: {}\nsource_type: {}\nmanifest: {}",
        display_name, description, source_type, manifest_json
    );
    if let Some(doc_excerpt) = doc_excerpt.filter(|text| !text.trim().is_empty()) {
        body.push_str("\n\ndocs:\n");
        body.push_str(doc_excerpt);
    }
    let vector = provider_state
        .embedding
        .embed_text(&body)
        .await
        .map_err(|e| e.to_string())?;
    let metadata = serde_json::from_str::<JsonValue>(manifest_json).ok();
    memory_state
        .store
        .upsert_asset(
            skill_id.to_string(),
            display_name.to_string(),
            description.to_string(),
            "skill".to_string(),
            source_type.to_string(),
            Some(skill_id.to_string()),
            vector,
            metadata,
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

async fn index_local_skill_tool_binding_assets(
    provider_state: std::sync::Arc<crate::modules::providers::ProviderState>,
    memory_state: std::sync::Arc<crate::modules::memory::MemoryState>,
    skill_id: &str,
    skill_display_name: &str,
    bindings: &[LocalSkillToolBindingDefinition],
    skill_manifest_json: &str,
    source_type: &str,
) -> Result<(), String> {
    let manifest_value = serde_json::from_str::<JsonValue>(skill_manifest_json).ok();
    let compatibility = manifest_value
        .as_ref()
        .and_then(|value| value.get("compatibility").cloned());
    let restricted = manifest_value
        .as_ref()
        .and_then(|value| value.get("restricted"))
        .and_then(JsonValue::as_bool)
        .unwrap_or(false);
    let allowed_roles = manifest_value
        .as_ref()
        .and_then(|value| value.get("allowed_roles"))
        .and_then(JsonValue::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(JsonValue::as_str)
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    for binding in bindings {
        let mut body = format!(
            "skill: {}\nskill_id: {}\ncallable_name: {}\ntool_name: {}\ndescription: {}\nexecution_lane: skill_runtime",
            skill_display_name,
            skill_id,
            binding.callable_name,
            binding.tool_name,
            binding.description
        );
        if let Some(input_schema) = binding.input_schema.as_ref() {
            body.push_str("\ninput_schema:\n");
            body.push_str(&input_schema.to_string());
        }
        if let Some(output_schema) = binding.output_schema.as_ref() {
            body.push_str("\noutput_schema:\n");
            body.push_str(&output_schema.to_string());
        }

        let vector = provider_state
            .embedding
            .embed_text(&body)
            .await
            .map_err(|e| e.to_string())?;

        let metadata = serde_json::json!({
            "asset_namespace": "skill",
            "binding_id": binding.binding_id,
            "binding_kind": binding.binding_kind,
            "skill_id": skill_id,
            "tool_name": binding.tool_name,
            "callable_name": binding.callable_name,
            "execution_lane": "skill_runtime",
            "input_schema": binding.input_schema,
            "output_schema": binding.output_schema,
            "entry_path": binding.entry_path,
            "runtime": binding.runtime,
            "timeout_seconds": binding.timeout_seconds,
            "compatibility": compatibility,
            "restricted": restricted,
            "allowed_roles": allowed_roles,
        });

        memory_state
            .store
            .upsert_asset(
                binding.binding_id.clone(),
                binding.callable_name.clone(),
                binding.description.clone(),
                "skill_tool".to_string(),
                source_type.to_string(),
                Some(skill_id.to_string()),
                vector,
                Some(metadata),
            )
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub(crate) fn resolve_shared_agent_skills_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".agents").join("skills"))
}

fn push_unique_path_candidate(candidates: &mut Vec<PathBuf>, candidate: Option<PathBuf>) {
    let Some(candidate) = candidate else {
        return;
    };
    if !candidates.iter().any(|existing| existing == &candidate) {
        candidates.push(candidate);
    }
}

fn resolve_workspace_packages_dir_from(current_dir: Option<&Path>, manifest_dir: &Path) -> PathBuf {
    let mut candidates = Vec::new();

    if let Some(current_dir) = current_dir {
        push_unique_path_candidate(&mut candidates, Some(current_dir.join("packages")));
        push_unique_path_candidate(
            &mut candidates,
            current_dir.parent().map(|parent| parent.join("packages")),
        );
        push_unique_path_candidate(
            &mut candidates,
            current_dir
                .parent()
                .and_then(|parent| parent.parent())
                .map(|parent| parent.join("packages")),
        );
    }

    push_unique_path_candidate(&mut candidates, Some(manifest_dir.join("packages")));
    push_unique_path_candidate(
        &mut candidates,
        manifest_dir.parent().map(|parent| parent.join("packages")),
    );
    push_unique_path_candidate(
        &mut candidates,
        manifest_dir
            .parent()
            .and_then(|parent| parent.parent())
            .map(|parent| parent.join("packages")),
    );

    candidates
        .iter()
        .find(|candidate| candidate.exists())
        .cloned()
        .unwrap_or_else(|| {
            manifest_dir
                .parent()
                .and_then(|parent| parent.parent())
                .map(|parent| parent.join("packages"))
                .unwrap_or_else(|| manifest_dir.join("packages"))
        })
}

pub(crate) fn resolve_workspace_packages_dir() -> PathBuf {
    let current_dir = std::env::current_dir().ok();
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    resolve_workspace_packages_dir_from(current_dir.as_deref(), manifest_dir)
}

pub(crate) fn resolve_workspace_official_skills_dir() -> PathBuf {
    resolve_workspace_packages_dir().join("official-skills")
}

pub(crate) fn resolve_workspace_deeting_sdk_dir() -> PathBuf {
    resolve_workspace_packages_dir().join("deeting-sdk")
}

pub(crate) fn select_official_skills_scan_dir(
    workspace_official_skills_dir: PathBuf,
    bundled_official_skills_dir: Option<PathBuf>,
) -> PathBuf {
    if workspace_official_skills_dir.exists() {
        workspace_official_skills_dir
    } else {
        bundled_official_skills_dir
            .filter(|path| path.exists())
            .unwrap_or(workspace_official_skills_dir)
    }
}

pub(crate) fn resolve_local_skill_scan_targets(
    app: &AppHandle,
) -> Result<Vec<(PathBuf, &'static str)>, String> {
    let workspace_official_skills_dir = resolve_workspace_official_skills_dir();
    let bundled_official_skills_dir = app
        .path()
        .resource_dir()
        .ok()
        .map(|p| p.join("official-skills"));
    let official_skills_dir =
        select_official_skills_scan_dir(workspace_official_skills_dir, bundled_official_skills_dir);
    let user_skills_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| err.to_string())?
        .join("skills");
    if !user_skills_dir.exists() {
        let _ = std::fs::create_dir_all(&user_skills_dir);
    }

    let mut scan_targets = vec![
        (official_skills_dir, "system_plugin"),
        (user_skills_dir, "user_skill"),
    ];

    if let Some(shared_agent_skills_dir) = resolve_shared_agent_skills_dir()
        .filter(|path| path.exists())
        .filter(|path| !local_skill_install_paths_match(path, &scan_targets[1].0))
    {
        scan_targets.push((shared_agent_skills_dir, "user_skill"));
    }

    Ok(scan_targets)
}

async fn cleanup_hidden_local_skill_installs(
    scan_targets: &[(PathBuf, &'static str)],
    store: &crate::modules::mcp::store::McpStore,
    memory_state: &crate::modules::memory::MemoryState,
) -> Result<(), String> {
    let installs = store
        .list_local_skill_installs()
        .await
        .map_err(|err| err.to_string())?;
    for install in installs {
        let install_path = Path::new(&install.install_path);
        if !scan_targets
            .iter()
            .any(|(root, _)| install_path.starts_with(root))
        {
            continue;
        }
        let Some(name) = install_path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if !name.starts_with('.') {
            continue;
        }

        store
            .delete_local_skill_install(&install.skill_id)
            .await
            .map_err(|err| err.to_string())?;
        let _ = memory_state
            .service
            .delete_assets_by_package(&install.skill_id)
            .await;
    }
    Ok(())
}

pub(crate) async fn register_local_skills_from_scan_targets_inner(
    scan_targets: &[(PathBuf, &'static str)],
    _sdk_pythonpath: &str,
    store: std::sync::Arc<crate::modules::mcp::store::McpStore>,
    provider_state: std::sync::Arc<crate::modules::providers::ProviderState>,
    memory_state: std::sync::Arc<crate::modules::memory::MemoryState>,
    wait_for_vector_index: bool,
) -> Result<usize, String> {
    let mut total_indexed = 0;
    cleanup_hidden_local_skill_installs(scan_targets, store.as_ref(), memory_state.as_ref())
        .await?;
    let registry_generation = store
        .next_local_capability_registry_generation()
        .await
        .map_err(|err| err.to_string())?;

    for (dir_path, source_prefix) in scan_targets {
        if !dir_path.exists() {
            continue;
        }
        for entry in std::fs::read_dir(dir_path).map_err(|err| err.to_string())? {
            let entry = entry.map_err(|err| err.to_string())?;
            let file_name = entry.file_name();
            let Some(name) = file_name.to_str() else {
                continue;
            };
            if name.starts_with('.') {
                continue;
            }
            let skill_path = entry.path();
            if !skill_path.is_dir() {
                continue;
            }
            let Some(skill_def) =
                resolve_local_skill_definition(&skill_path, source_prefix, None, None)?
            else {
                continue;
            };

            let id = skill_def.skill_id.as_str();
            let version = skill_def.version.as_deref();
            let runtime_str = skill_def.runtime_values.join(",");
            let runtime = Some(runtime_str.as_str());

            store
                .upsert_local_skill_install(
                    id,
                    version,
                    runtime,
                    &skill_def.manifest_json,
                    &skill_path.to_string_lossy(),
                )
                .await
                .map_err(|err| err.to_string())?;
            migrate_conflicting_local_skill_installs_for_path(store.as_ref(), id, &skill_path)
                .await?;

            let bindings = collect_local_skill_tool_bindings(&skill_path, &skill_def)?;
            store
                .replace_local_skill_tool_bindings(
                    id,
                    &bindings
                        .iter()
                        .map(
                            |binding| crate::modules::mcp::store::LocalSkillToolBindingUpsert {
                                binding_id: binding.binding_id.clone(),
                                binding_kind: binding.binding_kind.clone(),
                                callable_name: binding.callable_name.clone(),
                                tool_name: binding.tool_name.clone(),
                                description: binding.description.clone(),
                                input_schema_json: binding
                                    .input_schema
                                    .as_ref()
                                    .map(|value| value.to_string()),
                                output_schema_json: binding
                                    .output_schema
                                    .as_ref()
                                    .map(|value| value.to_string()),
                                entry_path: binding.entry_path.clone(),
                                runtime: binding.runtime.clone(),
                                timeout_seconds: binding.timeout_seconds,
                            },
                        )
                        .collect::<Vec<_>>(),
                )
                .await
                .map_err(|err| err.to_string())?;

            let final_source_type = if *source_prefix == "system_plugin" {
                "builtin"
            } else {
                "user"
            }
            .to_string();
            let install_detail = store
                .get_local_skill_install_detail(id)
                .await
                .map_err(|err| err.to_string())?
                .ok_or_else(|| format!("local skill install {} missing after upsert", id))?;
            let activation_state = registry_activation_state_for_install(&install_detail);
            let runtime_state = registry_runtime_state_for_install(&install_detail);
            let search_index_state = "pending";
            let registry_entries = build_local_skill_registry_entries(
                &skill_path,
                &skill_def,
                &bindings,
                &final_source_type,
                activation_state,
                &runtime_state,
                search_index_state,
                registry_generation,
            )?;
            store
                .replace_local_capability_registry_entries(id, &registry_entries)
                .await
                .map_err(|err| err.to_string())?;

            let _ = memory_state.service.delete_assets_by_package(id).await;

            if wait_for_vector_index {
                if let Err(err) = index_local_skill_bundle_asset(
                    provider_state.clone(),
                    memory_state.clone(),
                    id,
                    &skill_def.display_name,
                    &skill_def.description,
                    skill_def.doc_excerpt.as_deref(),
                    &skill_def.manifest_json,
                    &final_source_type,
                )
                .await
                {
                    let _ = store
                        .update_local_capability_registry_states(id, None, None, Some("failed"))
                        .await;
                    return Err(err);
                }
                if let Err(err) = index_local_skill_tool_binding_assets(
                    provider_state.clone(),
                    memory_state.clone(),
                    id,
                    &skill_def.display_name,
                    &bindings,
                    &skill_def.manifest_json,
                    &final_source_type,
                )
                .await
                {
                    let _ = store
                        .update_local_capability_registry_states(id, None, None, Some("failed"))
                        .await;
                    return Err(err);
                }
                store
                    .update_local_capability_registry_states(id, None, None, Some("ready"))
                    .await
                    .map_err(|err| err.to_string())?;
            } else {
                let provider_state_clone = provider_state.clone();
                let memory_state_clone = memory_state.clone();
                let store_clone = store.clone();
                let skill_id = id.to_string();
                let display_name = skill_def.display_name.clone();
                let description = skill_def.description.clone();
                let doc_excerpt = skill_def.doc_excerpt.clone();
                let manifest_json = skill_def.manifest_json.clone();
                let final_source_type_clone = final_source_type.clone();
                let bindings_clone = bindings.clone();
                let provider_state_clone_for_bindings = provider_state.clone();
                let memory_state_clone_for_bindings = memory_state.clone();
                tauri::async_runtime::spawn(async move {
                    let bundle_result = index_local_skill_bundle_asset(
                        provider_state_clone,
                        memory_state_clone,
                        &skill_id,
                        &display_name,
                        &description,
                        doc_excerpt.as_deref(),
                        &manifest_json,
                        &final_source_type_clone,
                    )
                    .await;
                    let binding_result = index_local_skill_tool_binding_assets(
                        provider_state_clone_for_bindings,
                        memory_state_clone_for_bindings,
                        &skill_id,
                        &display_name,
                        &bindings_clone,
                        &manifest_json,
                        &final_source_type_clone,
                    )
                    .await;
                    let search_index_state = if bundle_result.is_ok() && binding_result.is_ok() {
                        "ready"
                    } else {
                        "failed"
                    };
                    let _ = store_clone
                        .update_local_capability_registry_states(
                            &skill_id,
                            None,
                            None,
                            Some(search_index_state),
                        )
                        .await;
                });
            }
            total_indexed += 1;
        }
    }

    Ok(total_indexed)
}

#[cfg(test)]
mod tests {
    use super::resolve_workspace_packages_dir_from;
    use std::path::PathBuf;

    fn temp_path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "deeting-registry-scan-{label}-{}",
            uuid::Uuid::new_v4().simple()
        ))
    }

    #[test]
    fn resolve_workspace_packages_dir_from_prefers_repo_root_packages_for_tauri_dev_cwd() {
        let repo_root = temp_path("repo-root");
        let packages_dir = repo_root.join("packages");
        let app_dir = repo_root.join("deeting");
        let manifest_dir = app_dir.join("src-tauri");

        std::fs::create_dir_all(&packages_dir).expect("create packages dir");
        std::fs::create_dir_all(&manifest_dir).expect("create manifest dir");

        let resolved = resolve_workspace_packages_dir_from(Some(&app_dir), &manifest_dir);

        assert_eq!(resolved, packages_dir);

        let _ = std::fs::remove_dir_all(repo_root);
    }

    #[test]
    fn resolve_workspace_packages_dir_from_falls_back_to_manifest_relative_repo_root() {
        let repo_root = temp_path("manifest-root");
        let packages_dir = repo_root.join("packages");
        let manifest_dir = repo_root.join("deeting").join("src-tauri");
        let unrelated_cwd = temp_path("unrelated-cwd");

        std::fs::create_dir_all(&packages_dir).expect("create packages dir");
        std::fs::create_dir_all(&manifest_dir).expect("create manifest dir");
        std::fs::create_dir_all(&unrelated_cwd).expect("create unrelated cwd");

        let resolved =
            resolve_workspace_packages_dir_from(Some(unrelated_cwd.as_path()), &manifest_dir);

        assert_eq!(resolved, packages_dir);

        let _ = std::fs::remove_dir_all(repo_root);
        let _ = std::fs::remove_dir_all(unrelated_cwd);
    }
}
