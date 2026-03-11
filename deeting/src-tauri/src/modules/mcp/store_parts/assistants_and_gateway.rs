impl McpStore {
    pub async fn list_local_assistants(&self) -> Result<Vec<LocalAssistant>, McpError> {
        let rows = sqlx::query(
            r#"
            SELECT
              a.id,
              COALESCE(av.name, 'Assistant') AS name,
              COALESCE(av.description, a.summary) AS description,
              a.icon_id AS avatar,
              COALESCE(av.system_prompt, '') AS system_prompt,
              av.model_config AS model_config,
              av.tags AS tags,
              a.visibility AS visibility,
              'local' AS source,
              NULL AS cloud_id,
              CASE WHEN a.status = 'archived' THEN 1 ELSE 0 END AS is_deleted,
              a.created_at AS created_at,
              a.updated_at AS updated_at
            FROM assistant a
            LEFT JOIN assistant_version av
              ON av.id = (
                SELECT v.id
                FROM assistant_version v
                WHERE v.assistant_id = a.id
                ORDER BY v.created_at DESC, v.id DESC
                LIMIT 1
              )
            WHERE a.status <> 'archived'
            ORDER BY a.updated_at DESC;
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut assistants = Vec::with_capacity(rows.len());
        for row in rows {
            assistants.push(row_to_assistant(&row)?);
        }
        Ok(assistants)
    }

    pub async fn list_local_assistant_entities(
        &self,
    ) -> Result<Vec<LocalAssistantEntity>, McpError> {
        let rows = sqlx::query(
            r#"
            SELECT id, owner_user_id, visibility, status, share_slug, summary, icon_id,
                   install_count, rating_avg, rating_count, current_version_id, published_at,
                   created_at, updated_at
            FROM assistant
            ORDER BY updated_at DESC;
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut assistants = Vec::with_capacity(rows.len());
        for row in rows {
            assistants.push(row_to_assistant_entity(&row)?);
        }
        Ok(assistants)
    }

    pub async fn list_local_assistant_versions(
        &self,
        assistant_id: Option<&str>,
    ) -> Result<Vec<LocalAssistantVersion>, McpError> {
        let rows = if let Some(assistant_id) = assistant_id {
            sqlx::query(
                r#"
                SELECT id, assistant_id, version, name, description, system_prompt,
                       model_config, tags, changelog, published_at,
                       created_at, updated_at
                FROM assistant_version
                WHERE assistant_id = ?
                ORDER BY created_at DESC, id DESC;
                "#,
            )
            .bind(assistant_id)
            .fetch_all(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?
        } else {
            sqlx::query(
                r#"
                SELECT id, assistant_id, version, name, description, system_prompt,
                       model_config, tags, changelog, published_at,
                       created_at, updated_at
                FROM assistant_version
                ORDER BY updated_at DESC, id DESC;
                "#,
            )
            .fetch_all(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?
        };

        let mut versions = Vec::with_capacity(rows.len());
        for row in rows {
            versions.push(row_to_assistant_version(&row)?);
        }
        Ok(versions)
    }

    pub async fn sync_cloud_system_assistants(
        &self,
        assistants: &[CloudSystemAssistantSnapshot],
    ) -> Result<(i64, i64), McpError> {
        let now = now_rfc3339()?;
        let mut tx = self.pool.begin().await?;
        let mut snapshot_ids: HashSet<String> = HashSet::new();
        let mut upserted_count = 0_i64;
        let mut tag_jobs: Vec<(String, Option<String>)> = Vec::new();

        for item in assistants {
            let assistant_id = item.assistant_id.trim().to_string();
            let version_id = item.version.id.trim().to_string();
            if assistant_id.is_empty() || version_id.is_empty() {
                continue;
            }
            let version_name = item.version.name.trim().to_string();
            if version_name.is_empty() {
                continue;
            }

            let version_label = {
                let normalized = item.version.version.trim();
                if normalized.is_empty() {
                    "1.0.0".to_string()
                } else {
                    normalized.to_string()
                }
            };

            let summary = normalize_optional_text(item.summary.as_deref());
            let icon_id = normalize_optional_text(item.icon_id.as_deref());
            let share_slug = normalize_optional_text(item.share_slug.as_deref());
            let published_at = normalize_optional_text(item.published_at.as_deref())
                .or_else(|| normalize_optional_text(item.version.published_at.as_deref()));
            let tags = normalize_assistant_tag_names(item.version.tags.clone());
            let tags_json = serialize_json(&Some(tags))?;
            let version_description = normalize_optional_text(item.version.description.as_deref())
                .or_else(|| summary.clone());
            let system_prompt = item
                .version
                .system_prompt
                .as_deref()
                .unwrap_or("")
                .trim()
                .to_string();
            let install_count = item.install_count.max(0);
            let rating_count = item.rating_count.max(0);
            let rating_avg = if item.rating_avg.is_finite() {
                round_to_4(item.rating_avg.max(0.0))
            } else {
                0.0
            };

            snapshot_ids.insert(assistant_id.clone());

            sqlx::query(
                r#"
                INSERT INTO assistant (
                  id, owner_user_id, visibility, status, share_slug, summary, icon_id,
                  install_count, rating_avg, rating_count, current_version_id, published_at,
                  created_at, updated_at
                )
                VALUES (?, NULL, 'public', 'published', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  owner_user_id = NULL,
                  visibility = 'public',
                  status = 'published',
                  share_slug = excluded.share_slug,
                  summary = excluded.summary,
                  icon_id = excluded.icon_id,
                  install_count = excluded.install_count,
                  rating_avg = excluded.rating_avg,
                  rating_count = excluded.rating_count,
                  current_version_id = excluded.current_version_id,
                  published_at = excluded.published_at,
                  updated_at = excluded.updated_at;
                "#,
            )
            .bind(&assistant_id)
            .bind(share_slug.as_deref())
            .bind(summary.as_deref())
            .bind(icon_id.as_deref())
            .bind(install_count)
            .bind(rating_avg)
            .bind(rating_count)
            .bind(&version_id)
            .bind(published_at.as_deref())
            .bind(&now)
            .bind(&now)
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            sqlx::query(
                r#"
                INSERT INTO assistant_version (
                  id, assistant_id, version, name, description, system_prompt,
                  model_config, tags, changelog, published_at, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  assistant_id = excluded.assistant_id,
                  version = excluded.version,
                  name = excluded.name,
                  description = excluded.description,
                  system_prompt = excluded.system_prompt,
                  tags = excluded.tags,
                  published_at = excluded.published_at,
                  updated_at = excluded.updated_at;
                "#,
            )
            .bind(&version_id)
            .bind(&assistant_id)
            .bind(version_label)
            .bind(version_name)
            .bind(version_description.as_deref())
            .bind(system_prompt)
            .bind(tags_json.as_deref())
            .bind(published_at.as_deref())
            .bind(&now)
            .bind(&now)
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            tag_jobs.push((assistant_id, tags_json));
            upserted_count += 1;
        }

        let archived_count = if snapshot_ids.is_empty() {
            sqlx::query(
                r#"
                UPDATE assistant
                SET status = 'archived',
                    published_at = NULL,
                    updated_at = ?
                WHERE owner_user_id IS NULL
                  AND visibility = 'public'
                  AND status = 'published';
                "#,
            )
            .bind(&now)
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?
            .rows_affected() as i64
        } else {
            let mut ids: Vec<String> = snapshot_ids.into_iter().collect();
            ids.sort();
            let placeholders = vec!["?"; ids.len()].join(", ");
            let sql = format!(
                "UPDATE assistant
                 SET status = 'archived',
                     published_at = NULL,
                     updated_at = ?
                 WHERE owner_user_id IS NULL
                   AND visibility = 'public'
                   AND status = 'published'
                   AND id NOT IN ({placeholders});"
            );
            let mut query = sqlx::query(&sql).bind(&now);
            for id in &ids {
                query = query.bind(id);
            }
            query
                .execute(&mut *tx)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?
                .rows_affected() as i64
        };

        tx.commit().await?;

        for (assistant_id, tags_json) in tag_jobs {
            self.sync_local_assistant_tags(&assistant_id, tags_json.as_deref(), &now)
                .await?;
        }

        Ok((upserted_count, archived_count))
    }

    pub async fn list_local_assistant_tags(&self) -> Result<Vec<LocalAssistantTag>, McpError> {
        let rows = sqlx::query(
            r#"
            SELECT id, name, created_at, updated_at
            FROM assistant_tag
            ORDER BY name ASC;
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut tags = Vec::with_capacity(rows.len());
        for row in rows {
            tags.push(LocalAssistantTag {
                id: row.try_get("id")?,
                name: row.try_get("name")?,
                created_at: row.try_get("created_at")?,
                updated_at: row.try_get("updated_at")?,
            });
        }
        Ok(tags)
    }

    pub async fn list_enabled_local_assistant_ids(&self) -> Result<HashSet<String>, McpError> {
        let rows = sqlx::query(
            r#"
            SELECT assistant_id
            FROM assistant_install
            WHERE user_id = ? AND is_enabled = 1;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut ids = HashSet::with_capacity(rows.len());
        for row in rows {
            let assistant_id = row.try_get::<String, _>("assistant_id")?;
            let normalized = assistant_id.trim().to_string();
            if !normalized.is_empty() {
                ids.insert(normalized);
            }
        }
        Ok(ids)
    }

    pub async fn is_local_assistant_enabled_install(
        &self,
        assistant_id: &str,
    ) -> Result<bool, McpError> {
        let normalized_assistant_id = assistant_id.trim().to_string();
        if normalized_assistant_id.is_empty() {
            return Ok(false);
        }

        let row = sqlx::query(
            r#"
            SELECT 1 AS ok
            FROM assistant_install
            WHERE user_id = ? AND assistant_id = ? AND is_enabled = 1
            LIMIT 1;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(&normalized_assistant_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(row.is_some())
    }

    pub async fn list_local_assistant_installs(
        &self,
        query: LocalAssistantInstallQuery,
    ) -> Result<LocalAssistantInstallPage, McpError> {
        let size = query.size.unwrap_or(50).clamp(1, 200);
        let offset = query
            .cursor
            .as_deref()
            .unwrap_or("0")
            .trim()
            .parse::<i64>()
            .unwrap_or(0)
            .max(0);

        let total_row = sqlx::query(
            r#"
            SELECT COUNT(1) AS total
            FROM assistant_install
            WHERE user_id = ?;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .fetch_one(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let total: i64 = total_row.try_get("total")?;

        let rows = sqlx::query(
            r#"
            SELECT
              ai.id AS install_id,
              ai.assistant_id AS install_assistant_id,
              ai.alias AS install_alias,
              ai.icon_override AS install_icon_override,
              ai.pinned_version_id AS install_pinned_version_id,
              ai.follow_latest AS install_follow_latest,
              ai.is_enabled AS install_is_enabled,
              ai.sort_order AS install_sort_order,
              a.owner_user_id AS assistant_owner_user_id,
              a.icon_id AS assistant_icon_id,
              a.share_slug AS assistant_share_slug,
              a.summary AS assistant_summary,
              a.published_at AS assistant_published_at,
              a.current_version_id AS assistant_current_version_id,
              a.install_count AS assistant_install_count,
              a.rating_avg AS assistant_rating_avg,
              a.rating_count AS assistant_rating_count,
              cv.id AS current_version_id,
              cv.version AS current_version,
              cv.name AS current_name,
              cv.description AS current_description,
              cv.system_prompt AS current_system_prompt,
              cv.tags AS current_tags,
              cv.published_at AS current_published_at,
              pv.id AS pinned_id,
              pv.version AS pinned_version,
              pv.name AS pinned_name,
              pv.description AS pinned_description,
              pv.system_prompt AS pinned_system_prompt,
              pv.tags AS pinned_tags,
              pv.published_at AS pinned_published_at
            FROM assistant_install ai
            INNER JOIN assistant a ON a.id = ai.assistant_id
            LEFT JOIN assistant_version cv ON cv.id = a.current_version_id
            LEFT JOIN assistant_version pv ON pv.id = ai.pinned_version_id
            WHERE ai.user_id = ?
            ORDER BY ai.sort_order ASC, ai.created_at DESC
            LIMIT ? OFFSET ?;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(size)
        .bind(offset)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            items.push(row_to_assistant_install_item(&row)?);
        }

        let next_offset = offset + size;
        let next_page = if next_offset < total {
            Some(next_offset.to_string())
        } else {
            None
        };
        let previous_page = if offset > 0 {
            Some((offset - size).max(0).to_string())
        } else {
            None
        };

        Ok(LocalAssistantInstallPage {
            items,
            next_page,
            previous_page,
        })
    }

    pub async fn install_local_assistant(
        &self,
        assistant_id: &str,
        payload: LocalAssistantInstallCreateRequest,
    ) -> Result<LocalAssistantInstallItem, McpError> {
        let normalized_assistant_id = assistant_id.trim().to_string();
        if normalized_assistant_id.is_empty() {
            return Err(McpError::validation("assistant_id is required"));
        }

        let assistant_row = sqlx::query(
            r#"
            SELECT id, current_version_id
            FROM assistant
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_assistant_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let assistant_row =
            assistant_row.ok_or_else(|| McpError::NotFound("assistant not found".to_string()))?;
        let assistant_current_version_id: Option<String> =
            assistant_row.try_get("current_version_id")?;

        let existing_row = sqlx::query(
            r#"
            SELECT id
            FROM assistant_install
            WHERE user_id = ? AND assistant_id = ?
            LIMIT 1;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(&normalized_assistant_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        if existing_row.is_some() {
            let now = now_rfc3339()?;
            self.refresh_assistant_install_count(&normalized_assistant_id, &now)
                .await?;
            return self
                .get_local_assistant_install_item(&normalized_assistant_id)
                .await?
                .ok_or_else(|| McpError::NotFound("assistant install not found".to_string()));
        }

        let mut pinned_version_id = payload.pinned_version_id.and_then(|raw| {
            let trimmed = raw.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let mut follow_latest = payload.follow_latest.unwrap_or(true);

        if let Some(pinned_id) = pinned_version_id.as_deref() {
            let version_row = sqlx::query(
                r#"
                SELECT id
                FROM assistant_version
                WHERE id = ? AND assistant_id = ?
                LIMIT 1;
                "#,
            )
            .bind(pinned_id)
            .bind(&normalized_assistant_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            if version_row.is_none() {
                return Err(McpError::validation("pinned_version_id is invalid"));
            }
            follow_latest = false;
        }

        if !follow_latest && pinned_version_id.is_none() {
            pinned_version_id = assistant_current_version_id;
        }

        let max_row = sqlx::query(
            r#"
            SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort
            FROM assistant_install
            WHERE user_id = ?;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .fetch_one(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let install_id = Uuid::new_v4().to_string();
        let sort_order = max_row.try_get::<i64, _>("next_sort").unwrap_or(0);
        let now = now_rfc3339()?;

        sqlx::query(
            r#"
            INSERT INTO assistant_install (
              id, user_id, assistant_id, alias, icon_override, pinned_version_id,
              follow_latest, is_enabled, sort_order, created_at, updated_at
            )
            VALUES (?, ?, ?, NULL, NULL, ?, ?, 1, ?, ?, ?);
            "#,
        )
        .bind(&install_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(&normalized_assistant_id)
        .bind(pinned_version_id.as_deref())
        .bind(if follow_latest { 1 } else { 0 })
        .bind(sort_order)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        self.refresh_assistant_install_count(&normalized_assistant_id, &now)
            .await?;

        self.get_local_assistant_install_item(&normalized_assistant_id)
            .await?
            .ok_or_else(|| McpError::NotFound("assistant install not found".to_string()))
    }

    pub async fn update_local_assistant_install(
        &self,
        assistant_id: &str,
        payload: LocalAssistantInstallUpdateRequest,
    ) -> Result<LocalAssistantInstallItem, McpError> {
        let normalized_assistant_id = assistant_id.trim().to_string();
        if normalized_assistant_id.is_empty() {
            return Err(McpError::validation("assistant_id is required"));
        }

        let assistant_row = sqlx::query(
            r#"
            SELECT current_version_id
            FROM assistant
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_assistant_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let assistant_current_version_id: Option<String> = assistant_row
            .ok_or_else(|| McpError::NotFound("assistant not found".to_string()))?
            .try_get("current_version_id")?;

        let existing_row = sqlx::query(
            r#"
            SELECT id, alias, icon_override, pinned_version_id, follow_latest, is_enabled, sort_order
            FROM assistant_install
            WHERE user_id = ? AND assistant_id = ?
            LIMIT 1;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(&normalized_assistant_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?
        .ok_or_else(|| McpError::NotFound("assistant install not found".to_string()))?;

        let install_id: String = existing_row.try_get("id")?;
        let alias_existing: Option<String> = existing_row.try_get("alias")?;
        let icon_override_existing: Option<String> = existing_row.try_get("icon_override")?;
        let pinned_existing: Option<String> = existing_row.try_get("pinned_version_id")?;
        let follow_latest_existing =
            existing_row.try_get::<i64, _>("follow_latest").unwrap_or(1) != 0;
        let is_enabled_existing = existing_row.try_get::<i64, _>("is_enabled").unwrap_or(1) != 0;
        let sort_order_existing = existing_row.try_get::<i64, _>("sort_order").unwrap_or(0);

        let alias = payload
            .alias
            .map(|value| {
                let trimmed = value.trim().to_string();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed)
                }
            })
            .unwrap_or(alias_existing);
        let icon_override = payload
            .icon_override
            .map(|value| {
                let trimmed = value.trim().to_string();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed)
                }
            })
            .unwrap_or(icon_override_existing);

        let payload_follow_latest = payload.follow_latest;
        let payload_has_pinned_version = payload.pinned_version_id.is_some();
        let mut pinned_version_id = payload
            .pinned_version_id
            .map(|raw| {
                let trimmed = raw.trim().to_string();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed)
                }
            })
            .unwrap_or(pinned_existing);

        let mut follow_latest = payload_follow_latest.unwrap_or(follow_latest_existing);
        if let Some(pinned_id) = pinned_version_id.as_deref() {
            let version_row = sqlx::query(
                r#"
                SELECT id
                FROM assistant_version
                WHERE id = ? AND assistant_id = ?
                LIMIT 1;
                "#,
            )
            .bind(pinned_id)
            .bind(&normalized_assistant_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            if version_row.is_none() {
                return Err(McpError::validation("pinned_version_id is invalid"));
            }
            if payload_follow_latest.is_none() {
                follow_latest = false;
            }
        }

        if payload_follow_latest == Some(true) {
            pinned_version_id = None;
        } else if payload_follow_latest == Some(false) && !payload_has_pinned_version {
            pinned_version_id = assistant_current_version_id.clone();
        } else if !follow_latest && pinned_version_id.is_none() {
            pinned_version_id = assistant_current_version_id;
        }

        let is_enabled = payload.is_enabled.unwrap_or(is_enabled_existing);
        let sort_order = payload.sort_order.unwrap_or(sort_order_existing).max(0);
        let now = now_rfc3339()?;

        sqlx::query(
            r#"
            UPDATE assistant_install
            SET alias = ?, icon_override = ?, pinned_version_id = ?, follow_latest = ?, is_enabled = ?, sort_order = ?, updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(alias.as_deref())
        .bind(icon_override.as_deref())
        .bind(pinned_version_id.as_deref())
        .bind(if follow_latest { 1 } else { 0 })
        .bind(if is_enabled { 1 } else { 0 })
        .bind(sort_order)
        .bind(&now)
        .bind(&install_id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        self.get_local_assistant_install_item(&normalized_assistant_id)
            .await?
            .ok_or_else(|| McpError::NotFound("assistant install not found".to_string()))
    }

    pub async fn uninstall_local_assistant(&self, assistant_id: &str) -> Result<(), McpError> {
        let normalized_assistant_id = assistant_id.trim().to_string();
        if normalized_assistant_id.is_empty() {
            return Err(McpError::validation("assistant_id is required"));
        }

        let now = now_rfc3339()?;
        let result = sqlx::query(
            r#"
            DELETE FROM assistant_install
            WHERE user_id = ? AND assistant_id = ?;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(&normalized_assistant_id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if result.rows_affected() == 0 {
            return Err(McpError::NotFound(
                "assistant install not found".to_string(),
            ));
        }

        self.refresh_assistant_install_count(&normalized_assistant_id, &now)
            .await?;

        Ok(())
    }

    pub async fn rate_local_assistant(
        &self,
        assistant_id: &str,
        payload: LocalAssistantRatingRequest,
    ) -> Result<LocalAssistantRatingResponse, McpError> {
        let normalized_assistant_id = assistant_id.trim().to_string();
        if normalized_assistant_id.is_empty() {
            return Err(McpError::validation("assistant_id is required"));
        }

        if payload.rating < 1.0 || payload.rating > 5.0 {
            return Err(McpError::validation("rating must be between 1 and 5"));
        }

        let assistant_row = sqlx::query(
            r#"
            SELECT id, rating_avg, rating_count
            FROM assistant
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_assistant_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?
        .ok_or_else(|| McpError::NotFound("assistant not found".to_string()))?;

        let install_row = sqlx::query(
            r#"
            SELECT id
            FROM assistant_install
            WHERE user_id = ? AND assistant_id = ?
            LIMIT 1;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(&normalized_assistant_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        if install_row.is_none() {
            return Err(McpError::validation("assistant is not installed"));
        }

        let existing_row = sqlx::query(
            r#"
            SELECT id, rating
            FROM assistant_rating
            WHERE user_id = ? AND assistant_id = ?
            LIMIT 1;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(&normalized_assistant_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut rating_avg = assistant_row.try_get::<f64, _>("rating_avg").unwrap_or(0.0);
        let mut rating_count = assistant_row.try_get::<i64, _>("rating_count").unwrap_or(0);
        let now = now_rfc3339()?;

        if let Some(row) = existing_row {
            let rating_id: String = row.try_get("id")?;
            let old_rating = row.try_get::<f64, _>("rating").unwrap_or(0.0);
            if old_rating == payload.rating {
                return Ok(LocalAssistantRatingResponse {
                    assistant_id: normalized_assistant_id,
                    rating_avg,
                    rating_count,
                });
            }

            sqlx::query(
                r#"
                UPDATE assistant_rating
                SET rating = ?, updated_at = ?
                WHERE id = ?;
                "#,
            )
            .bind(payload.rating)
            .bind(&now)
            .bind(&rating_id)
            .execute(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            if rating_count <= 0 {
                let refreshed = self
                    .refresh_assistant_rating(&normalized_assistant_id, &now)
                    .await?;
                rating_avg = refreshed.0;
                rating_count = refreshed.1;
            } else {
                let new_avg = (rating_avg * rating_count as f64 - old_rating + payload.rating)
                    / rating_count as f64;
                rating_avg = round_to_4(new_avg);
                sqlx::query(
                    r#"
                    UPDATE assistant
                    SET rating_avg = ?, updated_at = ?
                    WHERE id = ?;
                    "#,
                )
                .bind(rating_avg)
                .bind(&now)
                .bind(&normalized_assistant_id)
                .execute(&self.pool)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;
            }
        } else {
            let rating_id = Uuid::new_v4().to_string();
            sqlx::query(
                r#"
                INSERT INTO assistant_rating (
                  id, user_id, assistant_id, rating, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?);
                "#,
            )
            .bind(&rating_id)
            .bind(LOCAL_DESKTOP_USER_ID)
            .bind(&normalized_assistant_id)
            .bind(payload.rating)
            .bind(&now)
            .bind(&now)
            .execute(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            let new_count = rating_count + 1;
            let new_avg = (rating_avg * rating_count as f64 + payload.rating) / new_count as f64;
            rating_count = new_count;
            rating_avg = round_to_4(new_avg);
            sqlx::query(
                r#"
                UPDATE assistant
                SET rating_count = ?, rating_avg = ?, updated_at = ?
                WHERE id = ?;
                "#,
            )
            .bind(rating_count)
            .bind(rating_avg)
            .bind(&now)
            .bind(&normalized_assistant_id)
            .execute(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        }

        Ok(LocalAssistantRatingResponse {
            assistant_id: normalized_assistant_id,
            rating_avg,
            rating_count,
        })
    }

    pub async fn record_local_assistant_routing_trial(
        &self,
        assistant_id: &str,
    ) -> Result<LocalAssistantRoutingState, McpError> {
        let normalized_assistant_id = assistant_id.trim().to_string();
        if normalized_assistant_id.is_empty() {
            return Err(McpError::validation("assistant_id is required"));
        }

        let assistant_exists = sqlx::query(
            r#"
            SELECT id
            FROM assistant
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_assistant_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        if assistant_exists.is_none() {
            return Err(McpError::NotFound("assistant not found".to_string()));
        }

        let now = now_rfc3339()?;
        let state_id = Uuid::new_v4().to_string();
        sqlx::query(
            r#"
            INSERT INTO assistant_routing_state (
              id, assistant_id, total_trials, positive_feedback, negative_feedback,
              last_used_at, last_feedback_at, created_at, updated_at
            )
            VALUES (?, ?, 1, 0, 0, ?, NULL, ?, ?)
            ON CONFLICT(assistant_id) DO UPDATE
            SET total_trials = assistant_routing_state.total_trials + 1,
                last_used_at = excluded.last_used_at,
                updated_at = excluded.updated_at;
            "#,
        )
        .bind(&state_id)
        .bind(&normalized_assistant_id)
        .bind(&now)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        self.get_local_assistant_routing_state(&normalized_assistant_id)
            .await?
            .ok_or_else(|| McpError::Storage("assistant routing state not found".to_string()))
    }

    pub async fn record_local_assistant_routing_feedback(
        &self,
        assistant_id: &str,
        payload: LocalAssistantRoutingFeedbackRequest,
    ) -> Result<LocalAssistantRoutingState, McpError> {
        let normalized_assistant_id = assistant_id.trim().to_string();
        if normalized_assistant_id.is_empty() {
            return Err(McpError::validation("assistant_id is required"));
        }

        let is_positive = parse_assistant_routing_feedback_event(&payload.event)
            .ok_or_else(|| McpError::validation("unknown feedback event"))?;

        let assistant_exists = sqlx::query(
            r#"
            SELECT id
            FROM assistant
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_assistant_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        if assistant_exists.is_none() {
            return Err(McpError::NotFound("assistant not found".to_string()));
        }

        let positive_inc = if is_positive { 1_i64 } else { 0_i64 };
        let negative_inc = if is_positive { 0_i64 } else { 1_i64 };
        let now = now_rfc3339()?;
        let state_id = Uuid::new_v4().to_string();

        sqlx::query(
            r#"
            INSERT INTO assistant_routing_state (
              id, assistant_id, total_trials, positive_feedback, negative_feedback,
              last_used_at, last_feedback_at, created_at, updated_at
            )
            VALUES (?, ?, 0, ?, ?, NULL, ?, ?, ?)
            ON CONFLICT(assistant_id) DO UPDATE
            SET positive_feedback = assistant_routing_state.positive_feedback + ?,
                negative_feedback = assistant_routing_state.negative_feedback + ?,
                last_feedback_at = excluded.last_feedback_at,
                updated_at = excluded.updated_at;
            "#,
        )
        .bind(&state_id)
        .bind(&normalized_assistant_id)
        .bind(positive_inc)
        .bind(negative_inc)
        .bind(&now)
        .bind(&now)
        .bind(&now)
        .bind(positive_inc)
        .bind(negative_inc)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        self.get_local_assistant_routing_state(&normalized_assistant_id)
            .await?
            .ok_or_else(|| McpError::Storage("assistant routing state not found".to_string()))
    }

    pub async fn get_local_assistant_routing_report(
        &self,
        query: LocalAssistantRoutingReportQuery,
    ) -> Result<LocalAssistantRoutingReportResponse, McpError> {
        let limit = query.limit.unwrap_or(50).clamp(1, 500) as usize;
        let sort_key = query
            .sort
            .as_deref()
            .unwrap_or("score_desc")
            .trim()
            .to_ascii_lowercase();
        let allowed_sorts = [
            "score_desc",
            "routing_score_desc",
            "rating_desc",
            "trials_desc",
            "recent_desc",
        ];
        if !allowed_sorts.contains(&sort_key.as_str()) {
            return Err(McpError::validation("invalid sort option"));
        }

        let rows = sqlx::query(
            r#"
            SELECT
              ars.assistant_id AS assistant_id,
              ars.total_trials AS total_trials,
              ars.positive_feedback AS positive_feedback,
              ars.negative_feedback AS negative_feedback,
              ars.last_used_at AS last_used_at,
              ars.last_feedback_at AS last_feedback_at,
              a.summary AS assistant_summary,
              av.name AS version_name
            FROM assistant_routing_state ars
            JOIN assistant a ON a.id = ars.assistant_id
            LEFT JOIN assistant_version av ON a.current_version_id = av.id;
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            let total_trials = row.try_get::<i64, _>("total_trials").unwrap_or(0);
            let positive_feedback = row.try_get::<i64, _>("positive_feedback").unwrap_or(0);
            let negative_feedback = row.try_get::<i64, _>("negative_feedback").unwrap_or(0);
            let rating_score = (positive_feedback as f64 + 1.0)
                / (positive_feedback as f64 + negative_feedback as f64 + 2.0);
            let mab_score = rating_score;
            let exploration_bonus = if total_trials < 10 { 0.2 } else { 0.0 };
            let routing_score = (rating_score * 0.75) + (exploration_bonus * 0.25);
            items.push(LocalAssistantRoutingReportItem {
                assistant_id: row.try_get::<String, _>("assistant_id")?,
                name: row
                    .try_get::<Option<String>, _>("version_name")
                    .ok()
                    .flatten(),
                summary: row
                    .try_get::<Option<String>, _>("assistant_summary")
                    .ok()
                    .flatten(),
                total_trials,
                positive_feedback,
                negative_feedback,
                rating_score,
                mab_score,
                routing_score,
                exploration_bonus,
                last_used_at: row
                    .try_get::<Option<String>, _>("last_used_at")
                    .ok()
                    .flatten(),
                last_feedback_at: row
                    .try_get::<Option<String>, _>("last_feedback_at")
                    .ok()
                    .flatten(),
            });
        }

        if let Some(min_trials) = query.min_trials {
            items.retain(|item| item.total_trials >= min_trials.max(0));
        }
        if let Some(min_rating) = query.min_rating {
            items.retain(|item| item.rating_score >= min_rating.max(0.0));
        }

        match sort_key.as_str() {
            "rating_desc" => {
                items.sort_by(|a, b| b.rating_score.total_cmp(&a.rating_score));
            }
            "trials_desc" => {
                items.sort_by(|a, b| b.total_trials.cmp(&a.total_trials));
            }
            "recent_desc" => {
                items.sort_by(|a, b| b.last_used_at.cmp(&a.last_used_at));
            }
            _ => {
                items.sort_by(|a, b| b.routing_score.total_cmp(&a.routing_score));
            }
        }

        if items.len() > limit {
            items.truncate(limit);
        }

        let total_assistants = items.len() as i64;
        let total_trials: i64 = items.iter().map(|item| item.total_trials).sum();
        let total_positive: i64 = items.iter().map(|item| item.positive_feedback).sum();
        let total_negative: i64 = items.iter().map(|item| item.negative_feedback).sum();
        let overall_rating = if total_assistants > 0 {
            items.iter().map(|item| item.rating_score).sum::<f64>() / total_assistants as f64
        } else {
            0.0
        };

        Ok(LocalAssistantRoutingReportResponse {
            summary: LocalAssistantRoutingReportSummary {
                total_assistants,
                total_trials,
                total_positive,
                total_negative,
                overall_rating,
            },
            items,
        })
    }

    pub async fn get_local_assistant_routing_state(
        &self,
        assistant_id: &str,
    ) -> Result<Option<LocalAssistantRoutingState>, McpError> {
        let normalized_assistant_id = assistant_id.trim().to_string();
        if normalized_assistant_id.is_empty() {
            return Err(McpError::validation("assistant_id is required"));
        }

        let row = sqlx::query(
            r#"
            SELECT assistant_id, total_trials, positive_feedback, negative_feedback, last_used_at, last_feedback_at
            FROM assistant_routing_state
            WHERE assistant_id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_assistant_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        row.map(|row| {
            Ok(LocalAssistantRoutingState {
                assistant_id: row.try_get("assistant_id")?,
                total_trials: row.try_get::<i64, _>("total_trials").unwrap_or(0),
                positive_feedback: row.try_get::<i64, _>("positive_feedback").unwrap_or(0),
                negative_feedback: row.try_get::<i64, _>("negative_feedback").unwrap_or(0),
                last_used_at: row
                    .try_get::<Option<String>, _>("last_used_at")
                    .ok()
                    .flatten(),
                last_feedback_at: row
                    .try_get::<Option<String>, _>("last_feedback_at")
                    .ok()
                    .flatten(),
            })
        })
        .transpose()
    }

    pub async fn create_local_trace_feedback(
        &self,
        payload: LocalTraceFeedbackRequest,
    ) -> Result<LocalTraceFeedback, McpError> {
        let trace_id = payload.trace_id.trim().to_string();
        if trace_id.is_empty() {
            return Err(McpError::validation("trace_id is required"));
        }
        if trace_id.len() > 64 {
            return Err(McpError::validation("trace_id must be <= 64 characters"));
        }
        if !payload.score.is_finite() || payload.score < -1.0 || payload.score > 1.0 {
            return Err(McpError::validation("score must be between -1.0 and 1.0"));
        }

        let comment = payload.comment.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let tags = payload.tags.map(normalize_feedback_tags);
        let tags_json = serialize_json(&tags)?;
        let now = now_rfc3339()?;
        let id = Uuid::new_v4().to_string();

        sqlx::query(
            r#"
            INSERT INTO trace_feedback (
              id, trace_id, user_id, score, comment, tags, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?);
            "#,
        )
        .bind(&id)
        .bind(&trace_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(payload.score)
        .bind(comment.as_deref())
        .bind(tags_json.as_deref())
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(LocalTraceFeedback {
            id,
            trace_id,
            user_id: Some(LOCAL_DESKTOP_USER_ID.to_string()),
            score: payload.score,
            comment,
            tags,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub async fn create_local_gateway_log(
        &self,
        trace_id: Option<&str>,
        model: &str,
        status_code: i64,
        duration_ms: i64,
        ttft_ms: Option<i64>,
        upstream_url: Option<&str>,
        retry_count: i64,
        input_tokens: i64,
        output_tokens: i64,
        total_tokens: i64,
        cost_upstream: f64,
        cost_user: f64,
        is_cached: bool,
        error_code: Option<&str>,
        meta: Option<&serde_json::Value>,
    ) -> Result<(), McpError> {
        let normalized_model = model.trim().to_string();
        if normalized_model.is_empty() {
            return Err(McpError::validation("model is required"));
        }
        let normalized_trace_id = trace_id.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        if let Some(value) = normalized_trace_id.as_deref() {
            if value.len() > 64 {
                return Err(McpError::validation("trace_id must be <= 64 characters"));
            }
        }
        let normalized_error_code = error_code.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let normalized_upstream_url = upstream_url.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let meta_json = meta
            .map(serde_json::to_string)
            .transpose()
            .map_err(|err| McpError::Storage(err.to_string()))?;
        let now = now_rfc3339()?;
        let id = Uuid::new_v4().to_string();

        sqlx::query(
            r#"
            INSERT INTO gateway_log (
              id, user_id, trace_id, api_key_id, preset_id, model, status_code, duration_ms, ttft_ms,
              upstream_url, retry_count, input_tokens, output_tokens, total_tokens,
              cost_upstream, cost_user, is_cached, error_code, meta, created_at
            )
            VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            "#,
        )
        .bind(&id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(normalized_trace_id.as_deref())
        .bind(&normalized_model)
        .bind(status_code.max(0))
        .bind(duration_ms.max(0))
        .bind(ttft_ms.filter(|value| *value > 0))
        .bind(normalized_upstream_url.as_deref())
        .bind(retry_count.max(0))
        .bind(input_tokens.max(0))
        .bind(output_tokens.max(0))
        .bind(total_tokens.max(0))
        .bind(if cost_upstream.is_finite() {
            cost_upstream.max(0.0)
        } else {
            0.0
        })
        .bind(if cost_user.is_finite() {
            cost_user.max(0.0)
        } else {
            0.0
        })
        .bind(if is_cached { 1 } else { 0 })
        .bind(normalized_error_code.as_deref())
        .bind(meta_json.as_deref())
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(())
    }

    pub async fn list_local_gateway_logs(
        &self,
        query: LocalGatewayLogQuery,
    ) -> Result<LocalGatewayLogListResponse, McpError> {
        let skip = query.skip.unwrap_or(0).max(0);
        let limit = query.limit.unwrap_or(100).clamp(1, 1000);
        let model = query.model.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let status_code = query.status_code.map(|value| value.max(0));
        let is_cached = query
            .is_cached
            .map(|value| if value { 1_i64 } else { 0_i64 });

        let total_row = sqlx::query(
            r#"
            SELECT COUNT(*) AS total
            FROM gateway_log
            WHERE (? IS NULL OR model = ?)
              AND (? IS NULL OR status_code = ?)
              AND (? IS NULL OR is_cached = ?);
            "#,
        )
        .bind(model.as_deref())
        .bind(model.as_deref())
        .bind(status_code)
        .bind(status_code)
        .bind(is_cached)
        .bind(is_cached)
        .fetch_one(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let total: i64 = total_row.try_get("total")?;

        let rows = sqlx::query(
            r#"
            SELECT
              id, trace_id, user_id, api_key_id, model, status_code, duration_ms, ttft_ms,
              input_tokens, output_tokens, cost_user, is_cached, error_code, created_at
            FROM gateway_log
            WHERE (? IS NULL OR model = ?)
              AND (? IS NULL OR status_code = ?)
              AND (? IS NULL OR is_cached = ?)
            ORDER BY created_at DESC, id DESC
            LIMIT ? OFFSET ?;
            "#,
        )
        .bind(model.as_deref())
        .bind(model.as_deref())
        .bind(status_code)
        .bind(status_code)
        .bind(is_cached)
        .bind(is_cached)
        .bind(limit)
        .bind(skip)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            items.push(LocalGatewayLogItem {
                id: row.try_get("id")?,
                trace_id: row.try_get("trace_id")?,
                user_id: row.try_get("user_id")?,
                api_key_id: row.try_get("api_key_id")?,
                model: row.try_get("model")?,
                status_code: row.try_get("status_code")?,
                duration_ms: row.try_get::<i64, _>("duration_ms")?.max(0),
                ttft_ms: row.try_get("ttft_ms")?,
                input_tokens: row.try_get::<i64, _>("input_tokens")?.max(0),
                output_tokens: row.try_get::<i64, _>("output_tokens")?.max(0),
                cost_user: row.try_get::<f64, _>("cost_user").unwrap_or(0.0),
                is_cached: row.try_get::<i64, _>("is_cached")? != 0,
                error_code: row.try_get("error_code")?,
                created_at: row.try_get("created_at")?,
            });
        }

        Ok(LocalGatewayLogListResponse {
            total,
            skip,
            limit,
            items,
        })
    }

    pub async fn get_local_gateway_log_stats(
        &self,
        query: LocalGatewayLogQuery,
    ) -> Result<LocalGatewayLogStatsResponse, McpError> {
        let model = query.model.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let status_code = query.status_code.map(|value| value.max(0));
        let is_cached = query
            .is_cached
            .map(|value| if value { 1_i64 } else { 0_i64 });

        let total_row = sqlx::query(
            r#"
            SELECT COUNT(*) AS total
            FROM gateway_log
            WHERE (? IS NULL OR model = ?)
              AND (? IS NULL OR status_code = ?)
              AND (? IS NULL OR is_cached = ?);
            "#,
        )
        .bind(model.as_deref())
        .bind(model.as_deref())
        .bind(status_code)
        .bind(status_code)
        .bind(is_cached)
        .bind(is_cached)
        .fetch_one(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let total: i64 = total_row.try_get("total")?;

        let success_row = sqlx::query(
            r#"
            SELECT COUNT(*) AS total
            FROM gateway_log
            WHERE status_code >= 200
              AND status_code < 400
              AND (? IS NULL OR model = ?)
              AND (? IS NULL OR status_code = ?)
              AND (? IS NULL OR is_cached = ?);
            "#,
        )
        .bind(model.as_deref())
        .bind(model.as_deref())
        .bind(status_code)
        .bind(status_code)
        .bind(is_cached)
        .bind(is_cached)
        .fetch_one(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let success_count: i64 = success_row.try_get("total")?;

        let cached_row = sqlx::query(
            r#"
            SELECT COUNT(*) AS total
            FROM gateway_log
            WHERE is_cached = 1
              AND (? IS NULL OR model = ?)
              AND (? IS NULL OR status_code = ?)
              AND (? IS NULL OR is_cached = ?);
            "#,
        )
        .bind(model.as_deref())
        .bind(model.as_deref())
        .bind(status_code)
        .bind(status_code)
        .bind(is_cached)
        .bind(is_cached)
        .fetch_one(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let cached_count: i64 = cached_row.try_get("total")?;

        let error_rows = sqlx::query(
            r#"
            SELECT COALESCE(error_code, CAST(status_code AS TEXT)) AS bucket, COUNT(*) AS count
            FROM gateway_log
            WHERE (? IS NULL OR model = ?)
              AND (? IS NULL OR status_code = ?)
              AND (? IS NULL OR is_cached = ?)
            GROUP BY bucket
            ORDER BY COUNT(*) DESC
            LIMIT 20;
            "#,
        )
        .bind(model.as_deref())
        .bind(model.as_deref())
        .bind(status_code)
        .bind(status_code)
        .bind(is_cached)
        .bind(is_cached)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let mut error_distribution = Vec::with_capacity(error_rows.len());
        for row in error_rows {
            error_distribution.push(LocalGatewayLogStatsBucket {
                key: row.try_get::<String, _>("bucket")?,
                count: row.try_get::<i64, _>("count")?,
            });
        }

        let model_rows = sqlx::query(
            r#"
            SELECT model AS bucket, COUNT(*) AS count
            FROM gateway_log
            WHERE (? IS NULL OR model = ?)
              AND (? IS NULL OR status_code = ?)
              AND (? IS NULL OR is_cached = ?)
            GROUP BY model
            ORDER BY COUNT(*) DESC
            LIMIT 20;
            "#,
        )
        .bind(model.as_deref())
        .bind(model.as_deref())
        .bind(status_code)
        .bind(status_code)
        .bind(is_cached)
        .bind(is_cached)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let mut model_ranking = Vec::with_capacity(model_rows.len());
        for row in model_rows {
            model_ranking.push(LocalGatewayLogStatsBucket {
                key: row.try_get::<String, _>("bucket")?,
                count: row.try_get::<i64, _>("count")?,
            });
        }

        let latency_rows = sqlx::query(
            r#"
            SELECT
              CASE
                WHEN duration_ms < 200 THEN 'lt_200ms'
                WHEN duration_ms < 500 THEN '200_500ms'
                WHEN duration_ms < 1000 THEN '500_1000ms'
                ELSE 'gte_1000ms'
              END AS bucket,
              COUNT(*) AS count
            FROM gateway_log
            WHERE (? IS NULL OR model = ?)
              AND (? IS NULL OR status_code = ?)
              AND (? IS NULL OR is_cached = ?)
            GROUP BY bucket
            ORDER BY COUNT(*) DESC;
            "#,
        )
        .bind(model.as_deref())
        .bind(model.as_deref())
        .bind(status_code)
        .bind(status_code)
        .bind(is_cached)
        .bind(is_cached)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let mut latency_histogram = Vec::with_capacity(latency_rows.len());
        for row in latency_rows {
            latency_histogram.push(LocalGatewayLogStatsBucket {
                key: row.try_get::<String, _>("bucket")?,
                count: row.try_get::<i64, _>("count")?,
            });
        }

        let success_rate = if total > 0 {
            ((success_count as f64 / total as f64) * 100.0 * 100.0).round() / 100.0
        } else {
            0.0
        };
        let cache_hit_rate = if total > 0 {
            ((cached_count as f64 / total as f64) * 100.0 * 100.0).round() / 100.0
        } else {
            0.0
        };

        Ok(LocalGatewayLogStatsResponse {
            total,
            success_rate,
            cache_hit_rate,
            error_distribution,
            model_ranking,
            latency_histogram,
        })
    }
}
