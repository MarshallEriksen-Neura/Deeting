use super::helpers::*;
use super::*;
use serde_json::Value;

impl McpStore {
    pub async fn finalize_local_compare_winner(
        &self,
        request: LocalConversationCompareFinalizeRequest,
    ) -> Result<LocalConversationCompareFinalizeResponse, McpError> {
        let session_id = request.session_id.trim().to_string();
        if session_id.is_empty() {
            return Err(McpError::Validation("session_id is required".to_string()));
        }

        let model_id = request.model_id.trim().to_string();
        if model_id.is_empty() {
            return Err(McpError::Validation("model_id is required".to_string()));
        }

        let content = request.content.trim().to_string();
        let blocks = request.blocks.unwrap_or_default();
        if content.is_empty() && blocks.is_empty() {
            return Err(McpError::Validation(
                "content or blocks is required".to_string(),
            ));
        }

        let provider_model_id = request
            .provider_model_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned);

        let regenerate_context = self
            .prepare_local_conversation_regenerate(&session_id)
            .await?;
        let replaced_turn_index = regenerate_context.deleted_turn_index.ok_or_else(|| {
            McpError::Validation("latest assistant message not found".to_string())
        })?;

        self.update_local_conversation_model_context(
            &session_id,
            Some(model_id.as_str()),
            provider_model_id.as_deref(),
        )
        .await?;

        let mut meta = serde_json::Map::new();
        meta.insert("model_id".to_string(), Value::String(model_id));
        if let Some(provider_model_id) = provider_model_id.clone() {
            meta.insert(
                "provider_model_id".to_string(),
                Value::String(provider_model_id),
            );
        }
        if !blocks.is_empty() {
            meta.insert("blocks".to_string(), Value::Array(blocks));
        }
        meta.insert("compare_winner".to_string(), Value::Bool(true));

        let message = self
            .append_local_conversation_message(CreateConversationMessageRequest {
                session_id: session_id.clone(),
                role: "assistant".to_string(),
                content,
                name: None,
                meta_info: Some(Value::Object(meta)),
                is_truncated: Some(false),
                parent_message_id: None,
            })
            .await?;

        Ok(LocalConversationCompareFinalizeResponse {
            session_id,
            replaced_turn_index,
            message,
        })
    }

    pub async fn list_local_admin_conversations(
        &self,
        query: LocalAdminConversationQuery,
    ) -> Result<LocalAdminConversationListResponse, McpError> {
        let skip = query.skip.unwrap_or(0).max(0);
        let limit = query.limit.unwrap_or(100).clamp(1, 1000);
        let status = query.status.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let channel = query.channel.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let user_id = query.user_id.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let assistant_id = query.assistant_id.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let start_time = query.start_time.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let end_time = query.end_time.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });

        let total_row = sqlx::query(
            r#"
            SELECT COUNT(*) AS total
            FROM conversation_session
            WHERE (? IS NULL OR status = ?)
              AND (? IS NULL OR channel = ?)
              AND (? IS NULL OR user_id = ?)
              AND (? IS NULL OR assistant_id = ?)
              AND (? IS NULL OR last_active_at >= ?)
              AND (? IS NULL OR last_active_at <= ?);
            "#,
        )
        .bind(status.as_deref())
        .bind(status.as_deref())
        .bind(channel.as_deref())
        .bind(channel.as_deref())
        .bind(user_id.as_deref())
        .bind(user_id.as_deref())
        .bind(assistant_id.as_deref())
        .bind(assistant_id.as_deref())
        .bind(start_time.as_deref())
        .bind(start_time.as_deref())
        .bind(end_time.as_deref())
        .bind(end_time.as_deref())
        .fetch_one(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let total: i64 = total_row.try_get("total")?;

        let rows = sqlx::query(
            r#"
            SELECT
              id, title, user_id, assistant_id, channel, status,
              message_count, first_message_at, last_active_at, last_summary_version,
              created_at, updated_at
            FROM conversation_session
            WHERE (? IS NULL OR status = ?)
              AND (? IS NULL OR channel = ?)
              AND (? IS NULL OR user_id = ?)
              AND (? IS NULL OR assistant_id = ?)
              AND (? IS NULL OR last_active_at >= ?)
              AND (? IS NULL OR last_active_at <= ?)
            ORDER BY last_active_at DESC, id DESC
            LIMIT ? OFFSET ?;
            "#,
        )
        .bind(status.as_deref())
        .bind(status.as_deref())
        .bind(channel.as_deref())
        .bind(channel.as_deref())
        .bind(user_id.as_deref())
        .bind(user_id.as_deref())
        .bind(assistant_id.as_deref())
        .bind(assistant_id.as_deref())
        .bind(start_time.as_deref())
        .bind(start_time.as_deref())
        .bind(end_time.as_deref())
        .bind(end_time.as_deref())
        .bind(limit)
        .bind(skip)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            items.push(LocalAdminConversationItem {
                id: row.try_get("id")?,
                title: row.try_get("title")?,
                user_id: row.try_get("user_id")?,
                assistant_id: row.try_get("assistant_id")?,
                channel: row.try_get::<String, _>("channel")?,
                status: row.try_get::<String, _>("status")?,
                message_count: row.try_get::<i64, _>("message_count").unwrap_or(0),
                first_message_at: row.try_get("first_message_at")?,
                last_active_at: row.try_get("last_active_at")?,
                last_summary_version: row.try_get::<i64, _>("last_summary_version").unwrap_or(0),
                created_at: row.try_get("created_at")?,
                updated_at: row.try_get("updated_at")?,
            });
        }

        Ok(LocalAdminConversationListResponse {
            total,
            skip,
            limit,
            items,
        })
    }

    pub async fn get_local_admin_conversation(
        &self,
        session_id: &str,
    ) -> Result<LocalAdminConversationItem, McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }

        let row = sqlx::query(
            r#"
            SELECT
              id, title, user_id, assistant_id, channel, status,
              message_count, first_message_at, last_active_at, last_summary_version,
              created_at, updated_at
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

        Ok(LocalAdminConversationItem {
            id: row.try_get("id")?,
            title: row.try_get("title")?,
            user_id: row.try_get("user_id")?,
            assistant_id: row.try_get("assistant_id")?,
            channel: row.try_get::<String, _>("channel")?,
            status: row.try_get::<String, _>("status")?,
            message_count: row.try_get::<i64, _>("message_count").unwrap_or(0),
            first_message_at: row.try_get("first_message_at")?,
            last_active_at: row.try_get("last_active_at")?,
            last_summary_version: row.try_get::<i64, _>("last_summary_version").unwrap_or(0),
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
        })
    }

    pub async fn list_local_admin_conversation_messages(
        &self,
        session_id: &str,
        query: LocalAdminConversationMessageQuery,
    ) -> Result<LocalAdminConversationMessageListResponse, McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }
        let skip = query.skip.unwrap_or(0).max(0);
        let limit = query.limit.unwrap_or(50).clamp(1, 200);
        let include_deleted = query.include_deleted.unwrap_or(true);
        let include_deleted_flag = if include_deleted { 1_i64 } else { 0_i64 };

        let session_exists = sqlx::query(
            r#"
            SELECT id
            FROM conversation_session
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_session_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        if session_exists.is_none() {
            return Err(McpError::NotFound(
                "conversation session not found".to_string(),
            ));
        }

        let total_row = sqlx::query(
            r#"
            SELECT COUNT(*) AS total
            FROM conversation_message
            WHERE session_id = ?
              AND (? = 1 OR is_deleted = 0);
            "#,
        )
        .bind(&normalized_session_id)
        .bind(include_deleted_flag)
        .fetch_one(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let total: i64 = total_row.try_get("total")?;

        let rows = sqlx::query(
            r#"
            SELECT
              id, session_id, turn_index, role, content, name, token_estimate, meta_info,
              used_persona_id, is_deleted, parent_message_id, created_at, updated_at
            FROM conversation_message
            WHERE session_id = ?
              AND (? = 1 OR is_deleted = 0)
            ORDER BY turn_index ASC
            LIMIT ? OFFSET ?;
            "#,
        )
        .bind(&normalized_session_id)
        .bind(include_deleted_flag)
        .bind(limit)
        .bind(skip)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            let meta_info_text: Option<String> = row.try_get("meta_info")?;
            items.push(LocalAdminConversationMessageItem {
                id: row.try_get("id")?,
                session_id: row.try_get("session_id")?,
                turn_index: row.try_get("turn_index")?,
                role: row.try_get("role")?,
                content: row.try_get("content")?,
                name: row.try_get("name")?,
                token_estimate: row.try_get::<i64, _>("token_estimate").unwrap_or(0),
                meta_info: match meta_info_text {
                    Some(text) if !text.trim().is_empty() => serde_json::from_str(&text).ok(),
                    _ => None,
                },
                used_persona_id: row.try_get("used_persona_id")?,
                is_deleted: row.try_get::<i64, _>("is_deleted").unwrap_or(0) != 0,
                parent_message_id: row.try_get("parent_message_id")?,
                created_at: row.try_get("created_at")?,
                updated_at: row.try_get("updated_at")?,
            });
        }

        Ok(LocalAdminConversationMessageListResponse {
            total,
            skip,
            limit,
            items,
        })
    }

    pub async fn list_local_admin_conversation_summaries(
        &self,
        session_id: &str,
    ) -> Result<LocalAdminConversationSummaryListResponse, McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }

        let session_exists = sqlx::query(
            r#"
            SELECT id
            FROM conversation_session
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_session_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        if session_exists.is_none() {
            return Err(McpError::NotFound(
                "conversation session not found".to_string(),
            ));
        }

        let rows = sqlx::query(
            r#"
            SELECT
              id, session_id, version, summary_text, covered_from_turn, covered_to_turn,
              token_estimate, summarizer_model, created_at, updated_at
            FROM conversation_summary
            WHERE session_id = ?
            ORDER BY version DESC;
            "#,
        )
        .bind(&normalized_session_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            items.push(LocalAdminConversationSummaryItem {
                id: row.try_get("id")?,
                session_id: row.try_get("session_id")?,
                version: row.try_get("version")?,
                summary_text: row.try_get("summary_text")?,
                covered_from_turn: row.try_get("covered_from_turn")?,
                covered_to_turn: row.try_get("covered_to_turn")?,
                token_estimate: row.try_get::<i64, _>("token_estimate").unwrap_or(0),
                summarizer_model: row.try_get("summarizer_model")?,
                created_at: row.try_get("created_at")?,
                updated_at: row.try_get("updated_at")?,
            });
        }

        Ok(LocalAdminConversationSummaryListResponse { items })
    }

    pub async fn list_local_conversation_summary_jobs(
        &self,
        query: LocalConversationSummaryJobQuery,
    ) -> Result<LocalConversationSummaryJobListResponse, McpError> {
        let skip = query.skip.unwrap_or(0).max(0);
        let limit = query.limit.unwrap_or(100).clamp(1, 1000);
        let status = query.status.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let session_id = query.session_id.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let error_contains = query.error_contains.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let error_like = error_contains
            .as_ref()
            .map(|value| format!("%{}%", value.replace('%', "\\%").replace('_', "\\_")));

        let total_row = sqlx::query(
            r#"
            SELECT COUNT(*) AS total
            FROM conversation_summary_job
            WHERE (? IS NULL OR status = ?)
              AND (? IS NULL OR session_id = ?)
              AND (? IS NULL OR (last_error IS NOT NULL AND last_error LIKE ? ESCAPE '\'));
            "#,
        )
        .bind(status.as_deref())
        .bind(status.as_deref())
        .bind(session_id.as_deref())
        .bind(session_id.as_deref())
        .bind(error_like.as_deref())
        .bind(error_like.as_deref())
        .fetch_one(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let total: i64 = total_row.try_get("total")?;

        let rows = sqlx::query(
            r#"
            SELECT
              id, session_id, status, trigger_source, attempts, max_attempts,
              available_after_epoch, last_error, created_at, updated_at
            FROM conversation_summary_job
            WHERE (? IS NULL OR status = ?)
              AND (? IS NULL OR session_id = ?)
              AND (? IS NULL OR (last_error IS NOT NULL AND last_error LIKE ? ESCAPE '\'))
            ORDER BY updated_at DESC, id DESC
            LIMIT ? OFFSET ?;
            "#,
        )
        .bind(status.as_deref())
        .bind(status.as_deref())
        .bind(session_id.as_deref())
        .bind(session_id.as_deref())
        .bind(error_like.as_deref())
        .bind(error_like.as_deref())
        .bind(limit)
        .bind(skip)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            items.push(LocalConversationSummaryJobItem {
                id: row.try_get("id")?,
                session_id: row.try_get("session_id")?,
                status: row.try_get("status")?,
                trigger_source: row.try_get("trigger_source")?,
                attempts: row.try_get::<i64, _>("attempts").unwrap_or(0),
                max_attempts: row
                    .try_get::<i64, _>("max_attempts")
                    .unwrap_or(CONVERSATION_SUMMARY_JOB_MAX_ATTEMPTS),
                available_after_epoch: row.try_get::<i64, _>("available_after_epoch").unwrap_or(0),
                last_error: row.try_get("last_error")?,
                created_at: row.try_get("created_at")?,
                updated_at: row.try_get("updated_at")?,
            });
        }

        Ok(LocalConversationSummaryJobListResponse {
            total,
            skip,
            limit,
            items,
        })
    }

    pub async fn list_local_conversation_summary_idle_tasks(
        &self,
        query: LocalConversationSummaryIdleTaskQuery,
    ) -> Result<LocalConversationSummaryIdleTaskListResponse, McpError> {
        let skip = query.skip.unwrap_or(0).max(0);
        let limit = query.limit.unwrap_or(100).clamp(1, 1000);
        let session_id = query.session_id.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let now_epoch = now_unix_epoch()?;

        let total_row = sqlx::query(
            r#"
            SELECT COUNT(*) AS total
            FROM conversation_summary_idle_task
            WHERE (? IS NULL OR session_id = ?);
            "#,
        )
        .bind(session_id.as_deref())
        .bind(session_id.as_deref())
        .fetch_one(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let total: i64 = total_row.try_get("total")?;

        let rows = sqlx::query(
            r#"
            SELECT
              session_id, last_active_epoch, run_after_epoch, created_at, updated_at
            FROM conversation_summary_idle_task
            WHERE (? IS NULL OR session_id = ?)
            ORDER BY run_after_epoch ASC, session_id ASC
            LIMIT ? OFFSET ?;
            "#,
        )
        .bind(session_id.as_deref())
        .bind(session_id.as_deref())
        .bind(limit)
        .bind(skip)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            let run_after_epoch = row.try_get::<i64, _>("run_after_epoch").unwrap_or(0);
            items.push(LocalConversationSummaryIdleTaskItem {
                session_id: row.try_get("session_id")?,
                last_active_epoch: row.try_get::<i64, _>("last_active_epoch").unwrap_or(0),
                run_after_epoch,
                is_due: run_after_epoch <= now_epoch,
                created_at: row.try_get("created_at")?,
                updated_at: row.try_get("updated_at")?,
            });
        }

        Ok(LocalConversationSummaryIdleTaskListResponse {
            total,
            skip,
            limit,
            items,
        })
    }

    pub async fn get_local_conversation_summary_queue_stats(
        &self,
    ) -> Result<LocalConversationSummaryQueueStats, McpError> {
        let now_epoch = now_unix_epoch()?;
        let job_row = sqlx::query(
            r#"
            SELECT
              SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS pending_jobs,
              SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS running_jobs,
              SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS completed_jobs,
              SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS failed_jobs
            FROM conversation_summary_job;
            "#,
        )
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_PENDING)
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_RUNNING)
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_COMPLETED)
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_FAILED)
        .fetch_one(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let pending_jobs = job_row
            .try_get::<Option<i64>, _>("pending_jobs")
            .ok()
            .flatten()
            .unwrap_or(0);
        let running_jobs = job_row
            .try_get::<Option<i64>, _>("running_jobs")
            .ok()
            .flatten()
            .unwrap_or(0);
        let completed_jobs = job_row
            .try_get::<Option<i64>, _>("completed_jobs")
            .ok()
            .flatten()
            .unwrap_or(0);
        let failed_jobs = job_row
            .try_get::<Option<i64>, _>("failed_jobs")
            .ok()
            .flatten()
            .unwrap_or(0);

        let idle_row = sqlx::query(
            r#"
            SELECT
              COUNT(*) AS idle_total_tasks,
              SUM(CASE WHEN run_after_epoch <= ? THEN 1 ELSE 0 END) AS idle_due_tasks
            FROM conversation_summary_idle_task;
            "#,
        )
        .bind(now_epoch)
        .fetch_one(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let idle_total_tasks = idle_row
            .try_get::<Option<i64>, _>("idle_total_tasks")
            .ok()
            .flatten()
            .unwrap_or(0);
        let idle_due_tasks = idle_row
            .try_get::<Option<i64>, _>("idle_due_tasks")
            .ok()
            .flatten()
            .unwrap_or(0);

        Ok(LocalConversationSummaryQueueStats {
            pending_jobs,
            running_jobs,
            completed_jobs,
            failed_jobs,
            idle_due_tasks,
            idle_total_tasks,
        })
    }

    pub async fn trigger_local_conversation_summary_job(
        &self,
        session_id: &str,
    ) -> Result<LocalConversationSummaryEnqueueResponse, McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }

        self.enqueue_local_conversation_summary_job(&normalized_session_id, "manual_trigger")
            .await?;

        Ok(LocalConversationSummaryEnqueueResponse {
            session_id: normalized_session_id,
            queued: true,
        })
    }

    pub async fn retry_local_conversation_summary_job(
        &self,
        job_id: &str,
    ) -> Result<LocalConversationSummaryEnqueueResponse, McpError> {
        let normalized_job_id = job_id.trim().to_string();
        if normalized_job_id.is_empty() {
            return Err(McpError::validation("job_id is required"));
        }

        let job_row = sqlx::query(
            r#"
            SELECT session_id, status
            FROM conversation_summary_job
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_job_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?
        .ok_or_else(|| McpError::NotFound("conversation summary job not found".to_string()))?;

        let session_id: String = job_row.try_get("session_id")?;
        let status: String = job_row.try_get("status")?;
        if status == CONVERSATION_SUMMARY_JOB_STATUS_RUNNING {
            return Err(McpError::validation(
                "conversation summary job is running and cannot be retried".to_string(),
            ));
        }

        self.enqueue_local_conversation_summary_job(&session_id, "manual_retry")
            .await?;

        Ok(LocalConversationSummaryEnqueueResponse {
            session_id,
            queued: true,
        })
    }

    pub async fn retry_local_conversation_summary_jobs(
        &self,
        payload: LocalConversationSummaryBatchRetryRequest,
    ) -> Result<LocalConversationSummaryBatchRetryResponse, McpError> {
        let limit = payload.limit.unwrap_or(200).clamp(1, 1000);
        let status = payload.status.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let session_id = payload.session_id.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let error_contains = payload.error_contains.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let error_like = error_contains
            .as_ref()
            .map(|value| format!("%{}%", value.replace('%', "\\%").replace('_', "\\_")));
        let default_status = CONVERSATION_SUMMARY_JOB_STATUS_FAILED;
        let status_filter = status.as_deref().unwrap_or(default_status);

        let rows = sqlx::query(
            r#"
            SELECT DISTINCT session_id
            FROM conversation_summary_job
            WHERE status = ?
              AND (? IS NULL OR session_id = ?)
              AND (? IS NULL OR (last_error IS NOT NULL AND last_error LIKE ? ESCAPE '\'))
            ORDER BY updated_at DESC, id DESC
            LIMIT ?;
            "#,
        )
        .bind(status_filter)
        .bind(session_id.as_deref())
        .bind(session_id.as_deref())
        .bind(error_like.as_deref())
        .bind(error_like.as_deref())
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let matched_count = i64::try_from(rows.len()).unwrap_or(i64::MAX);
        let mut queued_count = 0_i64;
        for row in rows {
            let target_session_id: String = row.try_get("session_id")?;
            self.enqueue_local_conversation_summary_job(&target_session_id, "manual_retry_batch")
                .await?;
            queued_count = queued_count.saturating_add(1);
        }

        Ok(LocalConversationSummaryBatchRetryResponse {
            matched_count,
            queued_count,
        })
    }

    pub async fn get_local_trace_feedback_meta_by_trace_id(
        &self,
        trace_id: &str,
    ) -> Result<Option<serde_json::Value>, McpError> {
        let normalized_trace_id = trace_id.trim().to_string();
        if normalized_trace_id.is_empty() {
            return Err(McpError::validation("trace_id is required"));
        }

        let gateway_log_row = sqlx::query(
            r#"
            SELECT meta
            FROM gateway_log
            WHERE trace_id = ?
            ORDER BY created_at DESC
            LIMIT 1;
            "#,
        )
        .bind(&normalized_trace_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        if let Some(value) = gateway_log_row {
            let meta_text: Option<String> = value.try_get("meta")?;
            if let Some(text) = meta_text {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    if let Ok(meta) = serde_json::from_str::<serde_json::Value>(trimmed) {
                        return Ok(Some(meta));
                    }
                }
            }
        }

        let row = sqlx::query(
            r#"
            SELECT cm.meta_info
            FROM conversation_message cm
            WHERE cm.role = 'assistant'
              AND cm.meta_info IS NOT NULL
              AND json_extract(cm.meta_info, '$.trace_id') = ?
            ORDER BY cm.created_at DESC, cm.turn_index DESC
            LIMIT 1;
            "#,
        )
        .bind(&normalized_trace_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        match row {
            Some(value) => {
                let meta_info_text: Option<String> = value.try_get("meta_info")?;
                let meta_info = match meta_info_text {
                    Some(text) if !text.trim().is_empty() => serde_json::from_str(&text).ok(),
                    _ => None,
                };
                Ok(meta_info)
            }
            None => Ok(None),
        }
    }

    pub async fn get_local_assistant(&self, id: &str) -> Result<Option<LocalAssistant>, McpError> {
        let row = sqlx::query(
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
            WHERE a.id = ?
            LIMIT 1;
            "#,
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        match row {
            Some(row) => Ok(Some(row_to_assistant(&row)?)),
            None => Ok(None),
        }
    }

    pub async fn create_local_assistant(
        &self,
        payload: CreateLocalAssistantRequest,
    ) -> Result<String, McpError> {
        let name = payload.name.trim().to_string();
        if name.is_empty() {
            return Err(McpError::validation("assistant name is required"));
        }
        let system_prompt = payload.system_prompt.trim().to_string();
        if system_prompt.is_empty() {
            return Err(McpError::validation("system_prompt is required"));
        }

        let id = Uuid::new_v4().to_string();
        let now = now_rfc3339()?;
        let visibility = payload.visibility.unwrap_or_else(|| "private".to_string());
        let source = payload.source.unwrap_or_else(|| "local".to_string());
        let description = payload.description;
        let avatar = payload.avatar;
        let tags = payload.tags.unwrap_or_default();
        let tags_json = serialize_json(&Some(tags))?;
        let model_config_json = serialize_json(&payload.model_config)?;

        sqlx::query(
            r#"
            INSERT INTO assistants
              (id, name, description, avatar, system_prompt, model_config, tags, visibility, source,
               cloud_id, is_deleted, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            "#,
        )
        .bind(&id)
        .bind(&name)
        .bind(description.as_deref())
        .bind(avatar.as_deref())
        .bind(&system_prompt)
        .bind(model_config_json.as_deref())
        .bind(tags_json.as_deref())
        .bind(&visibility)
        .bind(&source)
        .bind(payload.cloud_id)
        .bind(0)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            INSERT OR REPLACE INTO assistant (
              id, owner_user_id, visibility, status, share_slug, summary, icon_id,
              install_count, rating_avg, rating_count, current_version_id, published_at, created_at, updated_at
            )
            VALUES (?, NULL, ?, 'published', NULL, ?, ?, 0, 0, 0, NULL, ?, ?, ?);
            "#,
        )
        .bind(&id)
        .bind(&visibility)
        .bind(description.as_deref())
        .bind(avatar.as_deref())
        .bind(&now)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        self.ensure_assistant_version_synced(
            &id,
            &name,
            description.as_deref(),
            &system_prompt,
            model_config_json.as_deref(),
            tags_json.as_deref(),
            Some(&now),
            &now,
            &now,
        )
        .await?;

        Ok(id)
    }

    pub async fn update_local_assistant(
        &self,
        id: &str,
        payload: UpdateLocalAssistantRequest,
    ) -> Result<LocalAssistant, McpError> {
        let existing = self
            .get_local_assistant(id)
            .await?
            .ok_or_else(|| McpError::NotFound("assistant not found".to_string()))?;

        if existing.is_deleted {
            return Err(McpError::validation("assistant already deleted"));
        }

        let LocalAssistant {
            name: existing_name,
            description: existing_description,
            avatar: existing_avatar,
            system_prompt: existing_system_prompt,
            model_config: existing_model_config,
            tags: existing_tags,
            visibility: existing_visibility,
            source: existing_source,
            cloud_id: existing_cloud_id,
            created_at: existing_created_at,
            ..
        } = existing;

        let name = payload.name.unwrap_or(existing_name);
        if name.trim().is_empty() {
            return Err(McpError::validation("assistant name is required"));
        }
        let system_prompt = payload.system_prompt.unwrap_or(existing_system_prompt);
        if system_prompt.trim().is_empty() {
            return Err(McpError::validation("system_prompt is required"));
        }

        let description = payload.description.or(existing_description);
        let avatar = payload.avatar.or(existing_avatar);
        let model_config = payload.model_config.or(existing_model_config);
        let tags = payload.tags.unwrap_or(existing_tags);
        let visibility = payload.visibility.unwrap_or(existing_visibility);
        let source = payload.source.unwrap_or(existing_source);
        let cloud_id = payload.cloud_id.or(existing_cloud_id);
        let now = now_rfc3339()?;

        let tags_json = serialize_json(&Some(tags))?;
        let model_config_json = serialize_json(&model_config)?;

        sqlx::query(
            r#"
            UPDATE assistants
            SET name = ?, description = ?, avatar = ?, system_prompt = ?, model_config = ?,
                tags = ?, visibility = ?, source = ?, cloud_id = ?, updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(&name)
        .bind(description.as_deref())
        .bind(avatar.as_deref())
        .bind(&system_prompt)
        .bind(model_config_json.as_deref())
        .bind(tags_json.as_deref())
        .bind(&visibility)
        .bind(&source)
        .bind(cloud_id.as_deref())
        .bind(&now)
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            UPDATE assistant
            SET visibility = ?, summary = ?, icon_id = ?, updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(&visibility)
        .bind(description.as_deref())
        .bind(avatar.as_deref())
        .bind(&now)
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        self.ensure_assistant_version_synced(
            id,
            &name,
            description.as_deref(),
            &system_prompt,
            model_config_json.as_deref(),
            tags_json.as_deref(),
            None,
            &existing_created_at,
            &now,
        )
        .await?;

        self.get_local_assistant(id)
            .await?
            .ok_or_else(|| McpError::NotFound("assistant missing after update".to_string()))
    }

    pub async fn delete_local_assistant(&self, id: &str) -> Result<(), McpError> {
        let now = now_rfc3339()?;
        let result = sqlx::query(
            r#"
            UPDATE assistants
            SET is_deleted = 1, updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(&now)
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            UPDATE assistant
            SET status = 'archived', published_at = NULL, updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(&now)
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if result.rows_affected() == 0 {
            return Err(McpError::NotFound("assistant not found".to_string()));
        }
        self.delete_assistant_messages(id).await?;
        Ok(())
    }

    pub async fn list_assistant_messages(
        &self,
        assistant_id: &str,
    ) -> Result<Vec<LocalAssistantMessage>, McpError> {
        let rows = sqlx::query(
            r#"
            SELECT id, assistant_id, role, content, is_deleted, created_at, updated_at
            FROM assistant_messages
            WHERE assistant_id = ? AND is_deleted = 0
            ORDER BY created_at ASC;
            "#,
        )
        .bind(assistant_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut messages = Vec::with_capacity(rows.len());
        for row in rows {
            messages.push(row_to_assistant_message(&row)?);
        }
        Ok(messages)
    }

    pub async fn append_assistant_message(
        &self,
        payload: CreateAssistantMessageRequest,
    ) -> Result<LocalAssistantMessage, McpError> {
        let role = payload.role.trim();
        if role.is_empty() {
            return Err(McpError::validation("role is required"));
        }
        let content = payload.content.trim().to_string();
        if content.is_empty() {
            return Err(McpError::validation("content is required"));
        }
        if payload.assistant_id.trim().is_empty() {
            return Err(McpError::validation("assistant_id is required"));
        }

        let id = Uuid::new_v4().to_string();
        let now = now_rfc3339()?;

        sqlx::query(
            r#"
            INSERT INTO assistant_messages
              (id, assistant_id, role, content, is_deleted, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?);
            "#,
        )
        .bind(&id)
        .bind(&payload.assistant_id)
        .bind(role)
        .bind(&content)
        .bind(0)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(LocalAssistantMessage {
            id,
            assistant_id: payload.assistant_id,
            role: role.to_string(),
            content,
            is_deleted: false,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub async fn delete_assistant_messages(&self, assistant_id: &str) -> Result<(), McpError> {
        let now = now_rfc3339()?;
        sqlx::query(
            r#"
            UPDATE assistant_messages
            SET is_deleted = 1, updated_at = ?
            WHERE assistant_id = ?;
            "#,
        )
        .bind(&now)
        .bind(assistant_id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(())
    }

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

    pub async fn update_local_conversation_title_if_empty(
        &self,
        session_id: &str,
        title: &str,
    ) -> Result<Option<String>, McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }

        let normalized_title = {
            let trimmed = title.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        };
        let Some(next_title) = normalized_title else {
            return Err(McpError::validation("title is required"));
        };

        let now = now_rfc3339()?;
        let result = sqlx::query(
            r#"
            UPDATE conversation_session
            SET title = ?, updated_at = ?
            WHERE id = ?
              AND (title IS NULL OR TRIM(title) = '');
            "#,
        )
        .bind(&next_title)
        .bind(&now)
        .bind(&normalized_session_id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if result.rows_affected() == 0 {
            return Ok(None);
        }

        Ok(Some(next_title))
    }

    pub async fn update_local_conversation_model_context(
        &self,
        session_id: &str,
        model_id: Option<&str>,
        provider_model_id: Option<&str>,
    ) -> Result<(), McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }

        let normalized_model_id = model_id.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let normalized_provider_model_id = provider_model_id.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let now = now_rfc3339()?;
        let result = sqlx::query(
            r#"
            UPDATE conversation_session
            SET last_model_id = ?,
                last_provider_model_id = ?,
                updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(&normalized_model_id)
        .bind(&normalized_provider_model_id)
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

    pub async fn get_local_conversation_title_context(
        &self,
        session_id: &str,
    ) -> Result<LocalConversationTitleContext, McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }

        let session_row = sqlx::query(
            r#"
            SELECT id, title, message_count
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

        let first_message_row = sqlx::query(
            r#"
            SELECT content
            FROM conversation_message
            WHERE session_id = ? AND is_deleted = 0 AND LOWER(role) = 'user'
            ORDER BY turn_index ASC
            LIMIT 1;
            "#,
        )
        .bind(&normalized_session_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(LocalConversationTitleContext {
            session_id: normalized_session_id,
            title: session_row.try_get("title")?,
            message_count: session_row.try_get::<i64, _>("message_count").unwrap_or(0),
            first_user_message: first_message_row.and_then(|row| {
                row.try_get::<Option<String>, _>("content")
                    .ok()
                    .flatten()
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty())
            }),
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
        let runtime_window = self
            .load_local_conversation_runtime_window(session_id)
            .await?;
        let messages = runtime_window
            .messages
            .into_iter()
            .map(|message| {
                let content = message
                    .content
                    .as_ref()
                    .and_then(|value| {
                        if let Some(text) = value.as_str() {
                            Some(text.to_string())
                        } else {
                            serde_json::to_string(value).ok()
                        }
                    })
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty())
                    .unwrap_or_default();
                LocalChatInputMessage {
                    role: message.role,
                    content,
                }
            })
            .collect();

        Ok(LocalConversationChatContext {
            session_id: runtime_window.session_id,
            assistant_id: runtime_window.assistant_id,
            messages,
        })
    }

    pub async fn load_local_conversation_runtime_window(
        &self,
        session_id: &str,
    ) -> Result<LocalConversationRuntimeWindow, McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }

        let session_row = sqlx::query(
            r#"
            SELECT
              assistant_id, title, status, message_count, total_tokens, last_summary_version,
              summarizing, summary_job_id, last_summary_generated_at,
              last_model_id, last_provider_model_id,
              first_message_at, last_active_at, created_at, updated_at
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
            SELECT role, content, turn_index, created_at, is_truncated, name, meta_info
            FROM (
              SELECT role, content, turn_index, created_at, is_truncated, name, meta_info
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
            "last_model_id": session_row.try_get::<Option<String>, _>("last_model_id").ok().flatten(),
            "last_provider_model_id": session_row.try_get::<Option<String>, _>("last_provider_model_id").ok().flatten(),
            "first_message_at": session_row.try_get::<Option<String>, _>("first_message_at").ok().flatten(),
            "last_active_at": session_row.try_get::<Option<String>, _>("last_active_at").ok().flatten(),
            "created_at": session_row.try_get::<Option<String>, _>("created_at").ok().flatten(),
            "updated_at": session_row.try_get::<Option<String>, _>("updated_at").ok().flatten(),
        }));

        Ok(LocalConversationRuntimeWindow {
            session_id: normalized_session_id,
            assistant_id,
            messages,
            meta,
            summary,
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
        if let Err(err) = self
            .touch_local_conversation_summary_idle_task(&session_id)
            .await
        {
            log::warn!(
                "touch_local_conversation_summary_idle_task failed session={} err={}",
                session_id,
                err
            );
        }
        if let Err(err) = self
            .try_trigger_local_conversation_summary_flush(&session_id, "message_append")
            .await
        {
            log::warn!(
                "try_trigger_local_conversation_summary_flush failed session={} err={}",
                session_id,
                err
            );
        }

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
              last_model_id, last_provider_model_id,
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
            "last_model_id": session_row.try_get::<Option<String>, _>("last_model_id").ok().flatten(),
            "last_provider_model_id": session_row.try_get::<Option<String>, _>("last_provider_model_id").ok().flatten(),
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

    pub(super) async fn migrate_assistant_versions_from_legacy(&self) -> Result<(), McpError> {
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

    pub(super) async fn migrate_assistant_installs_from_assistant(&self) -> Result<(), McpError> {
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

    pub(super) async fn refresh_assistant_install_count(
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

    pub(super) async fn sync_local_assistant_tags(
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

    pub(super) async fn refresh_assistant_rating(
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

    pub(super) async fn get_local_assistant_install_item(
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

    pub(super) async fn ensure_column(
        &self,
        table: &str,
        column: &str,
        ddl: &str,
    ) -> Result<(), McpError> {
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

    pub(super) async fn migrate_assistant_version_drop_skill_refs(&self) -> Result<(), McpError> {
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
            sqlx::query(
                r#"
                DROP TABLE IF EXISTS assistant_version_new;
                "#,
            )
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            sqlx::query(
                r#"
                CREATE TABLE assistant_version_new (
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
                INSERT INTO assistant_version_new (
                  id, assistant_id, version, name, description, system_prompt,
                  model_config, tags, changelog, published_at, created_at, updated_at
                )
                SELECT id, assistant_id, version, name, description, system_prompt,
                       model_config, tags, changelog, published_at, created_at, updated_at
                FROM assistant_version;
                "#,
            )
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            sqlx::query("DROP TABLE assistant_version;")
                .execute(&mut *tx)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;

            sqlx::query("ALTER TABLE assistant_version_new RENAME TO assistant_version;")
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

            tx.commit()
                .await
                .map_err(|err| McpError::Storage(err.to_string()))
        }
        .await;

        sqlx::query("PRAGMA foreign_keys=ON;")
            .execute(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

        result
    }

    pub(super) async fn repair_assistant_install_foreign_key_target(&self) -> Result<(), McpError> {
        let rows = sqlx::query("PRAGMA foreign_key_list(assistant_install)")
            .fetch_all(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        let references_legacy = rows.iter().any(|row: &SqliteRow| {
            row.try_get::<String, _>("table")
                .map(|name| name == "assistant_version_legacy")
                .unwrap_or(false)
        });
        if !references_legacy {
            return Ok(());
        }

        sqlx::query("PRAGMA foreign_keys=OFF;")
            .execute(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

        let result = async {
            let mut tx = self.pool.begin().await?;
            sqlx::query(
                r#"
                DROP TABLE IF EXISTS assistant_install_new;
                "#,
            )
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            sqlx::query(
                r#"
                CREATE TABLE assistant_install_new (
                  id TEXT PRIMARY KEY,
                  user_id TEXT NOT NULL,
                  assistant_id TEXT NOT NULL REFERENCES assistant(id) ON DELETE CASCADE,
                  alias TEXT,
                  icon_override TEXT,
                  pinned_version_id TEXT REFERENCES assistant_version(id) ON DELETE SET NULL,
                  follow_latest INTEGER NOT NULL DEFAULT 1,
                  is_enabled INTEGER NOT NULL DEFAULT 1,
                  sort_order INTEGER NOT NULL DEFAULT 0,
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
                INSERT INTO assistant_install_new (
                  id, user_id, assistant_id, alias, icon_override, pinned_version_id,
                  follow_latest, is_enabled, sort_order, created_at, updated_at
                )
                SELECT id, user_id, assistant_id, alias, icon_override, pinned_version_id,
                       follow_latest, is_enabled, sort_order, created_at, updated_at
                FROM assistant_install;
                "#,
            )
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            sqlx::query("DROP TABLE assistant_install;")
                .execute(&mut *tx)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;

            sqlx::query("ALTER TABLE assistant_install_new RENAME TO assistant_install;")
                .execute(&mut *tx)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;

            sqlx::query(
                r#"
                UPDATE assistant_install
                SET pinned_version_id = NULL
                WHERE pinned_version_id IS NOT NULL
                  AND NOT EXISTS (
                    SELECT 1
                    FROM assistant_version
                    WHERE assistant_version.id = assistant_install.pinned_version_id
                  );
                "#,
            )
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            sqlx::query(
                r#"
                CREATE UNIQUE INDEX IF NOT EXISTS uq_assistant_install_user_assistant
                ON assistant_install(user_id, assistant_id);
                "#,
            )
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            sqlx::query(
                r#"
                CREATE INDEX IF NOT EXISTS idx_assistant_install_user
                ON assistant_install(user_id);
                "#,
            )
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            sqlx::query(
                r#"
                CREATE INDEX IF NOT EXISTS idx_assistant_install_assistant
                ON assistant_install(assistant_id);
                "#,
            )
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            tx.commit()
                .await
                .map_err(|err| McpError::Storage(err.to_string()))
        }
        .await;

        sqlx::query("PRAGMA foreign_keys=ON;")
            .execute(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

        result
    }
}
