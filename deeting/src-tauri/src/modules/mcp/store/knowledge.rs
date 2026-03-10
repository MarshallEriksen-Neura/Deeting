use super::helpers::*;
use super::*;

impl McpStore {
    pub async fn get_local_knowledge_tree(
        &self,
        query: LocalKnowledgeTreeQuery,
    ) -> Result<LocalKnowledgeTreeResponse, McpError> {
        let parent_id = query.parent_id.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let keyword = query.q.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let sort_field = query
            .sort_field
            .unwrap_or_else(|| "created_at".to_string())
            .trim()
            .to_string();
        let sort_direction = query
            .sort_direction
            .unwrap_or_else(|| "desc".to_string())
            .trim()
            .to_ascii_lowercase();
        let keyword_like = keyword
            .as_ref()
            .map(|value| format!("%{}%", value.replace('%', "\\%").replace('_', "\\_")));

        if let Some(parent) = parent_id.as_deref() {
            let parent_row = sqlx::query(
                r#"
                SELECT id
                FROM knowledge_folder
                WHERE id = ? AND user_id = ?
                LIMIT 1;
                "#,
            )
            .bind(parent)
            .bind(LOCAL_DESKTOP_USER_ID)
            .fetch_optional(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            if parent_row.is_none() {
                return Err(McpError::NotFound("knowledge folder not found".to_string()));
            }
        }

        let folder_rows = sqlx::query(
            r#"
            SELECT
              f.id, f.name, f.parent_id, f.created_at, f.updated_at,
              COALESCE(fc.file_count, 0) AS file_count
            FROM knowledge_folder f
            LEFT JOIN (
              SELECT folder_id, COUNT(*) AS file_count
              FROM user_document
              WHERE user_id = ?
              GROUP BY folder_id
            ) fc ON fc.folder_id = f.id
            WHERE f.user_id = ?
              AND ((? IS NULL AND f.parent_id IS NULL) OR f.parent_id = ?)
              AND (? IS NULL OR f.name LIKE ? ESCAPE '\')
            ORDER BY f.created_at DESC, f.id DESC;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(parent_id.as_deref())
        .bind(parent_id.as_deref())
        .bind(keyword_like.as_deref())
        .bind(keyword_like.as_deref())
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let file_rows = sqlx::query(
            r#"
            SELECT
              id, filename, folder_id, status, error_message, chunk_count,
              meta_info, created_at, updated_at
            FROM user_document
            WHERE user_id = ?
              AND ((? IS NULL AND folder_id IS NULL) OR folder_id = ?)
              AND (? IS NULL OR filename LIKE ? ESCAPE '\')
            ORDER BY created_at DESC, id DESC;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(parent_id.as_deref())
        .bind(parent_id.as_deref())
        .bind(keyword_like.as_deref())
        .bind(keyword_like.as_deref())
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut folders = Vec::with_capacity(folder_rows.len());
        for row in folder_rows {
            folders.push(LocalKnowledgeFolder {
                id: row.try_get("id")?,
                name: row.try_get("name")?,
                parent_id: row.try_get("parent_id")?,
                file_count: row.try_get::<i64, _>("file_count").unwrap_or(0),
                created_at: row.try_get("created_at")?,
                updated_at: row.try_get("updated_at")?,
            });
        }

        let mut files = Vec::with_capacity(file_rows.len());
        for row in file_rows {
            files.push(row_to_local_knowledge_file(&row)?);
        }

        sort_local_knowledge_folders(&mut folders, &sort_field, &sort_direction);
        sort_local_knowledge_files(&mut files, &sort_field, &sort_direction);

        let mut breadcrumb = vec![LocalKnowledgeBreadcrumbItem {
            id: None,
            name: "All Files".to_string(),
        }];
        if let Some(current_parent_id) = parent_id {
            let mut chain = Vec::new();
            let mut cursor = Some(current_parent_id);
            while let Some(folder_id) = cursor {
                let row = sqlx::query(
                    r#"
                    SELECT id, name, parent_id
                    FROM knowledge_folder
                    WHERE id = ? AND user_id = ?
                    LIMIT 1;
                    "#,
                )
                .bind(&folder_id)
                .bind(LOCAL_DESKTOP_USER_ID)
                .fetch_optional(&self.pool)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;
                let Some(row) = row else {
                    break;
                };
                let id: String = row.try_get("id")?;
                chain.push(LocalKnowledgeBreadcrumbItem {
                    id: Some(id),
                    name: row.try_get("name")?,
                });
                cursor = row.try_get("parent_id")?;
            }
            chain.reverse();
            breadcrumb.extend(chain);
        }

        Ok(LocalKnowledgeTreeResponse {
            folders,
            files,
            breadcrumb,
        })
    }

    pub async fn get_local_knowledge_stats(&self) -> Result<LocalKnowledgeStatsResponse, McpError> {
        let file_row = sqlx::query(
            r#"
            SELECT
              COUNT(*) AS total_files,
              COALESCE(SUM(chunk_count), 0) AS total_vectors,
              COALESCE(SUM(CAST(json_extract(meta_info, '$.size') AS INTEGER)), 0) AS used_bytes
            FROM user_document
            WHERE user_id = ?;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .fetch_one(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let folder_row = sqlx::query(
            r#"
            SELECT COUNT(*) AS total_folders
            FROM knowledge_folder
            WHERE user_id = ?;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .fetch_one(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let used_bytes = file_row.try_get::<i64, _>("used_bytes").unwrap_or(0).max(0);
        let total_vectors = file_row
            .try_get::<i64, _>("total_vectors")
            .unwrap_or(0)
            .max(0);
        let total_files = file_row
            .try_get::<i64, _>("total_files")
            .unwrap_or(0)
            .max(0);
        let total_folders = folder_row
            .try_get::<i64, _>("total_folders")
            .unwrap_or(0)
            .max(0);
        let total_bytes = used_bytes.max(LOCAL_KNOWLEDGE_TOTAL_BYTES);

        Ok(LocalKnowledgeStatsResponse {
            used_bytes,
            total_bytes,
            total_vectors,
            total_files,
            total_folders,
        })
    }

    pub async fn create_local_knowledge_folder(
        &self,
        payload: CreateLocalKnowledgeFolderRequest,
    ) -> Result<LocalKnowledgeFolder, McpError> {
        let name = payload.name.trim().to_string();
        if name.is_empty() {
            return Err(McpError::validation("folder name is required"));
        }
        let parent_id = payload.parent_id.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });

        if let Some(parent) = parent_id.as_deref() {
            let parent_row = sqlx::query(
                r#"
                SELECT id
                FROM knowledge_folder
                WHERE id = ? AND user_id = ?
                LIMIT 1;
                "#,
            )
            .bind(parent)
            .bind(LOCAL_DESKTOP_USER_ID)
            .fetch_optional(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            if parent_row.is_none() {
                return Err(McpError::NotFound("parent folder not found".to_string()));
            }
        }

        let id = Uuid::new_v4().to_string();
        let now = now_rfc3339()?;
        sqlx::query(
            r#"
            INSERT INTO knowledge_folder (id, user_id, parent_id, name, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?);
            "#,
        )
        .bind(&id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(parent_id.as_deref())
        .bind(name)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        self.get_local_knowledge_folder_by_id(&id).await
    }

    pub async fn update_local_knowledge_folder(
        &self,
        folder_id: &str,
        payload: UpdateLocalKnowledgeFolderRequest,
    ) -> Result<LocalKnowledgeFolder, McpError> {
        let normalized_id = folder_id.trim().to_string();
        if normalized_id.is_empty() {
            return Err(McpError::validation("folder_id is required"));
        }
        let name = payload.name.trim().to_string();
        if name.is_empty() {
            return Err(McpError::validation("folder name is required"));
        }

        let now = now_rfc3339()?;
        let result = sqlx::query(
            r#"
            UPDATE knowledge_folder
            SET name = ?, updated_at = ?
            WHERE id = ? AND user_id = ?;
            "#,
        )
        .bind(name)
        .bind(&now)
        .bind(&normalized_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        if result.rows_affected() == 0 {
            return Err(McpError::NotFound("knowledge folder not found".to_string()));
        }
        self.get_local_knowledge_folder_by_id(&normalized_id).await
    }

    pub async fn delete_local_knowledge_folder(
        &self,
        folder_id: &str,
        recursive: bool,
    ) -> Result<(), McpError> {
        let normalized_id = folder_id.trim().to_string();
        if normalized_id.is_empty() {
            return Err(McpError::validation("folder_id is required"));
        }

        let exists = sqlx::query(
            r#"
            SELECT id
            FROM knowledge_folder
            WHERE id = ? AND user_id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        if exists.is_none() {
            return Err(McpError::NotFound("knowledge folder not found".to_string()));
        }

        if !recursive {
            let child_row = sqlx::query(
                r#"
                SELECT COUNT(*) AS total
                FROM knowledge_folder
                WHERE user_id = ? AND parent_id = ?;
                "#,
            )
            .bind(LOCAL_DESKTOP_USER_ID)
            .bind(&normalized_id)
            .fetch_one(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            let child_count = child_row.try_get::<i64, _>("total").unwrap_or(0);
            if child_count > 0 {
                return Err(McpError::validation(
                    "folder has children; use recursive delete".to_string(),
                ));
            }

            let file_row = sqlx::query(
                r#"
                SELECT COUNT(*) AS total
                FROM user_document
                WHERE user_id = ? AND folder_id = ?;
                "#,
            )
            .bind(LOCAL_DESKTOP_USER_ID)
            .bind(&normalized_id)
            .fetch_one(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            let file_count = file_row.try_get::<i64, _>("total").unwrap_or(0);
            if file_count > 0 {
                return Err(McpError::validation(
                    "folder contains files; use recursive delete".to_string(),
                ));
            }

            sqlx::query(
                r#"
                DELETE FROM knowledge_folder
                WHERE id = ? AND user_id = ?;
                "#,
            )
            .bind(&normalized_id)
            .bind(LOCAL_DESKTOP_USER_ID)
            .execute(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            return Ok(());
        }

        sqlx::query(
            r#"
            DELETE FROM user_document
            WHERE user_id = ?
              AND folder_id IN (
                WITH RECURSIVE subtree(id) AS (
                  SELECT id FROM knowledge_folder WHERE id = ? AND user_id = ?
                  UNION ALL
                  SELECT f.id
                  FROM knowledge_folder f
                  INNER JOIN subtree s ON f.parent_id = s.id
                  WHERE f.user_id = ?
                )
                SELECT id FROM subtree
              );
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(&normalized_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(LOCAL_DESKTOP_USER_ID)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            DELETE FROM knowledge_folder
            WHERE id = ? AND user_id = ?;
            "#,
        )
        .bind(&normalized_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(())
    }

    pub async fn list_local_user_documents(
        &self,
        query: LocalUserDocumentListQuery,
    ) -> Result<Vec<LocalKnowledgeFile>, McpError> {
        let folder_id = query.folder_id.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let status = query.status.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let keyword = query.q.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let keyword_like = keyword
            .as_ref()
            .map(|value| format!("%{}%", value.replace('%', "\\%").replace('_', "\\_")));

        let rows = sqlx::query(
            r#"
            SELECT
              id, filename, folder_id, status, error_message, chunk_count,
              meta_info, created_at, updated_at
            FROM user_document
            WHERE user_id = ?
              AND ((? IS NULL AND folder_id IS NULL) OR folder_id = ?)
              AND (? IS NULL OR status = ?)
              AND (? IS NULL OR filename LIKE ? ESCAPE '\')
            ORDER BY created_at DESC, id DESC;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(folder_id.as_deref())
        .bind(folder_id.as_deref())
        .bind(status.as_deref())
        .bind(status.as_deref())
        .bind(keyword_like.as_deref())
        .bind(keyword_like.as_deref())
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut files = Vec::with_capacity(rows.len());
        for row in rows {
            files.push(row_to_local_knowledge_file(&row)?);
        }
        Ok(files)
    }

    pub async fn create_local_user_document(
        &self,
        payload: CreateLocalUserDocumentRequest,
    ) -> Result<LocalKnowledgeFile, McpError> {
        let filename = payload.filename.trim().to_string();
        if filename.is_empty() {
            return Err(McpError::validation("filename is required"));
        }
        let folder_id = payload.folder_id.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        if let Some(folder) = folder_id.as_deref() {
            let parent_row = sqlx::query(
                r#"
                SELECT id
                FROM knowledge_folder
                WHERE id = ? AND user_id = ?
                LIMIT 1;
                "#,
            )
            .bind(folder)
            .bind(LOCAL_DESKTOP_USER_ID)
            .fetch_optional(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            if parent_row.is_none() {
                return Err(McpError::NotFound("folder not found".to_string()));
            }
        }

        let status = normalize_storage_document_status(payload.status.as_deref());
        let media_asset_id = payload
            .media_asset_id
            .and_then(|value| {
                let trimmed = value.trim().to_string();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed)
                }
            })
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let chunk_count = payload.chunk_count.unwrap_or(0).max(0);
        let meta_info = payload.meta_info.unwrap_or_else(|| serde_json::json!({}));
        let meta_info_text = serde_json::to_string(&meta_info)?;
        let now = now_rfc3339()?;
        let id = Uuid::new_v4().to_string();

        sqlx::query(
            r#"
            INSERT INTO user_document (
              id, user_id, media_asset_id, filename, folder_id, status, error_message,
              chunk_count, embedding_model, meta_info, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            "#,
        )
        .bind(&id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(media_asset_id)
        .bind(filename)
        .bind(folder_id.as_deref())
        .bind(status)
        .bind(payload.error_message)
        .bind(chunk_count)
        .bind(payload.embedding_model)
        .bind(meta_info_text)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if let Err(err) = self
            .process_local_user_document_chunks_if_available(&id, &meta_info)
            .await
        {
            let _ = self
                .mark_local_user_document_failed(
                    &id,
                    &format!("local document processing failed: {}", err),
                )
                .await;
        }

        self.get_local_user_document(&id).await
    }

    pub async fn get_local_user_document(
        &self,
        file_id: &str,
    ) -> Result<LocalKnowledgeFile, McpError> {
        let normalized_id = file_id.trim().to_string();
        if normalized_id.is_empty() {
            return Err(McpError::validation("file_id is required"));
        }

        let row = sqlx::query(
            r#"
            SELECT
              id, filename, folder_id, status, error_message, chunk_count,
              meta_info, created_at, updated_at
            FROM user_document
            WHERE id = ? AND user_id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let Some(row) = row else {
            return Err(McpError::NotFound(
                "local user document not found".to_string(),
            ));
        };
        row_to_local_knowledge_file(&row)
    }

    pub async fn get_local_user_document_download_url(
        &self,
        file_id: &str,
    ) -> Result<String, McpError> {
        let normalized_id = file_id.trim().to_string();
        if normalized_id.is_empty() {
            return Err(McpError::validation("file_id is required"));
        }
        let row = sqlx::query(
            r#"
            SELECT meta_info
            FROM user_document
            WHERE id = ? AND user_id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?
        .ok_or_else(|| McpError::NotFound("user document not found".to_string()))?;

        let meta_info_text: String = row.try_get("meta_info")?;
        let meta_info = if meta_info_text.trim().is_empty() {
            serde_json::json!({})
        } else {
            serde_json::from_str::<serde_json::Value>(&meta_info_text)
                .unwrap_or_else(|_| serde_json::json!({}))
        };

        extract_local_document_download_url(&meta_info)
            .ok_or_else(|| McpError::NotFound("download url not available".to_string()))
    }

    pub async fn get_local_user_document_object_key(
        &self,
        file_id: &str,
    ) -> Result<Option<String>, McpError> {
        let normalized_id = file_id.trim().to_string();
        if normalized_id.is_empty() {
            return Err(McpError::validation("file_id is required"));
        }
        let row = sqlx::query(
            r#"
            SELECT meta_info
            FROM user_document
            WHERE id = ? AND user_id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?
        .ok_or_else(|| McpError::NotFound("user document not found".to_string()))?;

        let meta_info_text: String = row.try_get("meta_info")?;
        let meta_info = if meta_info_text.trim().is_empty() {
            serde_json::json!({})
        } else {
            serde_json::from_str::<serde_json::Value>(&meta_info_text)
                .unwrap_or_else(|_| serde_json::json!({}))
        };
        Ok(extract_local_document_object_key(&meta_info))
    }

    pub async fn update_local_user_document(
        &self,
        file_id: &str,
        payload: UpdateLocalUserDocumentRequest,
    ) -> Result<LocalKnowledgeFile, McpError> {
        let normalized_id = file_id.trim().to_string();
        if normalized_id.is_empty() {
            return Err(McpError::validation("file_id is required"));
        }

        let current_row = sqlx::query(
            r#"
            SELECT filename, folder_id
            FROM user_document
            WHERE id = ? AND user_id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let Some(current_row) = current_row else {
            return Err(McpError::NotFound(
                "local user document not found".to_string(),
            ));
        };

        let mut target_filename: String = current_row.try_get("filename")?;
        if let Some(name) = payload.name {
            let normalized_name = name.trim().to_string();
            if normalized_name.is_empty() {
                return Err(McpError::validation("file name is required"));
            }
            target_filename = normalized_name;
        }

        let mut target_folder_id: Option<String> = current_row.try_get("folder_id")?;
        let folder_id_provided = payload.folder_id_provided.unwrap_or(false);
        if folder_id_provided {
            let normalized_folder_id = payload.folder_id.and_then(|value| {
                let trimmed = value.trim().to_string();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed)
                }
            });
            if let Some(folder_id) = normalized_folder_id.as_deref() {
                let folder_row = sqlx::query(
                    r#"
                    SELECT id
                    FROM knowledge_folder
                    WHERE id = ? AND user_id = ?
                    LIMIT 1;
                    "#,
                )
                .bind(folder_id)
                .bind(LOCAL_DESKTOP_USER_ID)
                .fetch_optional(&self.pool)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;
                if folder_row.is_none() {
                    return Err(McpError::NotFound("folder not found".to_string()));
                }
            }
            target_folder_id = normalized_folder_id;
        }

        let now = now_rfc3339()?;
        sqlx::query(
            r#"
            UPDATE user_document
            SET filename = ?, folder_id = ?, updated_at = ?
            WHERE id = ? AND user_id = ?;
            "#,
        )
        .bind(target_filename)
        .bind(target_folder_id.as_deref())
        .bind(&now)
        .bind(&normalized_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        self.get_local_user_document(&normalized_id).await
    }

    pub async fn delete_local_user_document(&self, file_id: &str) -> Result<(), McpError> {
        let normalized_id = file_id.trim().to_string();
        if normalized_id.is_empty() {
            return Err(McpError::validation("file_id is required"));
        }

        sqlx::query(
            r#"
            DELETE FROM knowledge_chunk
            WHERE document_id = ? AND user_id = ?;
            "#,
        )
        .bind(&normalized_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let result = sqlx::query(
            r#"
            DELETE FROM user_document
            WHERE id = ? AND user_id = ?;
            "#,
        )
        .bind(&normalized_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        if result.rows_affected() == 0 {
            return Err(McpError::NotFound(
                "local user document not found".to_string(),
            ));
        }
        Ok(())
    }

    pub async fn retry_local_user_document(
        &self,
        file_id: &str,
    ) -> Result<LocalKnowledgeFile, McpError> {
        let normalized_id = file_id.trim().to_string();
        if normalized_id.is_empty() {
            return Err(McpError::validation("file_id is required"));
        }

        let now = now_rfc3339()?;
        let result = sqlx::query(
            r#"
            UPDATE user_document
            SET status = 'processing',
                error_message = NULL,
                chunk_count = 0,
                embedding_model = NULL,
                updated_at = ?
            WHERE id = ? AND user_id = ?;
            "#,
        )
        .bind(&now)
        .bind(&normalized_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        if result.rows_affected() == 0 {
            return Err(McpError::NotFound(
                "local user document not found".to_string(),
            ));
        }

        sqlx::query(
            r#"
            DELETE FROM knowledge_chunk
            WHERE document_id = ? AND user_id = ?;
            "#,
        )
        .bind(&normalized_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let meta_info_row = sqlx::query(
            r#"
            SELECT meta_info
            FROM user_document
            WHERE id = ? AND user_id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let meta_info = meta_info_row
            .and_then(|row| row.try_get::<String, _>("meta_info").ok())
            .filter(|raw| !raw.trim().is_empty())
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
            .unwrap_or_else(|| serde_json::json!({}));

        if let Err(err) = self
            .process_local_user_document_chunks_if_available(&normalized_id, &meta_info)
            .await
        {
            let _ = self
                .mark_local_user_document_failed(
                    &normalized_id,
                    &format!("local document retry failed: {}", err),
                )
                .await;
        }

        self.get_local_user_document(&normalized_id).await
    }

    pub async fn list_local_user_document_chunks(
        &self,
        file_id: &str,
        query: LocalUserDocumentChunkListQuery,
    ) -> Result<LocalKnowledgeChunkListResponse, McpError> {
        let normalized_id = file_id.trim().to_string();
        if normalized_id.is_empty() {
            return Err(McpError::validation("file_id is required"));
        }
        let offset = query.offset.unwrap_or(0).max(0);
        let limit = query.limit.unwrap_or(20).clamp(1, 100);

        let file_row = sqlx::query(
            r#"
            SELECT id, chunk_count
            FROM user_document
            WHERE id = ? AND user_id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let Some(file_row) = file_row else {
            return Err(McpError::NotFound(
                "local user document not found".to_string(),
            ));
        };
        let expected_count = file_row
            .try_get::<i64, _>("chunk_count")
            .unwrap_or(0)
            .max(0);

        let total_row = sqlx::query(
            r#"
            SELECT COUNT(*) AS total
            FROM knowledge_chunk
            WHERE user_id = ? AND document_id = ?;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(&normalized_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let stored_total = total_row.try_get::<i64, _>("total").unwrap_or(0).max(0);
        let total = stored_total.max(expected_count);

        let rows = sqlx::query(
            r#"
            SELECT id, document_id, chunk_index, text_content, token_count
            FROM knowledge_chunk
            WHERE user_id = ? AND document_id = ?
            ORDER BY chunk_index ASC, id ASC
            LIMIT ? OFFSET ?;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(&normalized_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            let content: String = row.try_get("text_content")?;
            let token_count = row
                .try_get::<i64, _>("token_count")
                .unwrap_or_else(|_| estimate_local_tokens(&content));
            items.push(LocalKnowledgeChunk {
                id: row.try_get("id")?,
                file_id: row.try_get("document_id")?,
                index: row.try_get::<i64, _>("chunk_index").unwrap_or(0).max(0),
                content,
                token_count: token_count.max(0),
            });
        }

        Ok(LocalKnowledgeChunkListResponse {
            items,
            total,
            offset,
            limit,
        })
    }

    pub async fn search_local_knowledge_chunks(
        &self,
        query: &str,
        limit: Option<i64>,
    ) -> Result<Vec<LocalKnowledgeSearchHit>, McpError> {
        let normalized_query = query.trim().to_string();
        if normalized_query.is_empty() {
            return Ok(Vec::new());
        }
        let normalized_limit = limit.unwrap_or(4).clamp(1, 20);
        let tokens = tokenize_local_search_query(&normalized_query);
        if tokens.is_empty() {
            return Ok(Vec::new());
        }

        let lowered_tokens: Vec<String> = tokens
            .iter()
            .map(|token| token.to_ascii_lowercase())
            .collect();
        let query_lower = normalized_query.to_ascii_lowercase();
        let mut where_predicate = String::new();
        for (index, _) in lowered_tokens.iter().enumerate() {
            if index > 0 {
                where_predicate.push_str(" OR ");
            }
            where_predicate.push_str("LOWER(kc.text_content) LIKE ? ESCAPE '\\'");
        }

        let sql = format!(
            r#"
            SELECT
              kc.id AS chunk_id,
              kc.document_id AS file_id,
              kc.chunk_index AS chunk_index,
              kc.text_content AS text_content,
              kc.token_count AS token_count,
              ud.filename AS file_name
            FROM knowledge_chunk kc
            INNER JOIN user_document ud
              ON ud.id = kc.document_id AND ud.user_id = kc.user_id
            WHERE kc.user_id = ?
              AND ud.status = 'indexed'
              AND ({where_predicate})
            ORDER BY kc.updated_at DESC, kc.chunk_index ASC
            LIMIT 300;
            "#
        );

        let mut query_builder = sqlx::query(&sql).bind(LOCAL_DESKTOP_USER_ID);
        for token in &lowered_tokens {
            query_builder = query_builder.bind(format!(
                "%{}%",
                token.replace('%', "\\%").replace('_', "\\_")
            ));
        }
        let rows = query_builder
            .fetch_all(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut scored_hits = Vec::new();
        for row in rows {
            let content: String = row.try_get("text_content")?;
            let content_lower = content.to_ascii_lowercase();
            let score =
                compute_local_knowledge_match_score(&query_lower, &lowered_tokens, &content_lower);
            if score <= 0.0 {
                continue;
            }
            scored_hits.push(LocalKnowledgeSearchHit {
                chunk_id: row.try_get("chunk_id")?,
                file_id: row.try_get("file_id")?,
                file_name: row.try_get("file_name")?,
                index: row.try_get::<i64, _>("chunk_index").unwrap_or(0).max(0),
                content,
                token_count: row.try_get::<i64, _>("token_count").unwrap_or(0).max(0),
                score,
            });
        }

        scored_hits.sort_by(|left, right| {
            right
                .score
                .partial_cmp(&left.score)
                .unwrap_or(Ordering::Equal)
                .then_with(|| right.token_count.cmp(&left.token_count))
                .then_with(|| left.file_name.cmp(&right.file_name))
                .then_with(|| left.index.cmp(&right.index))
        });
        scored_hits.truncate(normalized_limit as usize);

        Ok(scored_hits)
    }

    async fn process_local_user_document_chunks_if_available(
        &self,
        file_id: &str,
        meta_info: &serde_json::Value,
    ) -> Result<(), McpError> {
        let Some(raw_text) = extract_local_document_text(meta_info) else {
            return Ok(());
        };
        let chunks = split_local_document_text_into_chunks(&raw_text);
        if chunks.is_empty() {
            self.mark_local_user_document_failed(file_id, "document content is empty")
                .await?;
            return Ok(());
        }

        let now = now_rfc3339()?;
        let mut tx = self.pool.begin().await?;

        sqlx::query(
            r#"
            DELETE FROM knowledge_chunk
            WHERE document_id = ? AND user_id = ?;
            "#,
        )
        .bind(file_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        for (index, chunk) in chunks.iter().enumerate() {
            let chunk_id = Uuid::new_v4().to_string();
            sqlx::query(
                r#"
                INSERT INTO knowledge_chunk (
                  id, document_id, user_id, chunk_index, text_content, token_count, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?);
                "#,
            )
            .bind(&chunk_id)
            .bind(file_id)
            .bind(LOCAL_DESKTOP_USER_ID)
            .bind(index as i64)
            .bind(chunk)
            .bind(estimate_local_tokens(chunk).max(0))
            .bind(&now)
            .bind(&now)
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        }

        sqlx::query(
            r#"
            UPDATE user_document
            SET status = 'indexed',
                error_message = NULL,
                chunk_count = ?,
                updated_at = ?
            WHERE id = ? AND user_id = ?;
            "#,
        )
        .bind(chunks.len() as i64)
        .bind(&now)
        .bind(file_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        tx.commit().await?;
        Ok(())
    }

    async fn mark_local_user_document_failed(
        &self,
        file_id: &str,
        error_message: &str,
    ) -> Result<(), McpError> {
        let now = now_rfc3339()?;
        let normalized_error = truncate_local_document_error_message(error_message);
        let mut tx = self.pool.begin().await?;

        sqlx::query(
            r#"
            DELETE FROM knowledge_chunk
            WHERE document_id = ? AND user_id = ?;
            "#,
        )
        .bind(file_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            UPDATE user_document
            SET status = 'failed',
                error_message = ?,
                chunk_count = 0,
                updated_at = ?
            WHERE id = ? AND user_id = ?;
            "#,
        )
        .bind(normalized_error)
        .bind(&now)
        .bind(file_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        tx.commit().await?;
        Ok(())
    }

    async fn get_local_knowledge_folder_by_id(
        &self,
        folder_id: &str,
    ) -> Result<LocalKnowledgeFolder, McpError> {
        let row = sqlx::query(
            r#"
            SELECT
              f.id, f.name, f.parent_id, f.created_at, f.updated_at,
              COALESCE(fc.file_count, 0) AS file_count
            FROM knowledge_folder f
            LEFT JOIN (
              SELECT folder_id, COUNT(*) AS file_count
              FROM user_document
              WHERE user_id = ?
              GROUP BY folder_id
            ) fc ON fc.folder_id = f.id
            WHERE f.id = ? AND f.user_id = ?
            LIMIT 1;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(folder_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let Some(row) = row else {
            return Err(McpError::NotFound("knowledge folder not found".to_string()));
        };

        Ok(LocalKnowledgeFolder {
            id: row.try_get("id")?,
            name: row.try_get("name")?,
            parent_id: row.try_get("parent_id")?,
            file_count: row.try_get::<i64, _>("file_count").unwrap_or(0),
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
        })
    }
}
