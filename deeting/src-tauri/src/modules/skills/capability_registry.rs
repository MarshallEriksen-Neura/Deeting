use crate::modules::mcp::error::McpError;
use crate::modules::mcp::store::McpStore;
use mcp_registry::types::LocalCapabilityRegistryUpsert;
use mcp_storage::types::{LocalSkillInstallDetail, LocalSkillToolBindingSnapshot};

fn local_skill_source_kind(install_path: &str) -> &'static str {
    let normalized = install_path.replace('\\', "/");
    if normalized.contains("/official-skills/") {
        "builtin"
    } else {
        "user"
    }
}

fn build_local_skill_registry_entries_from_store(
    install: &LocalSkillInstallDetail,
    bindings: &[LocalSkillToolBindingSnapshot],
    generation: i64,
) -> Vec<LocalCapabilityRegistryUpsert> {
    let manifest = serde_json::from_str::<serde_json::Value>(&install.manifest_json)
        .unwrap_or_else(|_| serde_json::json!({}));
    let source_kind = local_skill_source_kind(&install.install_path);
    let title = manifest
        .get("name")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(install.skill_id.as_str())
        .to_string();
    let description = manifest
        .get("description")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("")
        .to_string();
    let activation_state = if install.is_enabled {
        "enabled"
    } else {
        "disabled"
    };
    let runtime_state = {
        let status = crate::modules::skill_runtime::detect_local_skill_runtime(install);
        if status.supported {
            status.state.to_string()
        } else {
            "not_required".to_string()
        }
    };
    let bundle_execution_surface = manifest
        .pointer("/compatibility/normalized_execution_surface")
        .and_then(serde_json::Value::as_str)
        .unwrap_or(if bindings.is_empty() {
            "recipe"
        } else {
            "desktop_capability"
        })
        .to_string();

    let mut entries = Vec::with_capacity(bindings.len() + 1);
    entries.push(LocalCapabilityRegistryUpsert {
        capability_id: format!("skill_bundle::{}", install.skill_id),
        source_kind: source_kind.to_string(),
        asset_kind: "skill_bundle".to_string(),
        package_id: install.skill_id.clone(),
        package_version: install.installed_version.clone(),
        title: title.clone(),
        description: description.clone(),
        tool_name: None,
        callable_name: None,
        binding_kind: None,
        execution_surface: bundle_execution_surface.clone(),
        runtime: install.runtime.clone(),
        entry_path: manifest
            .pointer("/entry/backend")
            .and_then(serde_json::Value::as_str)
            .map(|entry| {
                format!(
                    "{}/{}",
                    install.install_path.replace('\\', "/"),
                    entry.trim()
                )
            }),
        is_direct_callable: false,
        activation_state: activation_state.to_string(),
        runtime_state: runtime_state.clone(),
        search_index_state: "pending".to_string(),
        generation,
        descriptor_json: serde_json::json!({
            "skill_id": install.skill_id,
            "display_name": title,
            "description": description,
            "execution_surface": bundle_execution_surface,
            "manifest": manifest,
        })
        .to_string(),
    });

    let compatibility = manifest.get("compatibility").cloned();
    let restricted = manifest
        .get("restricted")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    let allowed_roles = manifest
        .get("allowed_roles")
        .cloned()
        .unwrap_or_else(|| serde_json::json!([]));
    for binding in bindings {
        let execution_surface = if binding.binding_kind == "script_runner" {
            "script_runner"
        } else {
            "desktop_capability"
        };
        entries.push(LocalCapabilityRegistryUpsert {
            capability_id: format!("skill_tool::{}::{}", install.skill_id, binding.tool_name),
            source_kind: source_kind.to_string(),
            asset_kind: "skill_tool".to_string(),
            package_id: install.skill_id.clone(),
            package_version: install.installed_version.clone(),
            title: format!("{} / {}", title, binding.tool_name),
            description: binding.description.clone(),
            tool_name: Some(binding.tool_name.clone()),
            callable_name: Some(binding.callable_name.clone()),
            binding_kind: Some(binding.binding_kind.clone()),
            execution_surface: execution_surface.to_string(),
            runtime: Some(binding.runtime.clone()),
            entry_path: Some(binding.entry_path.clone()),
            is_direct_callable: true,
            activation_state: activation_state.to_string(),
            runtime_state: runtime_state.clone(),
            search_index_state: "pending".to_string(),
            generation,
            descriptor_json: serde_json::json!({
                "skill_id": install.skill_id,
                "binding_id": binding.binding_id,
                "binding_kind": binding.binding_kind,
                "callable_name": binding.callable_name,
                "tool_name": binding.tool_name,
                "description": binding.description,
                "execution_surface": execution_surface,
                "runtime": binding.runtime,
                "entry_path": binding.entry_path,
                "timeout_seconds": binding.timeout_seconds,
                "input_schema": binding.input_schema,
                "output_schema": binding.output_schema,
                "compatibility": compatibility,
                "restricted": restricted,
                "allowed_roles": allowed_roles,
            })
            .to_string(),
        });
    }

    entries
}

impl McpStore {
    pub async fn sync_local_skill_registry_entry_from_store(
        &self,
        skill_id: &str,
    ) -> Result<i64, McpError> {
        let normalized_skill_id = skill_id.trim().to_string();
        if normalized_skill_id.is_empty() {
            return Err(McpError::validation("skill_id is required"));
        }
        let Some(install) = self
            .get_local_skill_install_detail(&normalized_skill_id)
            .await?
        else {
            return self
                .delete_local_capability_registry_entries(&normalized_skill_id)
                .await;
        };
        let bindings = self
            .list_local_skill_tool_bindings_for_skill(&normalized_skill_id)
            .await?;
        let generation = self.next_local_capability_registry_generation().await?;
        let entries =
            build_local_skill_registry_entries_from_store(&install, &bindings, generation);
        self.replace_local_capability_registry_entries(&normalized_skill_id, &entries)
            .await
    }
}
