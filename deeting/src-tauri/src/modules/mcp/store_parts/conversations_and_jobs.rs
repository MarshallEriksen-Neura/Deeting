impl McpStore {
    pub async fn list_local_conversations(
        &self,
        query: LocalConversationSessionsQuery,
    ) -> Result<LocalConversationSessionPage, McpError> {
        let size = query.size.unwrap_or(24).clamp(1, 100);
        let offset = query
            .cursor
            .as_deref()
            .unwrap_or("0")
            .trim()
            .parse::<i64>()
            .unwrap_or(0)
            .max(0);
        let status = query.status.unwrap_or(LocalConversationStatus::Active);
        let assistant_id = query.assistant_id.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });

        let total: i64 = if let Some(assistant_id) = assistant_id.as_deref() {
            let row = sqlx::query(
                r#"
                SELECT COUNT(1) AS total
                FROM conversation_session
                WHERE status = ? AND assistant_id = ?;
                "#,
            )
            .bind(status.as_str())
            .bind(assistant_id)
            .fetch_one(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            row.try_get("total")?
        } else {
            let row = sqlx::query(
                r#"
                SELECT COUNT(1) AS total
                FROM conversation_session
                WHERE status = ?;
                "#,
            )
            .bind(status.as_str())
            .fetch_one(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            row.try_get("total")?
        };

        let rows = if let Some(assistant_id) = assistant_id.as_deref() {
            sqlx::query(
                r#"
                SELECT
                  cs.id AS id,
                  cs.title AS title,
                  cs.message_count AS message_count,
                  cs.first_message_at AS first_message_at,
                  cs.last_active_at AS last_active_at,
                  sm.summary_text AS summary_text
                FROM conversation_session cs
                LEFT JOIN conversation_summary sm
                  ON sm.session_id = cs.id
                 AND sm.version = cs.last_summary_version
                WHERE cs.status = ? AND cs.assistant_id = ?
                ORDER BY cs.last_active_at DESC, cs.id DESC
                LIMIT ? OFFSET ?;
                "#,
            )
            .bind(status.as_str())
            .bind(assistant_id)
            .bind(size)
            .bind(offset)
            .fetch_all(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?
        } else {
            sqlx::query(
                r#"
                SELECT
                  cs.id AS id,
                  cs.title AS title,
                  cs.message_count AS message_count,
                  cs.first_message_at AS first_message_at,
                  cs.last_active_at AS last_active_at,
                  sm.summary_text AS summary_text
                FROM conversation_session cs
                LEFT JOIN conversation_summary sm
                  ON sm.session_id = cs.id
                 AND sm.version = cs.last_summary_version
                WHERE cs.status = ?
                ORDER BY cs.last_active_at DESC, cs.id DESC
                LIMIT ? OFFSET ?;
                "#,
            )
            .bind(status.as_str())
            .bind(size)
            .bind(offset)
            .fetch_all(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?
        };

        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            items.push(LocalConversationSessionItem {
                session_id: row.try_get("id")?,
                title: row.try_get("title")?,
                summary_text: row.try_get("summary_text")?,
                message_count: row.try_get::<i64, _>("message_count").unwrap_or(0),
                first_message_at: row.try_get("first_message_at")?,
                last_active_at: row.try_get("last_active_at")?,
            });
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

        Ok(LocalConversationSessionPage {
            items,
            next_page,
            previous_page,
        })
    }

    pub async fn create_local_conversation(
        &self,
        payload: LocalConversationCreateRequest,
    ) -> Result<LocalConversationCreateResponse, McpError> {
        let now = now_rfc3339()?;
        let session_id = Uuid::new_v4().to_string();
        let assistant_id = payload.assistant_id.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let title = payload.title.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });

        sqlx::query(
            r#"
            INSERT INTO conversation_session (
              id, tenant_id, user_id, assistant_id, channel, status, preset_id, title,
              message_count, last_summary_version, first_message_at, last_active_at, created_at, updated_at
            )
            VALUES (?, NULL, NULL, ?, 'internal', 'active', NULL, ?, 0, 0, NULL, ?, ?, ?);
            "#,
        )
        .bind(&session_id)
        .bind(&assistant_id)
        .bind(&title)
        .bind(&now)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(LocalConversationCreateResponse { session_id, title })
    }

    pub async fn set_local_conversation_assistant(
        &self,
        session_id: &str,
        assistant_id: Option<&str>,
    ) -> Result<(), McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }

        let normalized_assistant_id = assistant_id.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });

        if let Some(assistant_id_value) = normalized_assistant_id.as_deref() {
            let assistant_exists = sqlx::query(
                r#"
                SELECT id
                FROM assistant
                WHERE id = ?
                LIMIT 1;
                "#,
            )
            .bind(assistant_id_value)
            .fetch_optional(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            if assistant_exists.is_none() {
                return Err(McpError::NotFound("assistant not found".to_string()));
            }
        }

        let now = now_rfc3339()?;
        let result = sqlx::query(
            r#"
            UPDATE conversation_session
            SET assistant_id = ?, last_active_at = ?, updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(normalized_assistant_id.as_deref())
        .bind(&now)
        .bind(&now)
        .bind(&normalized_session_id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if result.rows_affected() == 0 {
            return Err(McpError::NotFound(
                "conversation session not found".to_string(),
            ));
        }

        Ok(())
    }

    pub async fn update_local_conversation_status(
        &self,
        session_id: &str,
        status: LocalConversationStatus,
    ) -> Result<LocalConversationArchiveResponse, McpError> {
        let now = now_rfc3339()?;
        let result = sqlx::query(
            r#"
            UPDATE conversation_session
            SET status = ?, last_active_at = ?, updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(status.as_str())
        .bind(&now)
        .bind(&now)
        .bind(session_id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if result.rows_affected() == 0 {
            return Err(McpError::NotFound(
                "conversation session not found".to_string(),
            ));
        }

        Ok(LocalConversationArchiveResponse {
            session_id: session_id.to_string(),
            status,
        })
    }

    pub async fn rename_local_conversation(
        &self,
        session_id: &str,
        title: String,
    ) -> Result<LocalConversationRenameResponse, McpError> {
        let now = now_rfc3339()?;
        let normalized_title = {
            let trimmed = title.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        };
        let result = sqlx::query(
            r#"
            UPDATE conversation_session
            SET title = ?, updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(&normalized_title)
        .bind(&now)
        .bind(session_id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if result.rows_affected() == 0 {
            return Err(McpError::NotFound(
                "conversation session not found".to_string(),
            ));
        }

        Ok(LocalConversationRenameResponse {
            session_id: session_id.to_string(),
            title: normalized_title,
        })
    }

    pub async fn delete_local_conversation_message(
        &self,
        session_id: &str,
        turn_index: i64,
    ) -> Result<LocalConversationDeleteResponse, McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }
        if turn_index <= 0 {
            return Err(McpError::validation("turn_index must be greater than 0"));
        }

        let now = now_rfc3339()?;
        let mut tx = self.pool.begin().await?;

        let session_exists = sqlx::query(
            r#"
            SELECT id FROM conversation_session
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_session_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if session_exists.is_none() {
            return Err(McpError::NotFound(
                "conversation session not found".to_string(),
            ));
        }

        let result = sqlx::query(
            r#"
            UPDATE conversation_message
            SET is_deleted = 1, updated_at = ?
            WHERE session_id = ? AND turn_index = ? AND is_deleted = 0;
            "#,
        )
        .bind(&now)
        .bind(&normalized_session_id)
        .bind(turn_index)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let deleted = result.rows_affected() > 0;
        if deleted {
            sqlx::query(
                r#"
                DELETE FROM conversation_summary
                WHERE session_id = ?;
                "#,
            )
            .bind(&normalized_session_id)
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            sqlx::query(
                r#"
                DELETE FROM conversation_summary_job
                WHERE session_id = ?;
                "#,
            )
            .bind(&normalized_session_id)
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            sqlx::query(
                r#"
                DELETE FROM conversation_summary_idle_task
                WHERE session_id = ?;
                "#,
            )
            .bind(&normalized_session_id)
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            sqlx::query(
                r#"
                UPDATE conversation_session
                SET message_count = CASE WHEN message_count > 0 THEN message_count - 1 ELSE 0 END,
                    total_tokens = COALESCE((
                        SELECT SUM(token_estimate)
                        FROM (
                            SELECT token_estimate
                            FROM conversation_message
                            WHERE session_id = ? AND is_deleted = 0
                            ORDER BY turn_index DESC
                            LIMIT ?
                        )
                    ), 0),
                    last_summary_version = 0,
                    summarizing = 0,
                    summary_job_id = '',
                    last_summary_generated_at = NULL,
                    last_active_at = ?,
                    updated_at = ?
                WHERE id = ?;
                "#,
            )
            .bind(&normalized_session_id)
            .bind(LOCAL_CONVERSATION_ACTIVE_WINDOW_TURNS_INTERNAL)
            .bind(&now)
            .bind(&now)
            .bind(&normalized_session_id)
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        }

        tx.commit().await?;

        Ok(LocalConversationDeleteResponse {
            session_id: normalized_session_id,
            turn_index,
            deleted,
        })
    }

    pub async fn clear_local_conversation(
        &self,
        session_id: &str,
    ) -> Result<LocalConversationClearResponse, McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }

        let now = now_rfc3339()?;
        let mut tx = self.pool.begin().await?;

        let session_exists = sqlx::query(
            r#"
            SELECT id FROM conversation_session
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_session_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if session_exists.is_none() {
            return Err(McpError::NotFound(
                "conversation session not found".to_string(),
            ));
        }

        sqlx::query(
            r#"
            UPDATE conversation_message
            SET is_deleted = 1, updated_at = ?
            WHERE session_id = ? AND is_deleted = 0;
            "#,
        )
        .bind(&now)
        .bind(&normalized_session_id)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            DELETE FROM conversation_summary
            WHERE session_id = ?;
            "#,
        )
        .bind(&normalized_session_id)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            DELETE FROM conversation_summary_job
            WHERE session_id = ?;
            "#,
        )
        .bind(&normalized_session_id)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            DELETE FROM conversation_summary_idle_task
            WHERE session_id = ?;
            "#,
        )
        .bind(&normalized_session_id)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            UPDATE conversation_session
            SET message_count = 0,
                total_tokens = 0,
                last_summary_version = 0,
                summarizing = 0,
                summary_job_id = '',
                last_summary_generated_at = NULL,
                first_message_at = NULL,
                last_active_at = ?,
                updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(&now)
        .bind(&now)
        .bind(&normalized_session_id)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        tx.commit().await?;

        Ok(LocalConversationClearResponse {
            session_id: normalized_session_id,
            cleared: true,
        })
    }

    pub async fn prepare_local_conversation_regenerate(
        &self,
        session_id: &str,
    ) -> Result<LocalConversationRegenerateContext, McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }

        let now = now_rfc3339()?;
        let mut tx = self.pool.begin().await?;

        let session_row = sqlx::query(
            r#"
            SELECT assistant_id
            FROM conversation_session
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_session_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?
        .ok_or_else(|| McpError::NotFound("conversation session not found".to_string()))?;

        let assistant_id: Option<String> = session_row.try_get("assistant_id")?;

        let rows = sqlx::query(
            r#"
            SELECT role, content, turn_index
            FROM conversation_message
            WHERE session_id = ? AND is_deleted = 0
            ORDER BY turn_index ASC;
            "#,
        )
        .bind(&normalized_session_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if rows.is_empty() {
            return Err(McpError::validation("conversation has no messages"));
        }

        let mut timeline = Vec::with_capacity(rows.len());
        for row in rows {
            timeline.push((
                row.try_get::<i64, _>("turn_index")?,
                row.try_get::<String, _>("role")?,
                row.try_get::<Option<String>, _>("content")?,
            ));
        }

        let last_user_turn = timeline
            .iter()
            .rev()
            .find_map(|(turn, role, _)| if role == "user" { Some(*turn) } else { None })
            .ok_or_else(|| McpError::validation("no user message found"))?;

        let deleted_turn_index = timeline.iter().find_map(|(turn, role, _)| {
            if role == "assistant" && *turn > last_user_turn {
                Some(*turn)
            } else {
                None
            }
        });

        if let Some(turn) = deleted_turn_index {
            let delete_result = sqlx::query(
                r#"
                UPDATE conversation_message
                SET is_deleted = 1, updated_at = ?
                WHERE session_id = ? AND turn_index = ? AND is_deleted = 0;
                "#,
            )
            .bind(&now)
            .bind(&normalized_session_id)
            .bind(turn)
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            if delete_result.rows_affected() > 0 {
                sqlx::query(
                    r#"
                    DELETE FROM conversation_summary
                    WHERE session_id = ?;
                    "#,
                )
                .bind(&normalized_session_id)
                .execute(&mut *tx)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;

                sqlx::query(
                    r#"
                    DELETE FROM conversation_summary_job
                    WHERE session_id = ?;
                    "#,
                )
                .bind(&normalized_session_id)
                .execute(&mut *tx)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;

                sqlx::query(
                    r#"
                    DELETE FROM conversation_summary_idle_task
                    WHERE session_id = ?;
                    "#,
                )
                .bind(&normalized_session_id)
                .execute(&mut *tx)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;

                sqlx::query(
                    r#"
                    UPDATE conversation_session
                    SET message_count = CASE WHEN message_count > 0 THEN message_count - 1 ELSE 0 END,
                        total_tokens = COALESCE((
                            SELECT SUM(token_estimate)
                            FROM (
                                SELECT token_estimate
                                FROM conversation_message
                                WHERE session_id = ? AND is_deleted = 0
                                ORDER BY turn_index DESC
                                LIMIT ?
                            )
                        ), 0),
                        last_summary_version = 0,
                        summarizing = 0,
                        summary_job_id = '',
                        last_summary_generated_at = NULL,
                        last_active_at = ?,
                        updated_at = ?
                    WHERE id = ?;
                    "#,
                )
                .bind(&normalized_session_id)
                .bind(LOCAL_CONVERSATION_ACTIVE_WINDOW_TURNS_INTERNAL)
                .bind(&now)
                .bind(&now)
                .bind(&normalized_session_id)
                .execute(&mut *tx)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;
            }
        }

        let messages: Vec<LocalChatInputMessage> = timeline
            .into_iter()
            .filter(|(turn, _, _)| deleted_turn_index != Some(*turn))
            .map(|(_, role, content)| LocalChatInputMessage {
                role,
                content: content.unwrap_or_default(),
                tool_calls: vec![],
                tool_call_id: None,
                name: None,
            })
            .collect();

        if messages.is_empty() {
            return Err(McpError::validation("conversation has no messages"));
        }

        tx.commit().await?;

        Ok(LocalConversationRegenerateContext {
            session_id: normalized_session_id,
            assistant_id,
            deleted_turn_index,
            messages,
        })
    }

    pub async fn get_local_conversation_chat_context(
        &self,
        session_id: &str,
    ) -> Result<LocalConversationChatContext, McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }

        let session_row = sqlx::query(
            r#"
            SELECT assistant_id
            FROM conversation_session
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_session_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?
        .ok_or_else(|| McpError::NotFound("conversation session not found".to_string()))?;

        let assistant_id: Option<String> = session_row.try_get("assistant_id")?;

        let rows = sqlx::query(
            r#"
            SELECT role, content
            FROM (
              SELECT role, content, turn_index
              FROM conversation_message
              WHERE session_id = ? AND is_deleted = 0
              ORDER BY turn_index DESC
              LIMIT ?
            ) windowed
            ORDER BY turn_index ASC;
            "#,
        )
        .bind(&normalized_session_id)
        .bind(LOCAL_CONVERSATION_ACTIVE_WINDOW_TURNS_INTERNAL)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if rows.is_empty() {
            return Err(McpError::validation("conversation has no messages"));
        }

        let messages = rows
            .into_iter()
            .map(|row| LocalChatInputMessage {
                role: row
                    .try_get::<String, _>("role")
                    .unwrap_or_else(|_| "user".to_string()),
                content: row
                    .try_get::<Option<String>, _>("content")
                    .ok()
                    .flatten()
                    .unwrap_or_default(),
                tool_calls: vec![],
                tool_call_id: None,
                name: None,
            })
            .collect();

        Ok(LocalConversationChatContext {
            session_id: normalized_session_id,
            assistant_id,
            messages,
        })
    }

    pub async fn append_local_conversation_message(
        &self,
        payload: CreateConversationMessageRequest,
    ) -> Result<LocalConversationHistoryMessage, McpError> {
        let session_id = payload.session_id.trim().to_string();
        if session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }
        let role = payload.role.trim().to_string();
        if role.is_empty() {
            return Err(McpError::validation("role is required"));
        }

        let now = now_rfc3339()?;
        let content = if payload.content.trim().is_empty() {
            None
        } else {
            Some(payload.content)
        };
        let name = payload.name.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let parent_message_id = payload.parent_message_id.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let meta_json = payload
            .meta_info
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|err| McpError::Storage(err.to_string()))?;
        let is_truncated = payload.is_truncated.unwrap_or(false);
        let token_estimate = payload
            .meta_info
            .as_ref()
            .and_then(|value| value.get("token_estimate"))
            .and_then(|value| value.as_i64())
            .filter(|value| *value >= 0)
            .unwrap_or_else(|| estimate_token_count(content.as_deref().unwrap_or("")));

        let mut tx = self.pool.begin().await?;

        let exists = sqlx::query(
            r#"
            SELECT id FROM conversation_session
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&session_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if exists.is_none() {
            return Err(McpError::NotFound(
                "conversation session not found".to_string(),
            ));
        }

        let turn_row = sqlx::query(
            r#"
            SELECT COALESCE(MAX(turn_index), 0) + 1 AS next_turn
            FROM conversation_message
            WHERE session_id = ?;
            "#,
        )
        .bind(&session_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let next_turn: i64 = turn_row.try_get("next_turn")?;
        let message_id = Uuid::new_v4().to_string();

        sqlx::query(
            r#"
            INSERT INTO conversation_message (
              id, session_id, turn_index, role, name, content, meta_info, used_persona_id,
              token_estimate, is_truncated, is_deleted, parent_message_id, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 0, ?, ?, ?);
            "#,
        )
        .bind(&message_id)
        .bind(&session_id)
        .bind(next_turn)
        .bind(&role)
        .bind(&name)
        .bind(&content)
        .bind(&meta_json)
        .bind(token_estimate)
        .bind(if is_truncated { 1 } else { 0 })
        .bind(&parent_message_id)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let window_tokens_row = sqlx::query(
            r#"
            SELECT COALESCE(SUM(token_estimate), 0) AS total_tokens
            FROM (
              SELECT token_estimate
              FROM conversation_message
              WHERE session_id = ? AND is_deleted = 0
              ORDER BY turn_index DESC
              LIMIT ?
            );
            "#,
        )
        .bind(&session_id)
        .bind(LOCAL_CONVERSATION_ACTIVE_WINDOW_TURNS_INTERNAL)
        .fetch_one(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let window_tokens = window_tokens_row
            .try_get::<i64, _>("total_tokens")
            .unwrap_or(0);

        sqlx::query(
            r#"
            UPDATE conversation_session
            SET message_count = message_count + 1,
                total_tokens = ?,
                first_message_at = COALESCE(first_message_at, ?),
                last_active_at = ?,
                updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(window_tokens)
        .bind(&now)
        .bind(&now)
        .bind(&now)
        .bind(&session_id)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        tx.commit().await?;

        Ok(LocalConversationHistoryMessage {
            role,
            content: content.map(serde_json::Value::String),
            turn_index: Some(next_turn),
            created_at: Some(now),
            is_truncated: Some(is_truncated),
            name,
            meta_info: payload.meta_info,
        })
    }

    /// Returns the latest summary text for a conversation session, or None if no summary exists.
    pub async fn get_latest_local_conversation_summary(
        &self,
        session_id: &str,
    ) -> Result<Option<String>, McpError> {
        let normalized = session_id.trim().to_string();
        if normalized.is_empty() {
            return Ok(None);
        }

        let session_row = sqlx::query(
            r#"
            SELECT last_summary_version
            FROM conversation_session
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let version: i64 = match session_row {
            Some(row) => row.try_get::<i64, _>("last_summary_version").unwrap_or(0),
            None => return Ok(None),
        };
        if version <= 0 {
            return Ok(None);
        }

        let summary_row = sqlx::query(
            r#"
            SELECT summary_text
            FROM conversation_summary
            WHERE session_id = ? AND version = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized)
        .bind(version)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(summary_row.and_then(|row| {
            row.try_get::<String, _>("summary_text")
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        }))
    }

    pub async fn persist_local_conversation_summary(
        &self,
        session_id: &str,
        summary_text: &str,
        summarizer_model: Option<&str>,
    ) -> Result<(), McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }

        let normalized_summary = summary_text.trim().to_string();
        if normalized_summary.is_empty() {
            return Err(McpError::validation("summary_text is required"));
        }

        let normalized_summarizer_model = summarizer_model.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });

        let now = now_rfc3339()?;
        let mut tx = self.pool.begin().await?;

        let session_row = sqlx::query(
            r#"
            SELECT id, last_summary_version
            FROM conversation_session
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_session_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?
        .ok_or_else(|| McpError::NotFound("conversation session not found".to_string()))?;

        let message_rows = sqlx::query(
            r#"
            SELECT id, turn_index, token_estimate
            FROM (
              SELECT id, turn_index, token_estimate
              FROM conversation_message
              WHERE session_id = ? AND is_deleted = 0
              ORDER BY turn_index DESC
              LIMIT ?
            ) windowed
            ORDER BY turn_index ASC;
            "#,
        )
        .bind(&normalized_session_id)
        .bind(LOCAL_CONVERSATION_ACTIVE_WINDOW_TURNS_INTERNAL)
        .fetch_all(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if message_rows.is_empty() {
            return Err(McpError::validation("conversation has no messages"));
        }

        let first_row = message_rows.first().ok_or_else(|| {
            McpError::Storage("conversation summary missing first row".to_string())
        })?;
        let last_row = message_rows.last().ok_or_else(|| {
            McpError::Storage("conversation summary missing last row".to_string())
        })?;

        let start_message_id: String = first_row.try_get("id")?;
        let end_message_id: String = last_row.try_get("id")?;
        let covered_from_turn: i64 = first_row.try_get("turn_index")?;
        let covered_to_turn: i64 = last_row.try_get("turn_index")?;

        let token_estimate = message_rows.iter().fold(0_i64, |acc, row| {
            acc + row.try_get::<i64, _>("token_estimate").unwrap_or(0)
        });

        let current_version: i64 = session_row.try_get("last_summary_version").unwrap_or(0);
        let new_version = current_version.max(0) + 1;

        let previous_summary_id = if current_version > 0 {
            let row = sqlx::query(
                r#"
                SELECT id
                FROM conversation_summary
                WHERE session_id = ? AND version = ?
                LIMIT 1;
                "#,
            )
            .bind(&normalized_session_id)
            .bind(current_version)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            row.and_then(|item| item.try_get::<String, _>("id").ok())
        } else {
            None
        };

        let summary_id = Uuid::new_v4().to_string();
        sqlx::query(
            r#"
            INSERT INTO conversation_summary (
              id, session_id, version, summary_text, covered_from_turn, covered_to_turn,
              previous_summary_id, start_message_id, end_message_id, token_estimate,
              summarizer_model, summarizer_preset_id, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?);
            "#,
        )
        .bind(&summary_id)
        .bind(&normalized_session_id)
        .bind(new_version)
        .bind(&normalized_summary)
        .bind(covered_from_turn)
        .bind(covered_to_turn)
        .bind(&previous_summary_id)
        .bind(&start_message_id)
        .bind(&end_message_id)
        .bind(token_estimate)
        .bind(&normalized_summarizer_model)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            UPDATE conversation_session
            SET last_summary_version = ?,
                total_tokens = ?,
                summarizing = 0,
                summary_job_id = '',
                last_summary_generated_at = ?,
                updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(new_version)
        .bind(token_estimate)
        .bind(&now)
        .bind(&now)
        .bind(&normalized_session_id)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        tx.commit().await?;
        Ok(())
    }

    pub async fn enqueue_local_conversation_summary_job(
        &self,
        session_id: &str,
        trigger_source: &str,
    ) -> Result<(), McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }
        let normalized_trigger_source = {
            let trimmed = trigger_source.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        };

        let now = now_rfc3339()?;
        let now_epoch = now_unix_epoch()?;
        let mut tx = self.pool.begin().await?;

        let session_exists = sqlx::query(
            r#"
            SELECT id
            FROM conversation_session
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_session_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        if session_exists.is_none() {
            return Err(McpError::NotFound(
                "conversation session not found".to_string(),
            ));
        }

        sqlx::query(
            r#"
            DELETE FROM conversation_summary_job
            WHERE session_id = ? AND status IN (?, ?);
            "#,
        )
        .bind(&normalized_session_id)
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_COMPLETED)
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_FAILED)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let refreshed_pending = sqlx::query(
            r#"
            UPDATE conversation_summary_job
            SET trigger_source = COALESCE(?, trigger_source),
                available_after_epoch = ?,
                last_error = NULL,
                updated_at = ?
            WHERE session_id = ? AND status = ?;
            "#,
        )
        .bind(&normalized_trigger_source)
        .bind(now_epoch)
        .bind(&now)
        .bind(&normalized_session_id)
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_PENDING)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        if refreshed_pending.rows_affected() > 0 {
            let pending_job_row = sqlx::query(
                r#"
                SELECT id
                FROM conversation_summary_job
                WHERE session_id = ? AND status = ?
                LIMIT 1;
                "#,
            )
            .bind(&normalized_session_id)
            .bind(CONVERSATION_SUMMARY_JOB_STATUS_PENDING)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            let pending_job_id = pending_job_row
                .and_then(|row| row.try_get::<String, _>("id").ok())
                .unwrap_or_default();
            sqlx::query(
                r#"
                UPDATE conversation_session
                SET summarizing = 1,
                    summary_job_id = ?,
                    updated_at = ?
                WHERE id = ?;
                "#,
            )
            .bind(&pending_job_id)
            .bind(&now)
            .bind(&normalized_session_id)
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            tx.commit().await?;
            return Ok(());
        }

        let running_exists = sqlx::query(
            r#"
            SELECT id
            FROM conversation_summary_job
            WHERE session_id = ? AND status = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_session_id)
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_RUNNING)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        if let Some(row) = running_exists {
            let running_job_id = row.try_get::<String, _>("id").unwrap_or_default();
            sqlx::query(
                r#"
                UPDATE conversation_session
                SET summarizing = 1,
                    summary_job_id = ?,
                    updated_at = ?
                WHERE id = ?;
                "#,
            )
            .bind(&running_job_id)
            .bind(&now)
            .bind(&normalized_session_id)
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            tx.commit().await?;
            return Ok(());
        }

        let job_id = Uuid::new_v4().to_string();
        let insert_result = sqlx::query(
            r#"
            INSERT OR IGNORE INTO conversation_summary_job (
              id, session_id, status, trigger_source, attempts, max_attempts,
              available_after_epoch, last_error, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, 0, ?, ?, NULL, ?, ?);
            "#,
        )
        .bind(&job_id)
        .bind(&normalized_session_id)
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_PENDING)
        .bind(&normalized_trigger_source)
        .bind(CONVERSATION_SUMMARY_JOB_MAX_ATTEMPTS)
        .bind(now_epoch)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if insert_result.rows_affected() == 0 {
            let _ = sqlx::query(
                r#"
                UPDATE conversation_summary_job
                SET trigger_source = COALESCE(?, trigger_source),
                    available_after_epoch = ?,
                    last_error = NULL,
                    updated_at = ?
                WHERE session_id = ? AND status = ?;
                "#,
            )
            .bind(&normalized_trigger_source)
            .bind(now_epoch)
            .bind(&now)
            .bind(&normalized_session_id)
            .bind(CONVERSATION_SUMMARY_JOB_STATUS_PENDING)
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        }

        sqlx::query(
            r#"
            UPDATE conversation_session
            SET summarizing = 1,
                summary_job_id = ?,
                updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(&job_id)
        .bind(&now)
        .bind(&normalized_session_id)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        tx.commit().await?;
        Ok(())
    }

    pub async fn claim_next_local_conversation_summary_job(
        &self,
    ) -> Result<Option<LocalConversationSummaryJob>, McpError> {
        let now = now_rfc3339()?;
        let now_epoch = now_unix_epoch()?;
        let mut tx = self.pool.begin().await?;

        let next_row = sqlx::query(
            r#"
            SELECT id, session_id, attempts, max_attempts
            FROM conversation_summary_job
            WHERE status = ? AND available_after_epoch <= ?
            ORDER BY available_after_epoch ASC, created_at ASC
            LIMIT 1;
            "#,
        )
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_PENDING)
        .bind(now_epoch)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let Some(row) = next_row else {
            tx.commit().await?;
            return Ok(None);
        };

        let id: String = row.try_get("id")?;
        let session_id: String = row.try_get("session_id")?;
        let previous_attempts: i64 = row.try_get("attempts").unwrap_or(0);
        let max_attempts: i64 = row
            .try_get::<i64, _>("max_attempts")
            .unwrap_or(CONVERSATION_SUMMARY_JOB_MAX_ATTEMPTS);
        let attempts = previous_attempts.saturating_add(1);

        let result = sqlx::query(
            r#"
            UPDATE conversation_summary_job
            SET status = ?,
                attempts = ?,
                last_error = NULL,
                updated_at = ?
            WHERE id = ? AND status = ?;
            "#,
        )
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_RUNNING)
        .bind(attempts)
        .bind(&now)
        .bind(&id)
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_PENDING)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if result.rows_affected() == 0 {
            tx.commit().await?;
            return Ok(None);
        }

        tx.commit().await?;
        Ok(Some(LocalConversationSummaryJob {
            id,
            session_id,
            attempts,
            max_attempts,
        }))
    }

    pub async fn complete_local_conversation_summary_job(
        &self,
        job_id: &str,
    ) -> Result<(), McpError> {
        let normalized_job_id = job_id.trim().to_string();
        if normalized_job_id.is_empty() {
            return Err(McpError::validation("job_id is required"));
        }

        let now = now_rfc3339()?;
        let mut tx = self.pool.begin().await?;
        let session_row = sqlx::query(
            r#"
            SELECT session_id
            FROM conversation_summary_job
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_job_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            UPDATE conversation_summary_job
            SET status = ?,
                last_error = NULL,
                available_after_epoch = 0,
                updated_at = ?
            WHERE id = ? AND status = ?;
            "#,
        )
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_COMPLETED)
        .bind(&now)
        .bind(&normalized_job_id)
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_RUNNING)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if let Some(row) = session_row {
            let session_id: String = row.try_get("session_id")?;
            sqlx::query(
                r#"
                UPDATE conversation_session
                SET summarizing = 0,
                    summary_job_id = '',
                    updated_at = ?
                WHERE id = ?;
                "#,
            )
            .bind(&now)
            .bind(&session_id)
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        }

        tx.commit().await?;

        Ok(())
    }

    pub async fn fail_local_conversation_summary_job(
        &self,
        job: &LocalConversationSummaryJob,
        error_message: &str,
        retry_delay_seconds: i64,
    ) -> Result<(), McpError> {
        let normalized_job_id = job.id.trim().to_string();
        if normalized_job_id.is_empty() {
            return Err(McpError::validation("job_id is required"));
        }

        let max_attempts = if job.max_attempts <= 0 {
            CONVERSATION_SUMMARY_JOB_MAX_ATTEMPTS
        } else {
            job.max_attempts
        };
        let should_retry = job.attempts < max_attempts;
        let next_status = if should_retry {
            CONVERSATION_SUMMARY_JOB_STATUS_PENDING
        } else {
            CONVERSATION_SUMMARY_JOB_STATUS_FAILED
        };

        let now = now_rfc3339()?;
        let now_epoch = now_unix_epoch()?;
        let next_available_after = if should_retry {
            now_epoch.saturating_add(retry_delay_seconds.max(0))
        } else {
            now_epoch
        };
        let normalized_error = {
            let trimmed = error_message.trim();
            if trimmed.is_empty() {
                "conversation summary worker failed".to_string()
            } else {
                trimmed.chars().take(2000).collect()
            }
        };

        let mut tx = self.pool.begin().await?;
        sqlx::query(
            r#"
            UPDATE conversation_summary_job
            SET status = ?,
                available_after_epoch = ?,
                last_error = ?,
                updated_at = ?
            WHERE id = ? AND status = ?;
            "#,
        )
        .bind(next_status)
        .bind(next_available_after)
        .bind(&normalized_error)
        .bind(&now)
        .bind(&normalized_job_id)
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_RUNNING)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            UPDATE conversation_session
            SET summarizing = ?,
                summary_job_id = ?,
                updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(if should_retry { 1 } else { 0 })
        .bind(if should_retry {
            normalized_job_id.as_str()
        } else {
            ""
        })
        .bind(&now)
        .bind(&job.session_id)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        tx.commit().await?;

        Ok(())
    }

    pub async fn touch_local_conversation_summary_idle_task(
        &self,
        session_id: &str,
    ) -> Result<(), McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }

        let now = now_rfc3339()?;
        let now_epoch = now_unix_epoch()?;
        let run_after_epoch = now_epoch.saturating_add(LOCAL_CONVERSATION_SUMMARY_IDLE_SECONDS);

        sqlx::query(
            r#"
            INSERT INTO conversation_summary_idle_task (
              session_id, last_active_epoch, run_after_epoch, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(session_id) DO UPDATE
            SET last_active_epoch = excluded.last_active_epoch,
                run_after_epoch = conversation_summary_idle_task.run_after_epoch,
                updated_at = excluded.updated_at;
            "#,
        )
        .bind(&normalized_session_id)
        .bind(now_epoch)
        .bind(run_after_epoch)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(())
    }

    pub async fn try_trigger_local_conversation_summary_flush(
        &self,
        session_id: &str,
        trigger_source: &str,
    ) -> Result<bool, McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }

        let session_row = sqlx::query(
            r#"
            SELECT total_tokens, summarizing
            FROM conversation_session
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_session_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?
        .ok_or_else(|| McpError::NotFound("conversation session not found".to_string()))?;

        let total_tokens = session_row.try_get::<i64, _>("total_tokens").unwrap_or(0);
        let summarizing = session_row.try_get::<i64, _>("summarizing").unwrap_or(0) != 0;
        if total_tokens < LOCAL_CONVERSATION_FLUSH_THRESHOLD_TOKENS || summarizing {
            return Ok(false);
        }

        self.enqueue_local_conversation_summary_job(&normalized_session_id, trigger_source)
            .await?;
        Ok(true)
    }

    pub async fn dispatch_due_local_conversation_summary_idle_tasks(
        &self,
    ) -> Result<i64, McpError> {
        let now_epoch = now_unix_epoch()?;
        let due_rows = sqlx::query(
            r#"
            SELECT session_id, last_active_epoch
            FROM conversation_summary_idle_task
            WHERE run_after_epoch <= ?
            ORDER BY run_after_epoch ASC
            LIMIT ?;
            "#,
        )
        .bind(now_epoch)
        .bind(LOCAL_CONVERSATION_IDLE_CHECK_BATCH_SIZE)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut dispatched = 0_i64;
        for row in due_rows {
            let session_id: String = row.try_get("session_id")?;
            let last_active_epoch = row.try_get::<i64, _>("last_active_epoch").unwrap_or(0);

            let claim = sqlx::query(
                r#"
                DELETE FROM conversation_summary_idle_task
                WHERE session_id = ? AND run_after_epoch <= ?;
                "#,
            )
            .bind(&session_id)
            .bind(now_epoch)
            .execute(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            if claim.rows_affected() == 0 {
                continue;
            }

            if now_epoch.saturating_sub(last_active_epoch) < LOCAL_CONVERSATION_SUMMARY_IDLE_SECONDS
            {
                continue;
            }

            let session_row = sqlx::query(
                r#"
                SELECT message_count, summarizing, last_summary_version, last_summary_generated_at
                FROM conversation_session
                WHERE id = ?
                LIMIT 1;
                "#,
            )
            .bind(&session_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            let Some(session_row) = session_row else {
                continue;
            };

            let message_count = session_row.try_get::<i64, _>("message_count").unwrap_or(0);
            if message_count <= 0 {
                continue;
            }
            let summarizing = session_row.try_get::<i64, _>("summarizing").unwrap_or(0) != 0;
            if summarizing {
                continue;
            }

            let max_turn_row = sqlx::query(
                r#"
                SELECT COALESCE(MAX(turn_index), 0) AS max_turn
                FROM conversation_message
                WHERE session_id = ? AND is_deleted = 0;
                "#,
            )
            .bind(&session_id)
            .fetch_one(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            let last_turn = max_turn_row.try_get::<i64, _>("max_turn").unwrap_or(0);
            if last_turn <= 0 {
                continue;
            }

            let last_summary_version = session_row
                .try_get::<i64, _>("last_summary_version")
                .unwrap_or(0);
            if last_summary_version > 0 {
                let covered_row = sqlx::query(
                    r#"
                    SELECT covered_to_turn
                    FROM conversation_summary
                    WHERE session_id = ? AND version = ?
                    LIMIT 1;
                    "#,
                )
                .bind(&session_id)
                .bind(last_summary_version)
                .fetch_optional(&self.pool)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;
                if let Some(covered_row) = covered_row {
                    let covered_to_turn = covered_row
                        .try_get::<i64, _>("covered_to_turn")
                        .unwrap_or(0);
                    if covered_to_turn >= last_turn {
                        continue;
                    }
                }
            }

            let last_summary_generated_at: Option<String> = session_row
                .try_get("last_summary_generated_at")
                .ok()
                .flatten();
            if let Some(last_summary_generated_at) = last_summary_generated_at {
                if let Some(last_summary_epoch) =
                    parse_rfc3339_to_unix_epoch(last_summary_generated_at.as_str())
                {
                    if now_epoch.saturating_sub(last_summary_epoch)
                        < LOCAL_CONVERSATION_SUMMARY_MIN_INTERVAL_SECONDS
                    {
                        continue;
                    }
                }
            }

            self.enqueue_local_conversation_summary_job(&session_id, "idle_check")
                .await?;
            dispatched = dispatched.saturating_add(1);
        }

        Ok(dispatched)
    }

    pub async fn upsert_local_periodic_task(
        &self,
        task_name: &str,
        interval_seconds: i64,
        initial_delay_seconds: i64,
    ) -> Result<(), McpError> {
        let normalized_task_name = task_name.trim().to_string();
        if normalized_task_name.is_empty() {
            return Err(McpError::validation("task_name is required"));
        }
        if interval_seconds <= 0 {
            return Err(McpError::validation(
                "interval_seconds must be greater than 0",
            ));
        }

        let now = now_rfc3339()?;
        let now_epoch = now_unix_epoch()?;
        let next_run_after_epoch = now_epoch.saturating_add(initial_delay_seconds.max(0));

        sqlx::query(
            r#"
            INSERT INTO local_periodic_task (
              task_name, interval_seconds, next_run_after_epoch, is_enabled,
              last_run_at, last_success_at, last_error, last_error_at,
              created_at, updated_at
            )
            VALUES (?, ?, ?, 1, NULL, NULL, NULL, NULL, ?, ?)
            ON CONFLICT(task_name) DO UPDATE
            SET interval_seconds = excluded.interval_seconds,
                is_enabled = 1,
                next_run_after_epoch = CASE
                    WHEN local_periodic_task.next_run_after_epoch < excluded.next_run_after_epoch
                    THEN local_periodic_task.next_run_after_epoch
                    ELSE excluded.next_run_after_epoch
                END,
                updated_at = excluded.updated_at;
            "#,
        )
        .bind(&normalized_task_name)
        .bind(interval_seconds)
        .bind(next_run_after_epoch)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(())
    }

    pub async fn claim_next_local_periodic_task(
        &self,
    ) -> Result<Option<LocalPeriodicTask>, McpError> {
        let now = now_rfc3339()?;
        let now_epoch = now_unix_epoch()?;
        let mut tx = self.pool.begin().await?;

        let task_row = sqlx::query(
            r#"
            SELECT task_name, interval_seconds, next_run_after_epoch
            FROM local_periodic_task
            WHERE is_enabled = 1 AND next_run_after_epoch <= ?
            ORDER BY next_run_after_epoch ASC
            LIMIT 1;
            "#,
        )
        .bind(now_epoch)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let Some(row) = task_row else {
            tx.commit().await?;
            return Ok(None);
        };

        let task_name: String = row.try_get("task_name")?;
        let interval_seconds = row
            .try_get::<i64, _>("interval_seconds")
            .unwrap_or(60)
            .max(1);
        let next_run_after_epoch = now_epoch.saturating_add(interval_seconds);

        let result = sqlx::query(
            r#"
            UPDATE local_periodic_task
            SET next_run_after_epoch = ?,
                last_run_at = ?,
                updated_at = ?
            WHERE task_name = ? AND is_enabled = 1 AND next_run_after_epoch <= ?;
            "#,
        )
        .bind(next_run_after_epoch)
        .bind(&now)
        .bind(&now)
        .bind(&task_name)
        .bind(now_epoch)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if result.rows_affected() == 0 {
            tx.commit().await?;
            return Ok(None);
        }

        tx.commit().await?;
        Ok(Some(LocalPeriodicTask {
            task_name,
            interval_seconds,
        }))
    }

    pub async fn mark_local_periodic_task_success(&self, task_name: &str) -> Result<(), McpError> {
        let normalized_task_name = task_name.trim().to_string();
        if normalized_task_name.is_empty() {
            return Err(McpError::validation("task_name is required"));
        }
        let now = now_rfc3339()?;

        sqlx::query(
            r#"
            UPDATE local_periodic_task
            SET last_success_at = ?,
                last_error = NULL,
                last_error_at = NULL,
                updated_at = ?
            WHERE task_name = ?;
            "#,
        )
        .bind(&now)
        .bind(&now)
        .bind(&normalized_task_name)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(())
    }

    pub async fn mark_local_periodic_task_failure(
        &self,
        task_name: &str,
        error_message: &str,
    ) -> Result<(), McpError> {
        let normalized_task_name = task_name.trim().to_string();
        if normalized_task_name.is_empty() {
            return Err(McpError::validation("task_name is required"));
        }
        let now = now_rfc3339()?;
        let normalized_error = {
            let trimmed = error_message.trim();
            if trimmed.is_empty() {
                "periodic task failed".to_string()
            } else {
                trimmed
                    .chars()
                    .take(LOCAL_PERIODIC_TASK_MAX_ERROR_CHARS)
                    .collect()
            }
        };

        sqlx::query(
            r#"
            UPDATE local_periodic_task
            SET last_error = ?,
                last_error_at = ?,
                updated_at = ?
            WHERE task_name = ?;
            "#,
        )
        .bind(&normalized_error)
        .bind(&now)
        .bind(&now)
        .bind(&normalized_task_name)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(())
    }

    pub async fn cleanup_old_local_conversation_summary_jobs(
        &self,
        older_than_seconds: i64,
    ) -> Result<i64, McpError> {
        if older_than_seconds <= 0 {
            return Err(McpError::validation(
                "older_than_seconds must be greater than 0",
            ));
        }
        let threshold_epoch = now_unix_epoch()?.saturating_sub(older_than_seconds);
        let result = sqlx::query(
            r#"
            DELETE FROM conversation_summary_job
            WHERE status IN (?, ?)
              AND COALESCE(CAST(strftime('%s', updated_at) AS INTEGER), 0) <= ?;
            "#,
        )
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_COMPLETED)
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_FAILED)
        .bind(threshold_epoch)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(i64::try_from(result.rows_affected()).unwrap_or(i64::MAX))
    }

    pub async fn get_local_conversation_history(
        &self,
        session_id: &str,
        query: LocalConversationHistoryQuery,
    ) -> Result<LocalConversationHistoryResponse, McpError> {
        let limit = query.limit.unwrap_or(30).clamp(1, 200);
        let before_turn = query.cursor;

        let rows = if let Some(cursor) = before_turn {
            sqlx::query(
                r#"
                SELECT role, content, turn_index, created_at, is_truncated, name, meta_info
                FROM conversation_message
                WHERE session_id = ? AND is_deleted = 0 AND turn_index < ?
                ORDER BY turn_index DESC
                LIMIT ?;
                "#,
            )
            .bind(session_id)
            .bind(cursor)
            .bind(limit)
            .fetch_all(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?
        } else {
            sqlx::query(
                r#"
                SELECT role, content, turn_index, created_at, is_truncated, name, meta_info
                FROM conversation_message
                WHERE session_id = ? AND is_deleted = 0
                ORDER BY turn_index DESC
                LIMIT ?;
                "#,
            )
            .bind(session_id)
            .bind(limit)
            .fetch_all(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?
        };

        let mut messages_desc = Vec::with_capacity(rows.len());
        for row in rows {
            let content_text: Option<String> = row.try_get("content")?;
            let meta_info_text: Option<String> = row.try_get("meta_info")?;
            messages_desc.push(LocalConversationHistoryMessage {
                role: row.try_get("role")?,
                content: content_text.map(serde_json::Value::String),
                turn_index: row.try_get("turn_index")?,
                created_at: row.try_get("created_at")?,
                is_truncated: Some(row.try_get::<i64, _>("is_truncated")? != 0),
                name: row.try_get("name")?,
                meta_info: match meta_info_text {
                    Some(text) if !text.trim().is_empty() => serde_json::from_str(&text).ok(),
                    _ => None,
                },
            });
        }

        let oldest_turn = messages_desc
            .last()
            .and_then(|item| item.turn_index)
            .unwrap_or_default();
        let has_more = if messages_desc.is_empty() {
            false
        } else {
            let row = sqlx::query(
                r#"
                SELECT EXISTS(
                  SELECT 1
                  FROM conversation_message
                  WHERE session_id = ? AND is_deleted = 0 AND turn_index < ?
                ) AS has_more;
                "#,
            )
            .bind(session_id)
            .bind(oldest_turn)
            .fetch_one(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            row.try_get::<i64, _>("has_more")? != 0
        };

        let mut messages = messages_desc;
        messages.reverse();

        Ok(LocalConversationHistoryResponse {
            session_id: session_id.to_string(),
            messages,
            next_cursor: if has_more { Some(oldest_turn) } else { None },
            has_more,
        })
    }

    pub async fn get_local_conversation_window(
        &self,
        session_id: &str,
    ) -> Result<LocalConversationWindowResponse, McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }

        let session_row = sqlx::query(
            r#"
            SELECT
              id, title, status, message_count, total_tokens, last_summary_version,
              summarizing, summary_job_id, last_summary_generated_at,
              first_message_at, last_active_at, created_at, updated_at
            FROM conversation_session
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_session_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let session_row = match session_row {
            Some(row) => row,
            None => {
                return Err(McpError::NotFound(
                    "conversation session not found".to_string(),
                ))
            }
        };

        let rows = sqlx::query(
            r#"
            SELECT role, content, turn_index, created_at, is_truncated, name, meta_info
            FROM conversation_message
            WHERE session_id = ? AND is_deleted = 0
            ORDER BY turn_index ASC;
            "#,
        )
        .bind(&normalized_session_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut messages = Vec::with_capacity(rows.len());
        for row in rows {
            let content_text: Option<String> = row.try_get("content")?;
            let meta_info_text: Option<String> = row.try_get("meta_info")?;
            messages.push(LocalConversationHistoryMessage {
                role: row.try_get("role")?,
                content: content_text.map(serde_json::Value::String),
                turn_index: row.try_get("turn_index")?,
                created_at: row.try_get("created_at")?,
                is_truncated: Some(row.try_get::<i64, _>("is_truncated")? != 0),
                name: row.try_get("name")?,
                meta_info: match meta_info_text {
                    Some(text) if !text.trim().is_empty() => serde_json::from_str(&text).ok(),
                    _ => None,
                },
            });
        }

        let last_summary_version: i64 = session_row.try_get("last_summary_version").unwrap_or(0);
        let summary = if last_summary_version > 0 {
            let summary_row = sqlx::query(
                r#"
                SELECT
                  id, version, summary_text, covered_from_turn, covered_to_turn,
                  token_estimate, summarizer_model, created_at, updated_at
                FROM conversation_summary
                WHERE session_id = ? AND version = ?
                LIMIT 1;
                "#,
            )
            .bind(&normalized_session_id)
            .bind(last_summary_version)
            .fetch_optional(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            summary_row.map(|row| {
                serde_json::json!({
                    "id": row.try_get::<String, _>("id").ok(),
                    "version": row.try_get::<i64, _>("version").ok(),
                    "summary_text": row.try_get::<String, _>("summary_text").ok(),
                    "covered_from_turn": row.try_get::<i64, _>("covered_from_turn").ok(),
                    "covered_to_turn": row.try_get::<i64, _>("covered_to_turn").ok(),
                    "token_estimate": row.try_get::<i64, _>("token_estimate").ok().unwrap_or(0),
                    "summarizer_model": row.try_get::<Option<String>, _>("summarizer_model").ok().flatten(),
                    "created_at": row.try_get::<String, _>("created_at").ok(),
                    "updated_at": row.try_get::<String, _>("updated_at").ok(),
                })
            })
        } else {
            None
        };

        let meta = Some(serde_json::json!({
            "title": session_row.try_get::<Option<String>, _>("title").ok().flatten(),
            "status": session_row.try_get::<String, _>("status").ok(),
            "message_count": session_row.try_get::<i64, _>("message_count").ok().unwrap_or(0),
            "total_tokens": session_row.try_get::<i64, _>("total_tokens").ok().unwrap_or(0),
            "last_summary_version": last_summary_version,
            "summarizing": session_row.try_get::<i64, _>("summarizing").ok().unwrap_or(0) != 0,
            "summary_job_id": session_row.try_get::<Option<String>, _>("summary_job_id").ok().flatten(),
            "last_summary_generated_at": session_row.try_get::<Option<String>, _>("last_summary_generated_at").ok().flatten(),
            "first_message_at": session_row.try_get::<Option<String>, _>("first_message_at").ok().flatten(),
            "last_active_at": session_row.try_get::<Option<String>, _>("last_active_at").ok().flatten(),
            "created_at": session_row.try_get::<Option<String>, _>("created_at").ok().flatten(),
            "updated_at": session_row.try_get::<Option<String>, _>("updated_at").ok().flatten(),
        }));

        Ok(LocalConversationWindowResponse {
            session_id: normalized_session_id,
            messages,
            meta,
            summary,
        })
    }

    async fn migrate_assistant_versions_from_legacy(&self) -> Result<(), McpError> {
        let rows = sqlx::query(
            r#"
            SELECT id, name, description, system_prompt, model_config, tags, is_deleted, created_at, updated_at
            FROM assistants;
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        for row in rows {
            let assistant_id: String = row.try_get("id")?;
            let name: String = row.try_get("name")?;
            let description: Option<String> = row.try_get("description")?;
            let system_prompt: String = row.try_get("system_prompt")?;
            let model_config: Option<String> = row.try_get("model_config")?;
            let tags: Option<String> = row.try_get("tags")?;
            let is_deleted = row.try_get::<i64, _>("is_deleted").unwrap_or(0) != 0;
            let created_at: String = row.try_get("created_at")?;
            let updated_at: String = row.try_get("updated_at")?;
            let published_at = if is_deleted {
                None
            } else {
                Some(created_at.as_str())
            };

            self.ensure_assistant_version_synced(
                &assistant_id,
                &name,
                description.as_deref(),
                &system_prompt,
                model_config.as_deref(),
                tags.as_deref(),
                published_at,
                &created_at,
                &updated_at,
            )
            .await?;
        }

        Ok(())
    }

    async fn migrate_assistant_installs_from_assistant(&self) -> Result<(), McpError> {
        let rows = sqlx::query(
            r#"
            SELECT id, status, created_at
            FROM assistant
            ORDER BY created_at ASC, id ASC;
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut sort_order = 0_i64;
        for row in rows {
            let assistant_id: String = row.try_get("id")?;
            let status: String = row.try_get("status")?;
            let created_at: String = row.try_get("created_at")?;
            if status == "archived" {
                continue;
            }

            let existing = sqlx::query(
                r#"
                SELECT id
                FROM assistant_install
                WHERE user_id = ? AND assistant_id = ?
                LIMIT 1;
                "#,
            )
            .bind(LOCAL_DESKTOP_USER_ID)
            .bind(&assistant_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            if existing.is_none() {
                let install_id = Uuid::new_v4().to_string();
                sqlx::query(
                    r#"
                    INSERT INTO assistant_install (
                      id, user_id, assistant_id, alias, icon_override, pinned_version_id,
                      follow_latest, is_enabled, sort_order, created_at, updated_at
                    )
                    VALUES (?, ?, ?, NULL, NULL, NULL, 1, 1, ?, ?, ?);
                    "#,
                )
                .bind(&install_id)
                .bind(LOCAL_DESKTOP_USER_ID)
                .bind(&assistant_id)
                .bind(sort_order)
                .bind(&created_at)
                .bind(&created_at)
                .execute(&self.pool)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;
            }

            self.refresh_assistant_install_count(&assistant_id, &created_at)
                .await?;
            sort_order += 1;
        }

        Ok(())
    }

    async fn refresh_assistant_install_count(
        &self,
        assistant_id: &str,
        updated_at: &str,
    ) -> Result<(), McpError> {
        sqlx::query(
            r#"
            UPDATE assistant
            SET install_count = (
                SELECT COUNT(1)
                FROM assistant_install
                WHERE assistant_id = ?
            ),
            updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(assistant_id)
        .bind(updated_at)
        .bind(assistant_id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(())
    }

    async fn sync_local_assistant_tags(
        &self,
        assistant_id: &str,
        tags_json: Option<&str>,
        updated_at: &str,
    ) -> Result<(), McpError> {
        let raw_tags: Vec<String> = match tags_json {
            Some(value) if !value.trim().is_empty() => {
                serde_json::from_str(value).unwrap_or_default()
            }
            _ => Vec::new(),
        };
        let normalized = normalize_assistant_tag_names(raw_tags);

        let existing_rows = sqlx::query(
            r#"
            SELECT t.id AS tag_id, t.name AS tag_name
            FROM assistant_tag_link l
            INNER JOIN assistant_tag t ON t.id = l.tag_id
            WHERE l.assistant_id = ?;
            "#,
        )
        .bind(assistant_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut existing_by_name: HashMap<String, String> = HashMap::new();
        let mut current_ids: HashSet<String> = HashSet::new();
        for row in existing_rows {
            let tag_id: String = row.try_get("tag_id")?;
            let tag_name: String = row.try_get("tag_name")?;
            current_ids.insert(tag_id.clone());
            existing_by_name.insert(tag_name, tag_id);
        }

        let mut desired_ids: HashSet<String> = HashSet::new();
        for name in normalized {
            if let Some(existing_id) = existing_by_name.get(&name) {
                desired_ids.insert(existing_id.clone());
                continue;
            }

            let existing_tag_row = sqlx::query(
                r#"
                SELECT id
                FROM assistant_tag
                WHERE name = ?
                LIMIT 1;
                "#,
            )
            .bind(&name)
            .fetch_optional(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            let tag_id = if let Some(row) = existing_tag_row {
                row.try_get::<String, _>("id")?
            } else {
                let new_id = Uuid::new_v4().to_string();
                sqlx::query(
                    r#"
                    INSERT INTO assistant_tag (id, name, created_at, updated_at)
                    VALUES (?, ?, ?, ?);
                    "#,
                )
                .bind(&new_id)
                .bind(&name)
                .bind(updated_at)
                .bind(updated_at)
                .execute(&self.pool)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;
                new_id
            };

            existing_by_name.insert(name, tag_id.clone());
            desired_ids.insert(tag_id);
        }

        for tag_id in current_ids.difference(&desired_ids) {
            sqlx::query(
                r#"
                DELETE FROM assistant_tag_link
                WHERE assistant_id = ? AND tag_id = ?;
                "#,
            )
            .bind(assistant_id)
            .bind(tag_id)
            .execute(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        }

        for tag_id in desired_ids.difference(&current_ids) {
            sqlx::query(
                r#"
                INSERT OR IGNORE INTO assistant_tag_link (assistant_id, tag_id)
                VALUES (?, ?);
                "#,
            )
            .bind(assistant_id)
            .bind(tag_id)
            .execute(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        }

        Ok(())
    }

    async fn refresh_assistant_rating(
        &self,
        assistant_id: &str,
        updated_at: &str,
    ) -> Result<(f64, i64), McpError> {
        let row = sqlx::query(
            r#"
            SELECT
              COALESCE(AVG(rating), 0.0) AS avg_rating,
              COUNT(1) AS total_count
            FROM assistant_rating
            WHERE assistant_id = ?;
            "#,
        )
        .bind(assistant_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let avg_rating = round_to_4(row.try_get::<f64, _>("avg_rating").unwrap_or(0.0));
        let total_count = row.try_get::<i64, _>("total_count").unwrap_or(0);

        sqlx::query(
            r#"
            UPDATE assistant
            SET rating_avg = ?, rating_count = ?, updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(avg_rating)
        .bind(total_count)
        .bind(updated_at)
        .bind(assistant_id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok((avg_rating, total_count))
    }

    async fn get_local_assistant_install_item(
        &self,
        assistant_id: &str,
    ) -> Result<Option<LocalAssistantInstallItem>, McpError> {
        let row = sqlx::query(
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
            WHERE ai.user_id = ? AND ai.assistant_id = ?
            LIMIT 1;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(assistant_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        match row {
            Some(row) => Ok(Some(row_to_assistant_install_item(&row)?)),
            None => Ok(None),
        }
    }

    async fn ensure_assistant_version_synced(
        &self,
        assistant_id: &str,
        name: &str,
        description: Option<&str>,
        system_prompt: &str,
        model_config_json: Option<&str>,
        tags_json: Option<&str>,
        published_at: Option<&str>,
        created_at: &str,
        updated_at: &str,
    ) -> Result<String, McpError> {
        let current_version_row = sqlx::query(
            r#"
            SELECT current_version_id
            FROM assistant
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(assistant_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if current_version_row.is_none() {
            return Err(McpError::NotFound("assistant not found".to_string()));
        }

        let current_version_id: Option<String> =
            current_version_row.unwrap().try_get("current_version_id")?;

        let selected_version_id = if let Some(version_id) = current_version_id {
            let row = sqlx::query(
                r#"
                SELECT id
                FROM assistant_version
                WHERE id = ?
                LIMIT 1;
                "#,
            )
            .bind(&version_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            if row.is_some() {
                version_id
            } else {
                let fallback_row = sqlx::query(
                    r#"
                    SELECT id
                    FROM assistant_version
                    WHERE assistant_id = ?
                    ORDER BY created_at DESC, id DESC
                    LIMIT 1;
                    "#,
                )
                .bind(assistant_id)
                .fetch_optional(&self.pool)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;

                if let Some(row) = fallback_row {
                    row.try_get("id")?
                } else {
                    let new_version_id = Uuid::new_v4().to_string();
                    sqlx::query(
                        r#"
                        INSERT INTO assistant_version (
                          id, assistant_id, version, name, description, system_prompt, model_config,
                          tags, changelog, published_at, created_at, updated_at
                        )
                        VALUES (?, ?, '1.0.0', ?, ?, ?, ?, ?, NULL, ?, ?, ?);
                        "#,
                    )
                    .bind(&new_version_id)
                    .bind(assistant_id)
                    .bind(name)
                    .bind(description)
                    .bind(system_prompt)
                    .bind(model_config_json)
                    .bind(tags_json)
                    .bind(published_at)
                    .bind(created_at)
                    .bind(updated_at)
                    .execute(&self.pool)
                    .await
                    .map_err(|err| McpError::Storage(err.to_string()))?;
                    new_version_id
                }
            }
        } else {
            let existing_row = sqlx::query(
                r#"
                SELECT id
                FROM assistant_version
                WHERE assistant_id = ?
                ORDER BY created_at DESC, id DESC
                LIMIT 1;
                "#,
            )
            .bind(assistant_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            if let Some(row) = existing_row {
                row.try_get("id")?
            } else {
                let new_version_id = Uuid::new_v4().to_string();
                sqlx::query(
                    r#"
                    INSERT INTO assistant_version (
                      id, assistant_id, version, name, description, system_prompt, model_config,
                      tags, changelog, published_at, created_at, updated_at
                    )
                    VALUES (?, ?, '1.0.0', ?, ?, ?, ?, ?, NULL, ?, ?, ?);
                    "#,
                )
                .bind(&new_version_id)
                .bind(assistant_id)
                .bind(name)
                .bind(description)
                .bind(system_prompt)
                .bind(model_config_json)
                .bind(tags_json)
                .bind(published_at)
                .bind(created_at)
                .bind(updated_at)
                .execute(&self.pool)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;
                new_version_id
            }
        };

        sqlx::query(
            r#"
            UPDATE assistant_version
            SET name = ?, description = ?, system_prompt = ?, model_config = ?,
                tags = ?, updated_at = ?, published_at = COALESCE(?, published_at)
            WHERE id = ?;
            "#,
        )
        .bind(name)
        .bind(description)
        .bind(system_prompt)
        .bind(model_config_json)
        .bind(tags_json)
        .bind(updated_at)
        .bind(published_at)
        .bind(&selected_version_id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            UPDATE assistant
            SET current_version_id = ?, updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(&selected_version_id)
        .bind(updated_at)
        .bind(assistant_id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        self.sync_local_assistant_tags(assistant_id, tags_json, updated_at)
            .await?;

        Ok(selected_version_id)
    }

    async fn ensure_column(&self, table: &str, column: &str, ddl: &str) -> Result<(), McpError> {
        let sql = format!("PRAGMA table_info({})", table);
        let rows = sqlx::query(&sql)
            .fetch_all(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        let exists = rows.iter().any(|row: &SqliteRow| {
            row.try_get::<String, _>("name")
                .map(|name| name == column)
                .unwrap_or(false)
        });
        if !exists {
            sqlx::query(ddl)
                .execute(&self.pool)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;
        }
        Ok(())
    }

    async fn migrate_assistant_version_drop_skill_refs(&self) -> Result<(), McpError> {
        let rows = sqlx::query("PRAGMA table_info(assistant_version)")
            .fetch_all(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        let has_skill_refs = rows.iter().any(|row: &SqliteRow| {
            row.try_get::<String, _>("name")
                .map(|name| name == "skill_refs")
                .unwrap_or(false)
        });
        if !has_skill_refs {
            return Ok(());
        }

        sqlx::query("PRAGMA foreign_keys=OFF;")
            .execute(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

        let result = async {
            let mut tx = self.pool.begin().await?;
            sqlx::query("ALTER TABLE assistant_version RENAME TO assistant_version_legacy;")
                .execute(&mut *tx)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;

            sqlx::query(
                r#"
                CREATE TABLE assistant_version (
                  id TEXT PRIMARY KEY,
                  assistant_id TEXT NOT NULL REFERENCES assistant(id) ON DELETE CASCADE,
                  version TEXT NOT NULL,
                  name TEXT NOT NULL,
                  description TEXT,
                  system_prompt TEXT NOT NULL,
                  model_config TEXT,
                  tags TEXT,
                  changelog TEXT,
                  published_at TEXT,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );
                "#,
            )
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            sqlx::query(
                r#"
                INSERT INTO assistant_version (
                  id, assistant_id, version, name, description, system_prompt,
                  model_config, tags, changelog, published_at, created_at, updated_at
                )
                SELECT id, assistant_id, version, name, description, system_prompt,
                       model_config, tags, changelog, published_at, created_at, updated_at
                FROM assistant_version_legacy;
                "#,
            )
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            sqlx::query("DROP TABLE assistant_version_legacy;")
                .execute(&mut *tx)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;

            sqlx::query(
                r#"
                CREATE UNIQUE INDEX IF NOT EXISTS uq_assistant_version_semver
                ON assistant_version(assistant_id, version);
                "#,
            )
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            sqlx::query(
                r#"
                CREATE INDEX IF NOT EXISTS idx_assistant_version_assistant
                ON assistant_version(assistant_id);
                "#,
            )
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            tx.commit().await.map_err(|err| McpError::Storage(err.to_string()))
        }
        .await;

        sqlx::query("PRAGMA foreign_keys=ON;")
            .execute(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

        result
    }
}
