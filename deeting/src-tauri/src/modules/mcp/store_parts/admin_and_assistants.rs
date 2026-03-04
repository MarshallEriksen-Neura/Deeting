impl McpStore {
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


}
