use super::helpers::now_rfc3339;
use super::*;

impl McpStore {
    pub async fn current_local_capability_registry_generation(&self) -> Result<i64, McpError> {
        let value = self
            .get_desktop_config(LOCAL_CAPABILITY_REGISTRY_GENERATION_KEY)
            .await?
            .unwrap_or_default();
        Ok(value.trim().parse::<i64>().unwrap_or(0))
    }

    pub async fn next_local_capability_registry_generation(&self) -> Result<i64, McpError> {
        let mut tx = self.begin_write().await?;
        let row = sqlx::query(
            r#"
            SELECT value
            FROM desktop_config
            WHERE key = ?
            LIMIT 1;
            "#,
        )
        .bind(LOCAL_CAPABILITY_REGISTRY_GENERATION_KEY)
        .fetch_optional(tx.as_mut())
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let current = row
            .and_then(|value| value.try_get::<String, _>("value").ok())
            .and_then(|value| value.parse::<i64>().ok())
            .unwrap_or(0);
        let next = current.saturating_add(1);
        let now = now_rfc3339()?;

        sqlx::query(
            r#"
            INSERT INTO desktop_config (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
              value = excluded.value,
              updated_at = excluded.updated_at;
            "#,
        )
        .bind(LOCAL_CAPABILITY_REGISTRY_GENERATION_KEY)
        .bind(next.to_string())
        .bind(&now)
        .execute(tx.as_mut())
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        tx.commit()
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(next)
    }

    pub async fn replace_local_capability_registry_entries(
        &self,
        package_id: &str,
        entries: &[LocalCapabilityRegistryUpsert],
    ) -> Result<i64, McpError> {
        let normalized_package_id = package_id.trim().to_string();
        if normalized_package_id.is_empty() {
            return Err(McpError::validation("package_id is required"));
        }

        for entry in entries {
            if entry.capability_id.trim().is_empty() {
                return Err(McpError::validation("capability_id is required"));
            }
            if entry.package_id.trim() != normalized_package_id {
                return Err(McpError::validation(
                    "all capability registry entries must share the same package_id",
                ));
            }
        }

        let mut tx = self.begin_write().await?;
        sqlx::query("DELETE FROM local_capability_registry WHERE user_id = ? AND package_id = ?;")
            .bind(LOCAL_DESKTOP_USER_ID)
            .bind(&normalized_package_id)
            .execute(tx.as_mut())
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

        let now = now_rfc3339()?;
        for entry in entries {
            sqlx::query(
                r#"
                INSERT INTO local_capability_registry (
                  user_id, capability_id, source_kind, asset_kind, package_id, package_version,
                  title, description, tool_name, callable_name, binding_kind,
                  execution_surface, runtime, entry_path, is_direct_callable,
                  activation_state, runtime_state, search_index_state, generation,
                  descriptor_json, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                "#,
            )
            .bind(LOCAL_DESKTOP_USER_ID)
            .bind(entry.capability_id.trim())
            .bind(entry.source_kind.trim())
            .bind(entry.asset_kind.trim())
            .bind(&normalized_package_id)
            .bind(entry.package_version.as_deref())
            .bind(entry.title.trim())
            .bind(entry.description.trim())
            .bind(entry.tool_name.as_deref())
            .bind(entry.callable_name.as_deref())
            .bind(entry.binding_kind.as_deref())
            .bind(entry.execution_surface.trim())
            .bind(entry.runtime.as_deref())
            .bind(entry.entry_path.as_deref())
            .bind(if entry.is_direct_callable { 1 } else { 0 })
            .bind(entry.activation_state.trim())
            .bind(entry.runtime_state.trim())
            .bind(entry.search_index_state.trim())
            .bind(entry.generation)
            .bind(entry.descriptor_json.trim())
            .bind(&now)
            .bind(&now)
            .execute(tx.as_mut())
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        }

        tx.commit()
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(entries.len() as i64)
    }

    pub async fn list_local_capability_registry_entries(
        &self,
    ) -> Result<Vec<LocalCapabilityRegistrySnapshot>, McpError> {
        let rows = sqlx::query(
            r#"
            SELECT capability_id, source_kind, asset_kind, package_id, package_version,
                   title, description, tool_name, callable_name, binding_kind,
                   execution_surface, runtime, entry_path, is_direct_callable,
                   activation_state, runtime_state, search_index_state, generation,
                   descriptor_json, updated_at
            FROM local_capability_registry
            WHERE user_id = ?
            ORDER BY package_id ASC, asset_kind ASC, title ASC, capability_id ASC;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        rows.into_iter()
            .map(local_capability_registry_from_row)
            .collect::<Result<Vec<_>, _>>()
    }

    pub async fn list_local_capability_registry_entries_for_package(
        &self,
        package_id: &str,
    ) -> Result<Vec<LocalCapabilityRegistrySnapshot>, McpError> {
        let normalized_package_id = package_id.trim().to_string();
        if normalized_package_id.is_empty() {
            return Err(McpError::validation("package_id is required"));
        }

        let rows = sqlx::query(
            r#"
            SELECT capability_id, source_kind, asset_kind, package_id, package_version,
                   title, description, tool_name, callable_name, binding_kind,
                   execution_surface, runtime, entry_path, is_direct_callable,
                   activation_state, runtime_state, search_index_state, generation,
                   descriptor_json, updated_at
            FROM local_capability_registry
            WHERE user_id = ? AND package_id = ?
            ORDER BY asset_kind ASC, title ASC, capability_id ASC;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(&normalized_package_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        rows.into_iter()
            .map(local_capability_registry_from_row)
            .collect::<Result<Vec<_>, _>>()
    }

    pub async fn delete_local_capability_registry_entries(
        &self,
        package_id: &str,
    ) -> Result<i64, McpError> {
        let normalized_package_id = package_id.trim().to_string();
        if normalized_package_id.is_empty() {
            return Err(McpError::validation("package_id is required"));
        }

        let result = sqlx::query(
            "DELETE FROM local_capability_registry WHERE user_id = ? AND package_id = ?;",
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(&normalized_package_id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(result.rows_affected() as i64)
    }

    pub async fn update_local_capability_registry_states(
        &self,
        package_id: &str,
        activation_state: Option<&str>,
        runtime_state: Option<&str>,
        search_index_state: Option<&str>,
    ) -> Result<i64, McpError> {
        let normalized_package_id = package_id.trim().to_string();
        if normalized_package_id.is_empty() {
            return Err(McpError::validation("package_id is required"));
        }
        if activation_state.is_none() && runtime_state.is_none() && search_index_state.is_none() {
            return Ok(0);
        }

        let now = now_rfc3339()?;
        let result = sqlx::query(
            r#"
            UPDATE local_capability_registry
            SET activation_state = COALESCE(?, activation_state),
                runtime_state = COALESCE(?, runtime_state),
                search_index_state = COALESCE(?, search_index_state),
                updated_at = ?
            WHERE user_id = ? AND package_id = ?;
            "#,
        )
        .bind(
            activation_state
                .map(str::trim)
                .filter(|value| !value.is_empty()),
        )
        .bind(
            runtime_state
                .map(str::trim)
                .filter(|value| !value.is_empty()),
        )
        .bind(
            search_index_state
                .map(str::trim)
                .filter(|value| !value.is_empty()),
        )
        .bind(&now)
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(&normalized_package_id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(result.rows_affected() as i64)
    }

    pub async fn sync_mcp_tool_registry_entry(
        &self,
        tool: &crate::modules::mcp::types::McpTool,
    ) -> Result<i64, McpError> {
        let generation = self.next_local_capability_registry_generation().await?;
        let entry = build_mcp_tool_registry_entry(tool, generation);
        self.replace_local_capability_registry_entries(&tool.id, &[entry])
            .await
    }

    pub async fn sync_all_mcp_tool_registry_entries(&self) -> Result<i64, McpError> {
        let tools = self.list_tools().await?;
        let generation = self.next_local_capability_registry_generation().await?;
        let mut registry_packages = self
            .list_local_capability_registry_entries()
            .await?
            .into_iter()
            .filter(|entry| entry.source_kind == "mcp")
            .map(|entry| entry.package_id)
            .collect::<std::collections::BTreeSet<_>>();
        let mut count = 0i64;
        for tool in tools {
            let entry = build_mcp_tool_registry_entry(&tool, generation);
            count += self
                .replace_local_capability_registry_entries(&tool.id, &[entry])
                .await?;
            registry_packages.remove(&tool.id);
        }
        for stale_package in registry_packages {
            count += self
                .delete_local_capability_registry_entries(&stale_package)
                .await?;
        }
        Ok(count)
    }

    pub async fn sync_assistant_registry_entry(&self, assistant_id: &str) -> Result<i64, McpError> {
        let normalized_assistant_id = assistant_id.trim().to_string();
        if normalized_assistant_id.is_empty() {
            return Err(McpError::validation("assistant_id is required"));
        }
        let assistants = self.list_local_assistants().await?;
        let enabled_ids = self.list_enabled_local_assistant_ids().await?;
        let generation = self.next_local_capability_registry_generation().await?;
        let Some(assistant) = assistants
            .into_iter()
            .find(|assistant| assistant.id == normalized_assistant_id)
        else {
            return self.delete_local_capability_registry_entries(&normalized_assistant_id);
        };
        let entry = build_assistant_registry_entry(
            &assistant,
            enabled_ids.contains(assistant.id.as_str()),
            generation,
        );
        self.replace_local_capability_registry_entries(&assistant.id, &[entry])
            .await
    }

    pub async fn sync_all_assistant_registry_entries(&self) -> Result<i64, McpError> {
        let assistants = self.list_local_assistants().await?;
        let enabled_ids = self.list_enabled_local_assistant_ids().await?;
        let generation = self.next_local_capability_registry_generation().await?;
        let mut registry_packages = self
            .list_local_capability_registry_entries()
            .await?
            .into_iter()
            .filter(|entry| entry.source_kind == "assistant")
            .map(|entry| entry.package_id)
            .collect::<std::collections::BTreeSet<_>>();
        let mut count = 0i64;
        for assistant in assistants {
            let entry = build_assistant_registry_entry(
                &assistant,
                enabled_ids.contains(assistant.id.as_str()),
                generation,
            );
            count += self
                .replace_local_capability_registry_entries(&assistant.id, &[entry])
                .await?;
            registry_packages.remove(&assistant.id);
        }
        for stale_package in registry_packages {
            count += self
                .delete_local_capability_registry_entries(&stale_package)
                .await?;
        }
        Ok(count)
    }

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
            return self.delete_local_capability_registry_entries(&normalized_skill_id);
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

fn mcp_tool_runtime_state(tool: &crate::modules::mcp::types::McpTool) -> &'static str {
    use crate::modules::mcp::types::McpToolStatus;

    match tool.status {
        McpToolStatus::Healthy | McpToolStatus::Degraded => "ready",
        McpToolStatus::Stopped => "stopped",
        McpToolStatus::Pending | McpToolStatus::Starting | McpToolStatus::Updating => "pending",
        McpToolStatus::Crashed | McpToolStatus::Error | McpToolStatus::Orphaned => "error",
    }
}

fn build_mcp_tool_registry_entry(
    tool: &crate::modules::mcp::types::McpTool,
    generation: i64,
) -> LocalCapabilityRegistryUpsert {
    let runtime_state = mcp_tool_runtime_state(tool);
    LocalCapabilityRegistryUpsert {
        capability_id: tool.id.clone(),
        source_kind: "mcp".to_string(),
        asset_kind: "mcp_tool".to_string(),
        package_id: tool.id.clone(),
        package_version: None,
        title: tool.name.clone(),
        description: tool.description.clone(),
        tool_name: Some(tool.name.clone()),
        callable_name: None,
        binding_kind: None,
        execution_surface: tool.transport_label().to_string(),
        runtime: Some(tool.transport_label().to_string()),
        entry_path: tool.command.clone(),
        is_direct_callable: runtime_state == "ready",
        activation_state: "enabled".to_string(),
        runtime_state: runtime_state.to_string(),
        search_index_state: "not_required".to_string(),
        generation,
        descriptor_json: serde_json::json!({
            "tool_id": tool.id,
            "source_id": tool.source_id,
            "identifier": tool.identifier,
            "tool_name": tool.name,
            "description": tool.description,
            "transport": tool.transport_label(),
            "remote_sse_url": tool.remote_sse_url(),
            "remote_tool_name": tool.remote_tool_name(),
            "remote_server_name": tool.remote_server_name(),
            "capabilities": tool.capabilities,
            "read_only": tool.is_read_only,
            "command": tool.command,
            "args": tool.args,
            "status": tool.status.as_str(),
            "activation_state": "enabled",
            "runtime_state": runtime_state,
            "search_index_state": "not_required",
        })
        .to_string(),
    }
}

fn build_assistant_registry_entry(
    assistant: &crate::modules::mcp::types::LocalAssistant,
    is_enabled: bool,
    generation: i64,
) -> LocalCapabilityRegistryUpsert {
    let activation_state = if is_enabled { "enabled" } else { "disabled" };
    LocalCapabilityRegistryUpsert {
        capability_id: assistant.id.clone(),
        source_kind: "assistant".to_string(),
        asset_kind: "assistant".to_string(),
        package_id: assistant.id.clone(),
        package_version: None,
        title: assistant.name.clone(),
        description: assistant.description.clone().unwrap_or_default(),
        tool_name: None,
        callable_name: None,
        binding_kind: None,
        execution_surface: "assistant".to_string(),
        runtime: None,
        entry_path: None,
        is_direct_callable: false,
        activation_state: activation_state.to_string(),
        runtime_state: "not_required".to_string(),
        search_index_state: "auxiliary".to_string(),
        generation,
        descriptor_json: serde_json::json!({
            "assistant_id": assistant.id.clone(),
            "name": assistant.name.clone(),
            "description": assistant.description.clone(),
            "avatar": assistant.avatar.clone(),
            "system_prompt": assistant.system_prompt.clone(),
            "model_config": assistant.model_config.clone(),
            "tags": assistant.tags.clone(),
            "visibility": assistant.visibility.clone(),
            "source": assistant.source.clone(),
            "cloud_id": assistant.cloud_id.clone(),
            "is_deleted": assistant.is_deleted,
            "activation_state": activation_state,
            "runtime_state": "not_required",
            "search_index_state": "auxiliary",
        })
        .to_string(),
    }
}

fn local_skill_source_kind(install_path: &str) -> &'static str {
    let normalized = install_path.replace('\\', "/");
    if normalized.contains("/official-skills/") {
        "builtin"
    } else {
        "user"
    }
}

fn build_local_skill_registry_entries_from_store(
    install: &crate::modules::mcp::store::LocalSkillInstallDetail,
    bindings: &[crate::modules::mcp::store::LocalSkillToolBindingSnapshot],
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

fn local_capability_registry_from_row(
    row: SqliteRow,
) -> Result<LocalCapabilityRegistrySnapshot, McpError> {
    let descriptor_raw = row.try_get::<String, _>("descriptor_json")?;
    let descriptor_json = serde_json::from_str::<serde_json::Value>(&descriptor_raw)
        .map_err(|err| McpError::Storage(err.to_string()))?;

    Ok(LocalCapabilityRegistrySnapshot {
        capability_id: row.try_get::<String, _>("capability_id")?,
        source_kind: row.try_get::<String, _>("source_kind")?,
        asset_kind: row.try_get::<String, _>("asset_kind")?,
        package_id: row.try_get::<String, _>("package_id")?,
        package_version: row.try_get::<Option<String>, _>("package_version")?,
        title: row.try_get::<String, _>("title")?,
        description: row.try_get::<String, _>("description")?,
        tool_name: row.try_get::<Option<String>, _>("tool_name")?,
        callable_name: row.try_get::<Option<String>, _>("callable_name")?,
        binding_kind: row.try_get::<Option<String>, _>("binding_kind")?,
        execution_surface: row.try_get::<String, _>("execution_surface")?,
        runtime: row.try_get::<Option<String>, _>("runtime")?,
        entry_path: row.try_get::<Option<String>, _>("entry_path")?,
        is_direct_callable: row.try_get::<i64, _>("is_direct_callable")? != 0,
        activation_state: row.try_get::<String, _>("activation_state")?,
        runtime_state: row.try_get::<String, _>("runtime_state")?,
        search_index_state: row.try_get::<String, _>("search_index_state")?,
        generation: row.try_get::<i64, _>("generation")?,
        descriptor_json,
        updated_at: row.try_get::<String, _>("updated_at")?,
    })
}
