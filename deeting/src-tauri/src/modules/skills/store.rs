use std::collections::{HashMap, HashSet};

use serde_json::Value;
use sqlx::sqlite::SqliteRow;
use sqlx::Row;

use crate::modules::mcp::commands::runtime::capability_registry_cache::invalidate_capability_registry_cache;
use crate::modules::mcp::error::McpError;
use crate::modules::mcp::store::McpStore;
use mcp_storage::helpers::now_rfc3339;
use mcp_storage::types::{
    LocalSkillInstallDetail, LocalSkillInstallSnapshot, LocalSkillToolBindingSnapshot,
    LocalSkillToolBindingUpsert,
};

const LOCAL_DESKTOP_USER_ID: &str = "00000000-0000-0000-0000-000000000000";

impl McpStore {
    pub async fn upsert_local_skill_install(
        &self,
        skill_id: &str,
        installed_version: Option<&str>,
        runtime: Option<&str>,
        manifest_json: &str,
        install_path: &str,
    ) -> Result<(), McpError> {
        let normalized_skill_id = skill_id.trim().to_string();
        if normalized_skill_id.is_empty() {
            return Err(McpError::validation("skill_id is required"));
        }
        let normalized_manifest = manifest_json.trim().to_string();
        if normalized_manifest.is_empty() {
            return Err(McpError::validation("manifest_json is required"));
        }
        let normalized_path = install_path.trim().to_string();
        if normalized_path.is_empty() {
            return Err(McpError::validation("install_path is required"));
        }

        let normalized_version = installed_version
            .map(|raw| raw.trim().to_string())
            .filter(|raw| !raw.is_empty())
            .unwrap_or_else(|| "0.0.0".to_string());
        let normalized_runtime = runtime
            .map(|raw| raw.trim().to_string())
            .filter(|raw| !raw.is_empty());
        let now = now_rfc3339()?;

        sqlx::query(
            r#"
            INSERT INTO local_skill_install (
              user_id, skill_id, installed_version, is_enabled, runtime,
              manifest_json, install_path, user_settings_json, installed_at, updated_at
            )
            VALUES (?, ?, ?, 1, ?, ?, ?, NULL, ?, ?)
            ON CONFLICT(user_id, skill_id) DO UPDATE SET
              installed_version = excluded.installed_version,
              runtime = excluded.runtime,
              manifest_json = excluded.manifest_json,
              install_path = excluded.install_path,
              updated_at = excluded.updated_at;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(&normalized_skill_id)
        .bind(&normalized_version)
        .bind(normalized_runtime.as_deref())
        .bind(&normalized_manifest)
        .bind(&normalized_path)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        self.sync_local_skill_registry_entry_from_store(&normalized_skill_id)
            .await?;

        Ok(())
    }

    pub async fn list_enabled_local_skill_ids(&self) -> Result<HashSet<String>, McpError> {
        let rows = sqlx::query(
            r#"
            SELECT skill_id
            FROM local_skill_install
            WHERE user_id = ? AND is_enabled = 1;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut ids = HashSet::with_capacity(rows.len());
        for row in rows {
            let skill_id = row.try_get::<String, _>("skill_id")?;
            let normalized = skill_id.trim().to_string();
            if !normalized.is_empty() {
                ids.insert(normalized);
            }
        }
        Ok(ids)
    }

    pub async fn list_local_skill_installs(
        &self,
    ) -> Result<Vec<LocalSkillInstallSnapshot>, McpError> {
        let rows = sqlx::query(
            r#"
            SELECT skill_id, installed_version, is_enabled, runtime, install_path
            FROM local_skill_install
            WHERE user_id = ?
            ORDER BY updated_at DESC;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut installs = Vec::with_capacity(rows.len());
        for row in rows {
            let skill_id = row.try_get::<String, _>("skill_id")?.trim().to_string();
            let install_path = row.try_get::<String, _>("install_path")?.trim().to_string();
            if skill_id.is_empty() || install_path.is_empty() {
                continue;
            }
            installs.push(LocalSkillInstallSnapshot {
                skill_id,
                installed_version: row.try_get::<Option<String>, _>("installed_version")?,
                is_enabled: row.try_get::<i64, _>("is_enabled")? != 0,
                runtime: row.try_get::<Option<String>, _>("runtime")?,
                install_path,
            });
        }

        Ok(installs)
    }

    pub async fn list_local_skill_install_details(
        &self,
    ) -> Result<Vec<LocalSkillInstallDetail>, McpError> {
        let rows = sqlx::query(
            r#"
            SELECT skill_id, installed_version, is_enabled, runtime, install_path, manifest_json, user_settings_json
            FROM local_skill_install
            WHERE user_id = ?
            ORDER BY updated_at DESC;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut installs = Vec::with_capacity(rows.len());
        for row in rows {
            let skill_id = row.try_get::<String, _>("skill_id")?.trim().to_string();
            let install_path = row.try_get::<String, _>("install_path")?.trim().to_string();
            let manifest_json = row.try_get::<String, _>("manifest_json")?;
            if skill_id.is_empty() || install_path.is_empty() || manifest_json.trim().is_empty() {
                continue;
            }
            let user_settings_json = row
                .try_get::<Option<String>, _>("user_settings_json")?
                .and_then(|raw| serde_json::from_str::<Value>(&raw).ok());
            installs.push(LocalSkillInstallDetail {
                skill_id,
                installed_version: row.try_get::<Option<String>, _>("installed_version")?,
                is_enabled: row.try_get::<i64, _>("is_enabled")? != 0,
                runtime: row.try_get::<Option<String>, _>("runtime")?,
                install_path,
                manifest_json,
                user_settings_json,
            });
        }

        Ok(installs)
    }

    pub async fn get_local_skill_install_detail(
        &self,
        skill_id: &str,
    ) -> Result<Option<LocalSkillInstallDetail>, McpError> {
        let normalized_skill_id = skill_id.trim().to_string();
        if normalized_skill_id.is_empty() {
            return Err(McpError::validation("skill_id is required"));
        }
        let row = sqlx::query(
            r#"
            SELECT skill_id, installed_version, is_enabled, runtime, install_path, manifest_json, user_settings_json
            FROM local_skill_install
            WHERE user_id = ? AND skill_id = ?
            LIMIT 1;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(&normalized_skill_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let Some(row) = row else {
            return Ok(None);
        };
        let skill_id = row.try_get::<String, _>("skill_id")?.trim().to_string();
        let install_path = row.try_get::<String, _>("install_path")?.trim().to_string();
        let manifest_json = row.try_get::<String, _>("manifest_json")?;
        let user_settings_json = row
            .try_get::<Option<String>, _>("user_settings_json")?
            .and_then(|raw| serde_json::from_str::<Value>(&raw).ok());
        Ok(Some(LocalSkillInstallDetail {
            skill_id,
            installed_version: row.try_get::<Option<String>, _>("installed_version")?,
            is_enabled: row.try_get::<i64, _>("is_enabled")? != 0,
            runtime: row.try_get::<Option<String>, _>("runtime")?,
            install_path,
            manifest_json,
            user_settings_json,
        }))
    }

    pub async fn replace_local_skill_tool_bindings(
        &self,
        skill_id: &str,
        bindings: &[LocalSkillToolBindingUpsert],
    ) -> Result<i64, McpError> {
        let normalized_skill_id = skill_id.trim().to_string();
        if normalized_skill_id.is_empty() {
            return Err(McpError::validation("skill_id is required"));
        }

        let mut tx = self.begin_write().await?;
        sqlx::query("DELETE FROM local_skill_tool_binding WHERE user_id = ? AND skill_id = ?;")
            .bind(LOCAL_DESKTOP_USER_ID)
            .bind(&normalized_skill_id)
            .execute(tx.as_mut())
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

        let now = now_rfc3339()?;
        for binding in bindings {
            sqlx::query(
                r#"
                INSERT INTO local_skill_tool_binding (
                  user_id, binding_id, binding_kind, skill_id, callable_name, tool_name, description,
                  input_schema_json, output_schema_json, entry_path, runtime,
                  timeout_seconds, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                "#,
            )
            .bind(LOCAL_DESKTOP_USER_ID)
            .bind(binding.binding_id.trim())
            .bind(binding.binding_kind.trim())
            .bind(&normalized_skill_id)
            .bind(binding.callable_name.trim())
            .bind(binding.tool_name.trim())
            .bind(binding.description.trim())
            .bind(binding.input_schema_json.as_deref())
            .bind(binding.output_schema_json.as_deref())
            .bind(binding.entry_path.trim())
            .bind(binding.runtime.trim())
            .bind(i64::try_from(binding.timeout_seconds).unwrap_or(i64::MAX))
            .bind(&now)
            .execute(tx.as_mut())
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        }
        tx.commit()
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        self.sync_local_skill_registry_entry_from_store(&normalized_skill_id)
            .await?;
        Ok(bindings.len() as i64)
    }

    pub async fn list_local_skill_tool_bindings_for_skill(
        &self,
        skill_id: &str,
    ) -> Result<Vec<LocalSkillToolBindingSnapshot>, McpError> {
        let normalized_skill_id = skill_id.trim().to_string();
        if normalized_skill_id.is_empty() {
            return Err(McpError::validation("skill_id is required"));
        }

        let rows = sqlx::query(
            r#"
            SELECT binding_id, skill_id, callable_name, tool_name, description,
                   binding_kind, input_schema_json, output_schema_json, entry_path, runtime,
                   timeout_seconds, updated_at
            FROM local_skill_tool_binding
            WHERE user_id = ? AND skill_id = ?
            ORDER BY tool_name ASC;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(&normalized_skill_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        rows.into_iter()
            .map(local_skill_tool_binding_from_row)
            .collect::<Result<Vec<_>, _>>()
    }

    pub async fn list_enabled_local_skill_tool_bindings(
        &self,
    ) -> Result<Vec<LocalSkillToolBindingSnapshot>, McpError> {
        let rows = sqlx::query(
            r#"
            SELECT b.binding_id, b.skill_id, b.callable_name, b.tool_name, b.description,
                   b.binding_kind, b.input_schema_json, b.output_schema_json, b.entry_path, b.runtime,
                   b.timeout_seconds, b.updated_at
            FROM local_skill_tool_binding b
            JOIN local_skill_install s
              ON s.user_id = b.user_id
             AND s.skill_id = b.skill_id
            WHERE b.user_id = ?
              AND s.is_enabled = 1
            ORDER BY b.skill_id ASC, b.tool_name ASC;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        rows.into_iter()
            .map(local_skill_tool_binding_from_row)
            .collect::<Result<Vec<_>, _>>()
    }

    pub async fn get_enabled_local_skill_tool_binding_by_ref(
        &self,
        binding_id: Option<&str>,
        callable_name: Option<&str>,
    ) -> Result<Option<LocalSkillToolBindingSnapshot>, McpError> {
        let normalized_binding_id = binding_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        let normalized_callable_name = callable_name
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);

        if normalized_binding_id.is_none() && normalized_callable_name.is_none() {
            return Err(McpError::validation(
                "binding_id or callable_name is required",
            ));
        }

        let row = if let Some(binding_id) = normalized_binding_id {
            sqlx::query(
                r#"
                SELECT b.binding_id, b.skill_id, b.callable_name, b.tool_name, b.description,
                       b.binding_kind, b.input_schema_json, b.output_schema_json, b.entry_path, b.runtime,
                       b.timeout_seconds, b.updated_at
                FROM local_skill_tool_binding b
                JOIN local_skill_install s
                  ON s.user_id = b.user_id
                 AND s.skill_id = b.skill_id
                WHERE b.user_id = ?
                  AND b.binding_id = ?
                  AND s.is_enabled = 1
                LIMIT 1;
                "#,
            )
            .bind(LOCAL_DESKTOP_USER_ID)
            .bind(binding_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?
        } else {
            sqlx::query(
                r#"
                SELECT b.binding_id, b.skill_id, b.callable_name, b.tool_name, b.description,
                       b.binding_kind, b.input_schema_json, b.output_schema_json, b.entry_path, b.runtime,
                       b.timeout_seconds, b.updated_at
                FROM local_skill_tool_binding b
                JOIN local_skill_install s
                  ON s.user_id = b.user_id
                 AND s.skill_id = b.skill_id
                WHERE b.user_id = ?
                  AND b.callable_name = ?
                  AND s.is_enabled = 1
                LIMIT 1;
                "#,
            )
            .bind(LOCAL_DESKTOP_USER_ID)
            .bind(normalized_callable_name.unwrap_or_default())
            .fetch_optional(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?
        };

        let binding = row.map(local_skill_tool_binding_from_row).transpose()?;
        if let Some(binding) = binding {
            let entry_path = std::path::Path::new(&binding.entry_path);
            if entry_path.exists() {
                return Ok(Some(binding));
            }
            let _ = self.delete_local_skill_install(&binding.skill_id).await;
            return Ok(None);
        }
        Ok(None)
    }

    pub async fn get_enabled_local_skill_manifest_json(
        &self,
        skill_id: &str,
    ) -> Result<Option<String>, McpError> {
        let normalized_skill_id = skill_id.trim().to_string();
        if normalized_skill_id.is_empty() {
            return Err(McpError::validation("skill_id is required"));
        }

        let row = sqlx::query(
            r#"
            SELECT manifest_json
            FROM local_skill_install
            WHERE user_id = ? AND skill_id = ? AND is_enabled = 1
            LIMIT 1;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(&normalized_skill_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(row.and_then(|row| row.try_get::<String, _>("manifest_json").ok()))
    }

    pub async fn get_local_skill_install_path(
        &self,
        skill_id: &str,
    ) -> Result<Option<String>, McpError> {
        let normalized_skill_id = skill_id.trim().to_string();
        if normalized_skill_id.is_empty() {
            return Err(McpError::validation("skill_id is required"));
        }

        let row = sqlx::query(
            r#"
            SELECT install_path
            FROM local_skill_install
            WHERE user_id = ? AND skill_id = ?
            LIMIT 1;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(&normalized_skill_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(row.and_then(|row| row.try_get::<String, _>("install_path").ok()))
    }

    pub async fn update_local_skill_user_settings(
        &self,
        skill_id: &str,
        user_settings_json: &Value,
    ) -> Result<(), McpError> {
        let normalized_skill_id = skill_id.trim().to_string();
        if normalized_skill_id.is_empty() {
            return Err(McpError::validation("skill_id is required"));
        }
        let now = now_rfc3339()?;
        let serialized = serde_json::to_string(user_settings_json)
            .map_err(|err| McpError::Storage(err.to_string()))?;
        let result = sqlx::query(
            r#"
            UPDATE local_skill_install
            SET user_settings_json = ?, updated_at = ?
            WHERE user_id = ? AND skill_id = ?;
            "#,
        )
        .bind(serialized)
        .bind(now)
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(&normalized_skill_id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        if result.rows_affected() == 0 {
            return Err(McpError::NotFound(format!(
                "local skill install {} not found",
                normalized_skill_id
            )));
        }
        Ok(())
    }

    pub async fn replace_local_skill_env_secrets(
        &self,
        skill_id: &str,
        env_json: &HashMap<String, String>,
    ) -> Result<(), McpError> {
        let normalized_skill_id = skill_id.trim().to_string();
        if normalized_skill_id.is_empty() {
            return Err(McpError::validation("skill_id is required"));
        }

        let mut tx = self.begin_write().await?;
        sqlx::query("DELETE FROM local_skill_secret WHERE user_id = ? AND skill_id = ?;")
            .bind(LOCAL_DESKTOP_USER_ID)
            .bind(&normalized_skill_id)
            .execute(tx.as_mut())
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

        let now = now_rfc3339()?;
        for (env_key, value) in env_json {
            let trimmed_key = env_key.trim();
            let trimmed_value = value.trim();
            if trimmed_key.is_empty() || trimmed_value.is_empty() {
                continue;
            }
            let secret_ref = format!("skill-env:{normalized_skill_id}:{trimmed_key}");
            let (ciphertext, key_version) = self
                .secret_store
                .encrypt_for_db(&secret_ref, trimmed_value)
                .map_err(|err| McpError::Storage(err.to_string()))?;
            sqlx::query(
                r#"
                INSERT INTO local_skill_secret (
                  user_id, skill_id, env_key, secret_ciphertext, secret_key_version, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?);
                "#,
            )
            .bind(LOCAL_DESKTOP_USER_ID)
            .bind(&normalized_skill_id)
            .bind(trimmed_key)
            .bind(ciphertext)
            .bind(key_version)
            .bind(&now)
            .execute(tx.as_mut())
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        }

        tx.commit()
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(())
    }

    pub async fn get_local_skill_env_secrets(
        &self,
        skill_id: &str,
    ) -> Result<HashMap<String, String>, McpError> {
        let normalized_skill_id = skill_id.trim().to_string();
        if normalized_skill_id.is_empty() {
            return Err(McpError::validation("skill_id is required"));
        }

        let rows = sqlx::query(
            r#"
            SELECT env_key, secret_ciphertext, secret_key_version
            FROM local_skill_secret
            WHERE user_id = ? AND skill_id = ?;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(&normalized_skill_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut env = HashMap::new();
        for row in rows {
            let env_key = row.try_get::<String, _>("env_key")?;
            let ciphertext = row.try_get::<String, _>("secret_ciphertext")?;
            let key_version = row.try_get::<i64, _>("secret_key_version")?;
            let secret_ref = format!("skill-env:{normalized_skill_id}:{}", env_key.trim());
            if let Some(secret) = self
                .secret_store
                .decrypt_from_db(&secret_ref, &ciphertext, key_version)
                .map_err(|err| McpError::Storage(err.to_string()))?
            {
                env.insert(env_key, secret);
            }
        }
        Ok(env)
    }

    pub async fn has_local_skill_env_secret(
        &self,
        skill_id: &str,
        env_key: &str,
    ) -> Result<bool, McpError> {
        let normalized_skill_id = skill_id.trim().to_string();
        let normalized_env_key = env_key.trim().to_string();
        if normalized_skill_id.is_empty() || normalized_env_key.is_empty() {
            return Err(McpError::validation("skill_id and env_key are required"));
        }
        let row = sqlx::query(
            r#"
            SELECT 1
            FROM local_skill_secret
            WHERE user_id = ? AND skill_id = ? AND env_key = ?
            LIMIT 1;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(&normalized_skill_id)
        .bind(&normalized_env_key)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(row.is_some())
    }

    pub async fn upsert_local_skill_install_state(
        &self,
        skill_id: &str,
        installed_version: Option<&str>,
        is_enabled: bool,
        runtime: Option<&str>,
        manifest_json: &str,
        install_path: &str,
        user_settings_json: Option<&serde_json::Value>,
    ) -> Result<(), McpError> {
        let normalized_skill_id = skill_id.trim().to_string();
        if normalized_skill_id.is_empty() {
            return Err(McpError::validation("skill_id is required"));
        }
        let normalized_manifest = manifest_json.trim().to_string();
        if normalized_manifest.is_empty() {
            return Err(McpError::validation("manifest_json is required"));
        }
        let normalized_path = install_path.trim().to_string();
        if normalized_path.is_empty() {
            return Err(McpError::validation("install_path is required"));
        }

        let normalized_version = installed_version
            .map(|raw| raw.trim().to_string())
            .filter(|raw| !raw.is_empty())
            .unwrap_or_else(|| "0.0.0".to_string());
        let normalized_runtime = runtime
            .map(|raw| raw.trim().to_string())
            .filter(|raw| !raw.is_empty());
        let normalized_settings = match user_settings_json {
            Some(value) => Some(
                serde_json::to_string(value).map_err(|err| McpError::Storage(err.to_string()))?,
            ),
            None => None,
        };
        let now = now_rfc3339()?;

        sqlx::query(
            r#"
            INSERT INTO local_skill_install (
              user_id, skill_id, installed_version, is_enabled, runtime,
              manifest_json, install_path, user_settings_json, installed_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, skill_id) DO UPDATE SET
              installed_version = excluded.installed_version,
              is_enabled = excluded.is_enabled,
              runtime = excluded.runtime,
              manifest_json = excluded.manifest_json,
              install_path = excluded.install_path,
              user_settings_json = excluded.user_settings_json,
              updated_at = excluded.updated_at;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(&normalized_skill_id)
        .bind(&normalized_version)
        .bind(if is_enabled { 1 } else { 0 })
        .bind(normalized_runtime.as_deref())
        .bind(&normalized_manifest)
        .bind(&normalized_path)
        .bind(normalized_settings.as_deref())
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        self.sync_local_skill_registry_entry_from_store(&normalized_skill_id)
            .await?;

        Ok(())
    }

    pub async fn disable_missing_cloud_managed_local_skills(
        &self,
        installed_skill_ids: &[String],
    ) -> Result<i64, McpError> {
        let now = now_rfc3339()?;
        let cloud_marker = "%\"sync_source\":\"cloud_plugin_market\"%";

        let normalized_skill_ids: Vec<String> = installed_skill_ids
            .iter()
            .map(|raw| raw.trim().to_string())
            .filter(|raw| !raw.is_empty())
            .collect();

        let mut sql = String::from(
            r#"
            UPDATE local_skill_install
            SET is_enabled = 0, updated_at = ?
            WHERE user_id = ?
              AND is_enabled = 1
              AND user_settings_json LIKE ?
            "#,
        );

        if !normalized_skill_ids.is_empty() {
            sql.push_str(" AND skill_id NOT IN (");
            for index in 0..normalized_skill_ids.len() {
                if index > 0 {
                    sql.push_str(", ");
                }
                sql.push('?');
            }
            sql.push(')');
        }

        let mut query = sqlx::query(&sql)
            .bind(&now)
            .bind(LOCAL_DESKTOP_USER_ID)
            .bind(cloud_marker);

        for skill_id in normalized_skill_ids.iter().cloned() {
            query = query.bind(skill_id);
        }

        let result = query
            .execute(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        for skill_id in &normalized_skill_ids {
            let _ = self
                .update_local_capability_registry_states(skill_id, Some("disabled"), None, None)
                .await?;
        }
        Ok(result.rows_affected() as i64)
    }

    pub async fn disable_local_skills_by_ids(&self, skill_ids: &[String]) -> Result<i64, McpError> {
        let normalized_skill_ids: Vec<String> = skill_ids
            .iter()
            .map(|raw| raw.trim().to_string())
            .filter(|raw| !raw.is_empty())
            .collect();
        if normalized_skill_ids.is_empty() {
            return Ok(0);
        }

        let now = now_rfc3339()?;
        let placeholders = vec!["?"; normalized_skill_ids.len()].join(", ");
        let sql = format!(
            "UPDATE local_skill_install\n             SET is_enabled = 0, updated_at = ?\n             WHERE user_id = ?\n               AND is_enabled = 1\n               AND skill_id IN ({placeholders});"
        );
        let mut query = sqlx::query(&sql).bind(&now).bind(LOCAL_DESKTOP_USER_ID);
        for skill_id in normalized_skill_ids.iter().cloned() {
            query = query.bind(skill_id);
        }
        let result = query
            .execute(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        for skill_id in &normalized_skill_ids {
            let _ = self
                .sync_local_skill_registry_entry_from_store(skill_id)
                .await?;
        }
        Ok(result.rows_affected() as i64)
    }

    pub async fn enable_local_skills_by_ids(&self, skill_ids: &[String]) -> Result<i64, McpError> {
        let normalized_skill_ids: Vec<String> = skill_ids
            .iter()
            .map(|raw| raw.trim().to_string())
            .filter(|raw| !raw.is_empty())
            .collect();
        if normalized_skill_ids.is_empty() {
            return Ok(0);
        }

        let now = now_rfc3339()?;
        let placeholders = vec!["?"; normalized_skill_ids.len()].join(", ");
        let sql = format!(
            "UPDATE local_skill_install\n             SET is_enabled = 1, updated_at = ?\n             WHERE user_id = ?\n               AND skill_id IN ({placeholders});"
        );
        let mut query = sqlx::query(&sql).bind(&now).bind(LOCAL_DESKTOP_USER_ID);
        for skill_id in normalized_skill_ids.iter().cloned() {
            query = query.bind(skill_id);
        }
        let result = query
            .execute(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        let rows_affected = result.rows_affected() as i64;
        for skill_id in &normalized_skill_ids {
            let _ = self
                .sync_local_skill_registry_entry_from_store(skill_id)
                .await?;
        }
        Ok(rows_affected)
    }

    pub async fn delete_local_skill_install(&self, skill_id: &str) -> Result<(), McpError> {
        let mut tx = self.begin_write().await?;
        sqlx::query("DELETE FROM local_capability_registry WHERE user_id = ? AND package_id = ?;")
            .bind(LOCAL_DESKTOP_USER_ID)
            .bind(skill_id)
            .execute(tx.as_mut())
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        sqlx::query("DELETE FROM local_skill_tool_binding WHERE user_id = ? AND skill_id = ?;")
            .bind(LOCAL_DESKTOP_USER_ID)
            .bind(skill_id)
            .execute(tx.as_mut())
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        sqlx::query("DELETE FROM local_skill_install WHERE user_id = ? AND skill_id = ?;")
            .bind(LOCAL_DESKTOP_USER_ID)
            .bind(skill_id)
            .execute(tx.as_mut())
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        tx.commit()
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        invalidate_capability_registry_cache(self, "delete_local_skill_install");
        Ok(())
    }
}

fn local_skill_tool_binding_from_row(
    row: SqliteRow,
) -> Result<LocalSkillToolBindingSnapshot, McpError> {
    Ok(LocalSkillToolBindingSnapshot {
        binding_id: row.try_get::<String, _>("binding_id")?,
        binding_kind: row.try_get::<String, _>("binding_kind")?,
        skill_id: row.try_get::<String, _>("skill_id")?,
        callable_name: row.try_get::<String, _>("callable_name")?,
        tool_name: row.try_get::<String, _>("tool_name")?,
        description: row.try_get::<String, _>("description")?,
        input_schema: row
            .try_get::<Option<String>, _>("input_schema_json")?
            .and_then(|raw| serde_json::from_str::<Value>(&raw).ok()),
        output_schema: row
            .try_get::<Option<String>, _>("output_schema_json")?
            .and_then(|raw| serde_json::from_str::<Value>(&raw).ok()),
        entry_path: row.try_get::<String, _>("entry_path")?,
        runtime: row.try_get::<String, _>("runtime")?,
        timeout_seconds: row.try_get::<i64, _>("timeout_seconds")?.max(1) as u64,
        updated_at: row.try_get::<String, _>("updated_at")?,
    })
}
