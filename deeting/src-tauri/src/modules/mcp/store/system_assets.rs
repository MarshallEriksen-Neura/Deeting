use super::helpers::*;
use super::*;

impl McpStore {
    pub async fn upsert_cloud_system_asset(
        &self,
        item: &CloudSystemAssetSyncItem,
    ) -> Result<(), McpError> {
        let asset_id = item.asset_id.trim().to_string();
        let title = item.title.trim().to_string();
        if asset_id.is_empty() || title.is_empty() {
            return Err(McpError::validation("asset_id and title are required"));
        }

        let now = now_rfc3339()?;
        let metadata_json = serde_json::to_string(&item.metadata_json)
            .map_err(|err| McpError::Storage(err.to_string()))?;
        let permission_grants_json =
            serialize_json(&Some(item.policy_snapshot.permission_grants.clone()))?
                .unwrap_or_else(|| "[]".to_string());
        let allowed_role_names_json =
            serialize_json(&Some(item.policy_snapshot.allowed_role_names.clone()))?
                .unwrap_or_else(|| "[]".to_string());

        sqlx::query(
            r#"
            INSERT INTO system_asset (
              asset_id, title, description, asset_kind, owner_scope, source_kind, version,
              artifact_ref, checksum, metadata_json, visibility_scope, local_sync_policy,
              execution_policy, permission_grants_json, allowed_role_names_json,
              materialization_state, sync_source, status, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'cloud_system_assets', 'active', ?, ?)
            ON CONFLICT(asset_id) DO UPDATE SET
              title = excluded.title,
              description = excluded.description,
              asset_kind = excluded.asset_kind,
              owner_scope = excluded.owner_scope,
              source_kind = excluded.source_kind,
              version = excluded.version,
              artifact_ref = excluded.artifact_ref,
              checksum = excluded.checksum,
              metadata_json = excluded.metadata_json,
              visibility_scope = excluded.visibility_scope,
              local_sync_policy = excluded.local_sync_policy,
              execution_policy = excluded.execution_policy,
              permission_grants_json = excluded.permission_grants_json,
              allowed_role_names_json = excluded.allowed_role_names_json,
              materialization_state = excluded.materialization_state,
              sync_source = excluded.sync_source,
              status = 'active',
              updated_at = excluded.updated_at;
            "#,
        )
        .bind(&asset_id)
        .bind(&title)
        .bind(item.description.as_deref())
        .bind(item.asset_kind.trim())
        .bind(item.owner_scope.trim())
        .bind(item.source_kind.trim())
        .bind(item.version.trim())
        .bind(item.artifact_ref.as_deref())
        .bind(item.checksum.as_deref())
        .bind(&metadata_json)
        .bind(item.policy_snapshot.visibility_scope.trim())
        .bind(item.policy_snapshot.local_sync_policy.trim())
        .bind(item.policy_snapshot.execution_policy.trim())
        .bind(&permission_grants_json)
        .bind(&allowed_role_names_json)
        .bind(item.policy_snapshot.materialization_state.trim())
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(())
    }

    pub async fn archive_missing_cloud_system_assets(
        &self,
        asset_ids: &[String],
    ) -> Result<i64, McpError> {
        let normalized_asset_ids: Vec<String> = asset_ids
            .iter()
            .map(|raw| raw.trim().to_string())
            .filter(|raw| !raw.is_empty())
            .collect();
        let now = now_rfc3339()?;

        if normalized_asset_ids.is_empty() {
            let result = sqlx::query(
                r#"
                UPDATE system_asset
                SET status = 'archived', materialization_state = 'hidden', updated_at = ?
                WHERE sync_source = 'cloud_system_assets' AND status <> 'archived';
                "#,
            )
            .bind(&now)
            .execute(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            return Ok(result.rows_affected() as i64);
        }

        let placeholders = vec!["?"; normalized_asset_ids.len()].join(", ");
        let sql = format!(
            "UPDATE system_asset\n             SET status = 'archived', materialization_state = 'hidden', updated_at = ?\n             WHERE sync_source = 'cloud_system_assets'\n               AND status <> 'archived'\n               AND asset_id NOT IN ({placeholders});"
        );
        let mut query = sqlx::query(&sql).bind(&now);
        for asset_id in normalized_asset_ids {
            query = query.bind(asset_id);
        }
        let result = query
            .execute(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(result.rows_affected() as i64)
    }
}
