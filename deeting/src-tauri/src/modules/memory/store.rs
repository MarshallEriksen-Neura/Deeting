use std::cmp::Ordering;
use std::sync::Arc;

use arrow_array::{
    Array, BooleanArray, FixedSizeListArray, Float32Array, RecordBatch, RecordBatchIterator,
    StringArray,
};
use arrow_schema::{DataType, Field, Schema, SchemaRef};
use futures_util::TryStreamExt;
use lancedb::query::{ExecutableQuery, QueryBase, Select};
use lancedb::{connect, Connection, Table};
use uuid::Uuid;

use crate::modules::memory::error::MemoryError;
use crate::modules::memory::types::{
    CreateLocalMemoryRequest, LocalMemoryClearRequest, LocalMemoryItem, LocalMemoryListQuery,
    LocalMemoryListResponse,
};

const LOCAL_MEMORY_TABLE: &str = "local_memories";
const LOCAL_ASSET_TABLE: &str = "local_assets";
const DEFAULT_LOCAL_ASSET_VECTOR_DIM: i32 = 1536;
pub(crate) const DEFAULT_MEMORY_EMBEDDING_DIM: i32 = 1536;

pub struct MemoryStore {
    conn: Connection,
    embedding_dim: i32,
}

impl MemoryStore {
    pub async fn new(uri: &str) -> Result<Self, MemoryError> {
        let normalized_uri = uri.trim().to_string();
        if normalized_uri.is_empty() {
            return Err(MemoryError::validation("lancedb path is required"));
        }
        let conn = connect(&normalized_uri).execute().await?;
        Ok(Self {
            conn,
            embedding_dim: DEFAULT_MEMORY_EMBEDDING_DIM,
        })
    }

    pub async fn init(&self) -> Result<(), MemoryError> {
        self.init_with_dim(self.embedding_dim).await
    }

    pub async fn init_with_dim(&self, embedding_dim: i32) -> Result<(), MemoryError> {
        let table_names = self.conn.table_names().execute().await?;

        if !table_names.iter().any(|name| name == LOCAL_MEMORY_TABLE) {
            // Fresh install: create V2 schema directly
            self.conn
                .create_empty_table(LOCAL_MEMORY_TABLE, local_memory_schema_v2(embedding_dim))
                .execute()
                .await?;
        } else {
            // Existing table: check if migration is needed
            let current_version =
                crate::modules::memory::migration::detect_schema_version(&self.conn, LOCAL_MEMORY_TABLE)
                    .await?;
            if current_version < crate::modules::memory::migration::CURRENT_MEMORY_SCHEMA_VERSION {
                crate::modules::memory::migration::migrate_to_latest(
                    &self.conn,
                    LOCAL_MEMORY_TABLE,
                    current_version,
                    crate::modules::memory::migration::CURRENT_MEMORY_SCHEMA_VERSION,
                    embedding_dim,
                )
                .await?;
            }
        }

        if !table_names.iter().any(|name| name == LOCAL_ASSET_TABLE) {
            self.conn
                .create_empty_table(
                    LOCAL_ASSET_TABLE,
                    local_asset_schema(DEFAULT_LOCAL_ASSET_VECTOR_DIM),
                )
                .execute()
                .await?;
        }

        Ok(())
    }

    pub async fn get_asset_by_id(
        &self,
        id: &str,
    ) -> Result<Option<serde_json::Value>, MemoryError> {
        let table = self.conn.open_table(LOCAL_ASSET_TABLE).execute().await?;
        let batches = table
            .query()
            .only_if(format!("id = '{}'", sql_escape(id)))
            .limit(1)
            .execute()
            .await?
            .try_collect::<Vec<_>>()
            .await?;

        if let Some(batch) = batches.first() {
            if batch.num_rows() > 0 {
                let id_col = as_string_col(batch, "id")?;
                let name_col = as_string_col(batch, "name")?;
                let desc_col = as_string_col(batch, "description")?;
                let a_type_col = as_string_col(batch, "asset_type")?;
                let s_type_col = as_string_col(batch, "source_type")?;
                let pkg_col = as_string_col(batch, "pkg_name")?;
                let meta_col = as_string_col(batch, "metadata_json")?;

                return Ok(Some(serde_json::json!({
                    "id": id_col.value(0),
                    "name": name_col.value(0),
                    "description": desc_col.value(0),
                    "asset_type": a_type_col.value(0),
                    "source_type": s_type_col.value(0),
                    "pkg_name": nullable_string(pkg_col, 0),
                    "metadata": nullable_string(meta_col, 0)
                        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok()),
                })));
            }
        }
        Ok(None)
    }

    pub async fn upsert_asset(
        &self,
        id: String,
        name: String,
        description: String,
        asset_type: String,  // "tool", "assistant"
        source_type: String, // "builtin", "user", "cloud_mirror"
        pkg_name: Option<String>,
        vector: Vec<f32>,
        metadata: Option<serde_json::Value>,
    ) -> Result<(), MemoryError> {
        let now = now_rfc3339();
        let metadata_str = metadata.map(|v| v.to_string());
        let vector_opt = vector.into_iter().map(Some).collect::<Vec<Option<f32>>>();
        let vector_dim = i32::try_from(vector_opt.len())
            .map_err(|_| MemoryError::validation("embedding vector dimension is too large"))?;
        if vector_dim <= 0 {
            return Err(MemoryError::validation(
                "embedding vector must not be empty",
            ));
        }

        let table = self.conn.open_table(LOCAL_ASSET_TABLE).execute().await?;
        let table_schema = table.schema().await?;
        let expected_dim = local_asset_vector_dimension_from_schema(table_schema.as_ref())
            .ok_or_else(|| MemoryError::validation("local_assets vector field is missing"))?;
        if expected_dim != vector_dim {
            return Err(MemoryError::validation(format!(
                "embedding vector dimension mismatch: table expects {expected_dim}, got {vector_dim}; please rebuild local embedding index"
            )));
        }
        let schema = local_asset_schema(expected_dim);

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec![Some(id.clone())])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![Some(name)])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![Some(description)])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![Some(asset_type)])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![Some(source_type)])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![pkg_name])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![metadata_str])) as Arc<dyn Array>,
                Arc::new(arrow_array::FixedSizeListArray::from_iter_primitive::<
                    arrow_array::types::Float32Type,
                    _,
                    _,
                >(vec![Some(vector_opt)], vector_dim)) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![Some(now.clone())])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![Some(now)])) as Arc<dyn Array>,
            ],
        )?;

        // Use standard LanceDB merge/upsert if possible, or simple add for now
        // Note: For simplicity in this heavy refactor, we clear old entries with same ID if needed
        // but LanceDB add is cumulative. In a real scenario, we'd use a merge query.
        table
            .add(RecordBatchIterator::new(vec![Ok(batch)], schema))
            .execute()
            .await?;
        Ok(())
    }

    pub async fn recreate_local_asset_table(&self, vector_dim: i32) -> Result<(), MemoryError> {
        if vector_dim <= 0 {
            return Err(MemoryError::validation(
                "vector dimension must be greater than zero",
            ));
        }

        let table_names = self.conn.table_names().execute().await?;
        if table_names.iter().any(|name| name == LOCAL_ASSET_TABLE) {
            self.conn.drop_table(LOCAL_ASSET_TABLE, &[]).await?;
        }

        self.conn
            .create_empty_table(LOCAL_ASSET_TABLE, local_asset_schema(vector_dim))
            .execute()
            .await?;
        Ok(())
    }

    pub async fn delete_assets_by_package(&self, pkg_name: &str) -> Result<(), MemoryError> {
        let table_names = self.conn.table_names().execute().await?;
        if !table_names.iter().any(|name| name == LOCAL_ASSET_TABLE) {
            return Ok(());
        }

        let table = self.conn.open_table(LOCAL_ASSET_TABLE).execute().await?;
        table
            .delete(&format!("pkg_name = '{}'", sql_escape(pkg_name)))
            .await?;
        Ok(())
    }

    pub async fn local_asset_vector_dimension(&self) -> Result<Option<i32>, MemoryError> {
        let table_names = self.conn.table_names().execute().await?;
        if !table_names.iter().any(|name| name == LOCAL_ASSET_TABLE) {
            return Ok(None);
        }

        let table = self.conn.open_table(LOCAL_ASSET_TABLE).execute().await?;
        let schema = table.schema().await?;
        Ok(local_asset_vector_dimension_from_schema(schema.as_ref()))
    }

    pub async fn search_assets(
        &self,
        vector: Vec<f32>,
        limit: usize,
        asset_type: Option<&str>,
    ) -> Result<Vec<serde_json::Value>, MemoryError> {
        let table = self.conn.open_table(LOCAL_ASSET_TABLE).execute().await?;
        let mut vector_query = table.vector_search(vector.clone())?.limit(limit);

        if let Some(t) = asset_type {
            vector_query = vector_query.only_if(format!("asset_type = '{}'", sql_escape(t)));
        }

        match vector_query.execute().await {
            Ok(stream) => {
                let batches = stream.try_collect::<Vec<_>>().await?;
                let results = read_asset_search_batches(&batches)?;
                if !results.is_empty() {
                    return Ok(results);
                }
            }
            Err(_) => {}
        }

        self.search_assets_linear_fallback(vector, limit, asset_type).await
    }

    pub async fn list_assets_catalog(&self) -> Result<Vec<serde_json::Value>, MemoryError> {
        let table = self.conn.open_table(LOCAL_ASSET_TABLE).execute().await?;
        let stmt = table.query().select(Select::columns(&[
            "id",
            "name",
            "description",
            "asset_type",
            "source_type",
            "pkg_name",
            "metadata_json",
        ]));
        let batches = stmt.execute().await?.try_collect::<Vec<_>>().await?;
        let mut results = Vec::new();
        for batch in batches {
            let id_col = as_string_col(&batch, "id")?;
            let name_col = as_string_col(&batch, "name")?;
            let desc_col = as_string_col(&batch, "description")?;
            let a_type_col = as_string_col(&batch, "asset_type")?;
            let s_type_col = as_string_col(&batch, "source_type")?;
            let pkg_col = as_string_col(&batch, "pkg_name")?;
            let meta_col = as_string_col(&batch, "metadata_json")?;

            for row in 0..batch.num_rows() {
                results.push(serde_json::json!({
                    "id": id_col.value(row),
                    "name": name_col.value(row),
                    "description": desc_col.value(row),
                    "asset_type": a_type_col.value(row),
                    "source_type": s_type_col.value(row),
                    "pkg_name": nullable_string(pkg_col, row),
                    "metadata": nullable_string(meta_col, row)
                        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok()),
                }));
            }
        }
        Ok(results)
    }

    async fn search_assets_linear_fallback(
        &self,
        vector: Vec<f32>,
        limit: usize,
        asset_type: Option<&str>,
    ) -> Result<Vec<serde_json::Value>, MemoryError> {
        let table = self.conn.open_table(LOCAL_ASSET_TABLE).execute().await?;
        let batches = table.query().execute().await?.try_collect::<Vec<_>>().await?;
        let mut results = Vec::new();
        for batch in batches {
            let id_col = as_string_col(&batch, "id")?;
            let name_col = as_string_col(&batch, "name")?;
            let desc_col = as_string_col(&batch, "description")?;
            let a_type_col = as_string_col(&batch, "asset_type")?;
            let s_type_col = as_string_col(&batch, "source_type")?;
            let pkg_col = as_string_col(&batch, "pkg_name")?;
            let meta_col = as_string_col(&batch, "metadata_json")?;
            let vector_col = batch
                .column_by_name("vector")
                .and_then(|c| c.as_any().downcast_ref::<FixedSizeListArray>())
                .ok_or_else(|| MemoryError::Storage("missing or invalid vector column".to_string()))?;
            let values_col = vector_col
                .values()
                .as_any()
                .downcast_ref::<Float32Array>()
                .ok_or_else(|| MemoryError::Storage("invalid vector values column".to_string()))?;
            let value_len = usize::try_from(vector_col.value_length())
                .map_err(|_| MemoryError::Storage("invalid vector value length".to_string()))?;

            for row in 0..batch.num_rows() {
                let asset_type_value = a_type_col.value(row);
                if let Some(expected_asset_type) = asset_type {
                    if asset_type_value != expected_asset_type {
                        continue;
                    }
                }
                let start = row.saturating_mul(value_len);
                let end = start.saturating_add(value_len);
                if end > values_col.len() {
                    continue;
                }
                let candidate = (start..end)
                    .map(|idx| if values_col.is_null(idx) { 0.0 } else { values_col.value(idx) })
                    .collect::<Vec<_>>();
                let score = cosine_similarity(&vector, &candidate);
                results.push(serde_json::json!({
                    "id": id_col.value(row),
                    "name": name_col.value(row),
                    "description": desc_col.value(row),
                    "asset_type": asset_type_value,
                    "source_type": s_type_col.value(row),
                    "pkg_name": nullable_string(pkg_col, row),
                    "metadata": nullable_string(meta_col, row)
                        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok()),
                    "_distance": score,
                }));
            }
        }

        results.sort_by(|left, right| {
            let lhs = left
                .get("_distance")
                .and_then(|value| value.as_f64())
                .unwrap_or(f64::NEG_INFINITY);
            let rhs = right
                .get("_distance")
                .and_then(|value| value.as_f64())
                .unwrap_or(f64::NEG_INFINITY);
            rhs.partial_cmp(&lhs).unwrap_or(Ordering::Equal)
        });
        if results.len() > limit {
            results.truncate(limit);
        }
        Ok(results)
    }

    pub async fn append(
        &self,
        payload: CreateLocalMemoryRequest,
    ) -> Result<LocalMemoryItem, MemoryError> {
        let content = payload.content.trim().to_string();
        if content.is_empty() {
            return Err(MemoryError::validation("content is required"));
        }
        let session_id = normalize_optional(payload.session_id);
        let assistant_id = normalize_optional(payload.assistant_id);
        let meta_info_json = payload
            .meta_info
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;

        let id = Uuid::new_v4().to_string();
        let now = now_rfc3339();

        let schema = local_memory_schema_v2(self.embedding_dim);
        let null_embedding = arrow_array::new_null_array(
            &DataType::FixedSizeList(
                Arc::new(Field::new("item", DataType::Float32, true)),
                self.embedding_dim,
            ),
            1,
        );

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec![Some(id.clone())])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![Some(content.clone())])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![session_id.clone()])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![assistant_id.clone()])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![meta_info_json.clone()])) as Arc<dyn Array>,
                Arc::new(BooleanArray::from(vec![false])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![Some(now.clone())])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![Some(now.clone())])) as Arc<dyn Array>,
                null_embedding,
                Arc::new(StringArray::from(vec![None as Option<&str>])) as Arc<dyn Array>,
            ],
        )?;
        let reader = RecordBatchIterator::new(vec![Ok(batch)].into_iter(), schema);
        let table = self.table().await?;
        table.add(reader).execute().await?;

        Ok(LocalMemoryItem {
            id,
            content,
            session_id,
            assistant_id,
            meta_info: payload.meta_info,
            embedding_model: None,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub async fn list(
        &self,
        query: LocalMemoryListQuery,
    ) -> Result<LocalMemoryListResponse, MemoryError> {
        let limit = query.limit.unwrap_or(30).clamp(1, 200) as usize;
        let cursor = decode_cursor(query.cursor)?;
        let session_id = normalize_optional(query.session_id);
        let assistant_id = normalize_optional(query.assistant_id);

        let where_clause = build_filter_sql(session_id.as_deref(), assistant_id.as_deref(), true);
        let table = self.table().await?;
        let mut stmt = table.query().select(Select::columns(&[
            "id",
            "content",
            "session_id",
            "assistant_id",
            "meta_info_json",
            "created_at",
            "updated_at",
        ]));
        if !where_clause.is_empty() {
            stmt = stmt.only_if(where_clause);
        }

        let batches = stmt.execute().await?.try_collect::<Vec<_>>().await?;
        let mut items = Vec::new();
        for batch in batches {
            items.extend(read_items_from_batch(&batch)?);
        }

        items.sort_by(|a, b| compare_desc(a, b));
        if let Some(cursor_key) = cursor {
            items.retain(|item| {
                item.created_at < cursor_key.created_at
                    || (item.created_at == cursor_key.created_at && item.id < cursor_key.id)
            });
        }

        let has_more = items.len() > limit;
        let page_items = if has_more {
            items[..limit].to_vec()
        } else {
            items
        };
        let next_cursor = if has_more {
            page_items.last().map(|item| encode_cursor(item))
        } else {
            None
        };

        Ok(LocalMemoryListResponse {
            items: page_items,
            next_cursor,
            has_more,
        })
    }

    pub async fn delete(&self, id: &str) -> Result<bool, MemoryError> {
        let normalized_id = id.trim().to_string();
        if normalized_id.is_empty() {
            return Err(MemoryError::validation("id is required"));
        }

        let now = now_rfc3339();
        let table = self.table().await?;
        let affected = table
            .update()
            .only_if(format!(
                "id = '{}' AND is_deleted = false",
                sql_escape(&normalized_id)
            ))
            .column("is_deleted", "true")
            .column("updated_at", format!("'{}'", sql_escape(&now)))
            .execute()
            .await?;
        Ok(affected.rows_updated > 0)
    }

    pub async fn clear(&self, payload: LocalMemoryClearRequest) -> Result<i64, MemoryError> {
        let session_id = normalize_optional(payload.session_id);
        let assistant_id = normalize_optional(payload.assistant_id);
        let where_clause = build_filter_sql(session_id.as_deref(), assistant_id.as_deref(), true);
        let now = now_rfc3339();
        let table = self.table().await?;
        let mut operation = table
            .update()
            .column("is_deleted", "true")
            .column("updated_at", format!("'{}'", sql_escape(&now)));
        if !where_clause.is_empty() {
            operation = operation.only_if(where_clause);
        }
        let affected = operation.execute().await?;
        Ok(affected.rows_updated as i64)
    }

    async fn table(&self) -> Result<Table, MemoryError> {
        Ok(self.conn.open_table(LOCAL_MEMORY_TABLE).execute().await?)
    }

    /// Append a memory with a pre-computed embedding vector.
    pub async fn append_with_embedding(
        &self,
        payload: CreateLocalMemoryRequest,
        embedding: Vec<f32>,
        embedding_model: Option<String>,
    ) -> Result<LocalMemoryItem, MemoryError> {
        let content = payload.content.trim().to_string();
        if content.is_empty() {
            return Err(MemoryError::validation("content is required"));
        }
        let session_id = normalize_optional(payload.session_id);
        let assistant_id = normalize_optional(payload.assistant_id);
        let meta_info_json = payload
            .meta_info
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;

        let id = Uuid::new_v4().to_string();
        let now = now_rfc3339();

        let embedding_opts: Vec<Option<f32>> = embedding.into_iter().map(Some).collect();
        let vec_dim = i32::try_from(embedding_opts.len())
            .map_err(|_| MemoryError::validation("embedding dimension too large"))?;
        if vec_dim != self.embedding_dim {
            return Err(MemoryError::validation(format!(
                "embedding dimension mismatch: expected {}, got {}",
                self.embedding_dim, vec_dim
            )));
        }

        let schema = local_memory_schema_v2(self.embedding_dim);
        let embedding_col = Arc::new(
            FixedSizeListArray::from_iter_primitive::<arrow_array::types::Float32Type, _, _>(
                vec![Some(embedding_opts)],
                self.embedding_dim,
            ),
        ) as Arc<dyn Array>;

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec![Some(id.clone())])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![Some(content.clone())])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![session_id.clone()])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![assistant_id.clone()])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![meta_info_json.clone()])) as Arc<dyn Array>,
                Arc::new(BooleanArray::from(vec![false])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![Some(now.clone())])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![Some(now.clone())])) as Arc<dyn Array>,
                embedding_col,
                Arc::new(StringArray::from(vec![embedding_model.clone()])) as Arc<dyn Array>,
            ],
        )?;
        let reader = RecordBatchIterator::new(vec![Ok(batch)].into_iter(), schema);
        let table = self.table().await?;
        table.add(reader).execute().await?;

        Ok(LocalMemoryItem {
            id,
            content,
            session_id,
            assistant_id,
            meta_info: payload.meta_info,
            embedding_model,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    /// Vector-based semantic search over local_memories.
    /// Falls back to linear scan if the vector index is unavailable.
    pub async fn search_memories(
        &self,
        query_embedding: Vec<f32>,
        limit: usize,
        session_id: Option<&str>,
        assistant_id: Option<&str>,
    ) -> Result<Vec<crate::modules::memory::types::LocalMemorySearchItem>, MemoryError> {
        let filter = build_filter_sql(session_id, assistant_id, true);
        let table = self.table().await?;

        // Try LanceDB native vector search first
        let mut vector_query = table.vector_search(query_embedding.clone())?.limit(limit);
        if !filter.is_empty() {
            vector_query = vector_query.only_if(filter.clone());
        }

        match vector_query.execute().await {
            Ok(stream) => {
                let batches = stream.try_collect::<Vec<_>>().await?;
                let results = read_memory_search_batches(&batches)?;
                if !results.is_empty() {
                    return Ok(results);
                }
            }
            Err(e) => {
                log::warn!("memory vector search unavailable, falling back to linear: {}", e);
            }
        }

        // Linear fallback: scan all rows with embeddings, compute cosine similarity
        self.search_memories_linear_fallback(query_embedding, limit, session_id, assistant_id)
            .await
    }

    async fn search_memories_linear_fallback(
        &self,
        query_embedding: Vec<f32>,
        limit: usize,
        session_id: Option<&str>,
        assistant_id: Option<&str>,
    ) -> Result<Vec<crate::modules::memory::types::LocalMemorySearchItem>, MemoryError> {
        use crate::modules::memory::types::LocalMemorySearchItem;

        let filter = build_filter_sql(session_id, assistant_id, true);
        let table = self.table().await?;
        let mut stmt = table.query();
        if !filter.is_empty() {
            stmt = stmt.only_if(filter);
        }
        let batches = stmt.execute().await?.try_collect::<Vec<_>>().await?;

        let mut results = Vec::new();
        for batch in &batches {
            let id_col = as_string_col(batch, "id")?;
            let content_col = as_string_col(batch, "content")?;
            let session_col = as_string_col(batch, "session_id")?;
            let assistant_col = as_string_col(batch, "assistant_id")?;
            let meta_col = as_string_col(batch, "meta_info_json")?;
            let created_col = as_string_col(batch, "created_at")?;
            let updated_col = as_string_col(batch, "updated_at")?;

            let embedding_col = match batch
                .column_by_name("embedding")
                .and_then(|c| c.as_any().downcast_ref::<FixedSizeListArray>())
            {
                Some(col) => col,
                None => continue,
            };
            let values_col = match embedding_col
                .values()
                .as_any()
                .downcast_ref::<Float32Array>()
            {
                Some(col) => col,
                None => continue,
            };
            let value_len = usize::try_from(embedding_col.value_length())
                .map_err(|_| MemoryError::Storage("invalid embedding value length".into()))?;

            for row in 0..batch.num_rows() {
                // Skip rows without embeddings
                if embedding_col.is_null(row) {
                    continue;
                }

                let start = row.saturating_mul(value_len);
                let end = start.saturating_add(value_len);
                if end > values_col.len() {
                    continue;
                }
                let candidate: Vec<f32> = (start..end)
                    .map(|idx| if values_col.is_null(idx) { 0.0 } else { values_col.value(idx) })
                    .collect();
                let score = cosine_similarity(&query_embedding, &candidate);

                let meta_info = nullable_string(meta_col, row)
                    .map(|raw| serde_json::from_str(&raw))
                    .transpose()?;

                results.push(LocalMemorySearchItem {
                    id: required_string(id_col, row, "id")?,
                    content: required_string(content_col, row, "content")?,
                    session_id: nullable_string(session_col, row),
                    assistant_id: nullable_string(assistant_col, row),
                    meta_info,
                    score,
                    created_at: required_string(created_col, row, "created_at")?,
                    updated_at: required_string(updated_col, row, "updated_at")?,
                });
            }
        }

        results.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(Ordering::Equal)
        });
        if results.len() > limit {
            results.truncate(limit);
        }
        Ok(results)
    }

    /// List memories that have no embedding (for backfill).
    pub async fn list_memories_without_embedding(
        &self,
        limit: usize,
    ) -> Result<Vec<LocalMemoryItem>, MemoryError> {
        let table = self.table().await?;
        let batches = table
            .query()
            .only_if("is_deleted = false AND embedding IS NULL")
            .limit(limit)
            .execute()
            .await?
            .try_collect::<Vec<_>>()
            .await?;

        let mut items = Vec::new();
        for batch in &batches {
            items.extend(read_items_from_batch(batch)?);
        }
        Ok(items)
    }

    /// Update a memory's embedding (delete + re-insert workaround for LanceDB).
    pub async fn update_memory_embedding(
        &self,
        id: &str,
        embedding: Vec<f32>,
        embedding_model: Option<String>,
    ) -> Result<bool, MemoryError> {
        let table = self.table().await?;

        // Read the existing row
        let batches = table
            .query()
            .only_if(format!("id = '{}'", sql_escape(id)))
            .limit(1)
            .execute()
            .await?
            .try_collect::<Vec<_>>()
            .await?;

        let batch = match batches.first() {
            Some(b) if b.num_rows() > 0 => b,
            _ => return Ok(false),
        };

        let id_col = as_string_col(batch, "id")?;
        let content_col = as_string_col(batch, "content")?;
        let session_col = as_string_col(batch, "session_id")?;
        let assistant_col = as_string_col(batch, "assistant_id")?;
        let meta_col = as_string_col(batch, "meta_info_json")?;
        let deleted_col = batch
            .column_by_name("is_deleted")
            .and_then(|c| c.as_any().downcast_ref::<BooleanArray>())
            .ok_or_else(|| MemoryError::Storage("missing is_deleted column".into()))?;
        let created_col = as_string_col(batch, "created_at")?;
        let _updated_col = as_string_col(batch, "updated_at")?;

        let embedding_opts: Vec<Option<f32>> = embedding.into_iter().map(Some).collect();
        let schema = local_memory_schema_v2(self.embedding_dim);
        let embedding_col = Arc::new(
            FixedSizeListArray::from_iter_primitive::<arrow_array::types::Float32Type, _, _>(
                vec![Some(embedding_opts)],
                self.embedding_dim,
            ),
        ) as Arc<dyn Array>;

        let now = now_rfc3339();
        let new_batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec![Some(id_col.value(0).to_string())])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![Some(content_col.value(0).to_string())])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![nullable_string(session_col, 0)])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![nullable_string(assistant_col, 0)])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![nullable_string(meta_col, 0)])) as Arc<dyn Array>,
                Arc::new(BooleanArray::from(vec![deleted_col.value(0)])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![Some(created_col.value(0).to_string())])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![Some(now)])) as Arc<dyn Array>,
                embedding_col,
                Arc::new(StringArray::from(vec![embedding_model])) as Arc<dyn Array>,
            ],
        )?;

        // Delete old row, insert updated row
        table
            .delete(&format!("id = '{}'", sql_escape(id)))
            .await?;
        table
            .add(RecordBatchIterator::new(
                vec![Ok(new_batch)].into_iter(),
                schema,
            ))
            .execute()
            .await?;

        Ok(true)
    }
}

#[derive(Debug, Clone)]
struct CursorKey {
    created_at: String,
    id: String,
}

/// V2 schema: V1 fields + nullable embedding vector + nullable embedding_model.
pub(crate) fn local_memory_schema_v2(embedding_dim: i32) -> SchemaRef {
    Arc::new(Schema::new(vec![
        Field::new("id", DataType::Utf8, false),
        Field::new("content", DataType::Utf8, false),
        Field::new("session_id", DataType::Utf8, true),
        Field::new("assistant_id", DataType::Utf8, true),
        Field::new("meta_info_json", DataType::Utf8, true),
        Field::new("is_deleted", DataType::Boolean, false),
        Field::new("created_at", DataType::Utf8, false),
        Field::new("updated_at", DataType::Utf8, false),
        Field::new(
            "embedding",
            DataType::FixedSizeList(
                Arc::new(Field::new("item", DataType::Float32, true)),
                embedding_dim,
            ),
            true,
        ),
        Field::new("embedding_model", DataType::Utf8, true),
    ]))
}

fn local_asset_schema(vector_dim: i32) -> SchemaRef {
    Arc::new(Schema::new(vec![
        Field::new("id", DataType::Utf8, false),
        Field::new("name", DataType::Utf8, false),
        Field::new("description", DataType::Utf8, false),
        Field::new("asset_type", DataType::Utf8, false),
        Field::new("source_type", DataType::Utf8, false),
        Field::new("pkg_name", DataType::Utf8, true),
        Field::new("metadata_json", DataType::Utf8, true),
        Field::new(
            "vector",
            DataType::FixedSizeList(
                Arc::new(Field::new("item", DataType::Float32, true)),
                vector_dim,
            ),
            false,
        ),
        Field::new("created_at", DataType::Utf8, false),
        Field::new("updated_at", DataType::Utf8, false),
    ]))
}

fn local_asset_vector_dimension_from_schema(schema: &Schema) -> Option<i32> {
    schema
        .field_with_name("vector")
        .ok()
        .and_then(|field| match field.data_type() {
            DataType::FixedSizeList(_, size) => Some(*size),
            _ => None,
        })
}

fn build_filter_sql(
    session_id: Option<&str>,
    assistant_id: Option<&str>,
    include_not_deleted: bool,
) -> String {
    let mut clauses = Vec::new();
    if include_not_deleted {
        clauses.push("is_deleted = false".to_string());
    }
    if let Some(session) = session_id {
        clauses.push(format!("session_id = '{}'", sql_escape(session)));
    }
    if let Some(assistant) = assistant_id {
        clauses.push(format!("assistant_id = '{}'", sql_escape(assistant)));
    }
    clauses.join(" AND ")
}

fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

fn normalize_optional(value: Option<String>) -> Option<String> {
    value
        .map(|raw| raw.trim().to_string())
        .filter(|raw| !raw.is_empty())
}

fn sql_escape(raw: &str) -> String {
    raw.replace('\'', "''")
}

fn read_asset_search_batches(
    batches: &[RecordBatch],
) -> Result<Vec<serde_json::Value>, MemoryError> {
    let mut results = Vec::new();
    for batch in batches {
        let id_col = as_string_col(batch, "id")?;
        let name_col = as_string_col(batch, "name")?;
        let desc_col = as_string_col(batch, "description")?;
        let a_type_col = as_string_col(batch, "asset_type")?;
        let s_type_col = as_string_col(batch, "source_type")?;
        let pkg_col = as_string_col(batch, "pkg_name")?;
        let meta_col = as_string_col(batch, "metadata_json")?;
        let score_col = batch.column_by_name("_distance");

        for row in 0..batch.num_rows() {
            let score = score_col
                .and_then(|c| c.as_any().downcast_ref::<Float32Array>())
                .map(|c| c.value(row));
            results.push(serde_json::json!({
                "id": id_col.value(row),
                "name": name_col.value(row),
                "description": desc_col.value(row),
                "asset_type": a_type_col.value(row),
                "source_type": s_type_col.value(row),
                "pkg_name": nullable_string(pkg_col, row),
                "metadata": nullable_string(meta_col, row)
                    .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok()),
                "_distance": score,
            }));
        }
    }
    Ok(results)
}

fn cosine_similarity(query: &[f32], candidate: &[f32]) -> f32 {
    if query.is_empty() || candidate.is_empty() || query.len() != candidate.len() {
        return 0.0;
    }
    let mut dot = 0.0_f32;
    let mut query_norm = 0.0_f32;
    let mut candidate_norm = 0.0_f32;
    for (lhs, rhs) in query.iter().zip(candidate.iter()) {
        dot += lhs * rhs;
        query_norm += lhs * lhs;
        candidate_norm += rhs * rhs;
    }
    if query_norm <= f32::EPSILON || candidate_norm <= f32::EPSILON {
        return 0.0;
    }
    dot / (query_norm.sqrt() * candidate_norm.sqrt())
}

fn read_items_from_batch(batch: &RecordBatch) -> Result<Vec<LocalMemoryItem>, MemoryError> {
    let id_col = as_string_col(batch, "id")?;
    let content_col = as_string_col(batch, "content")?;
    let session_col = as_string_col(batch, "session_id")?;
    let assistant_col = as_string_col(batch, "assistant_id")?;
    let meta_col = as_string_col(batch, "meta_info_json")?;
    let created_col = as_string_col(batch, "created_at")?;
    let updated_col = as_string_col(batch, "updated_at")?;
    // embedding_model may not be present in older queries or selected columns
    let model_col = batch
        .column_by_name("embedding_model")
        .and_then(|c| c.as_any().downcast_ref::<StringArray>());

    let mut items = Vec::with_capacity(batch.num_rows());
    for row in 0..batch.num_rows() {
        let meta_info = nullable_string(meta_col, row)
            .map(|raw| serde_json::from_str(&raw))
            .transpose()?;
        let embedding_model = model_col.and_then(|col| nullable_string(col, row));
        items.push(LocalMemoryItem {
            id: required_string(id_col, row, "id")?,
            content: required_string(content_col, row, "content")?,
            session_id: nullable_string(session_col, row),
            assistant_id: nullable_string(assistant_col, row),
            meta_info,
            embedding_model,
            created_at: required_string(created_col, row, "created_at")?,
            updated_at: required_string(updated_col, row, "updated_at")?,
        });
    }
    Ok(items)
}

fn as_string_col<'a>(batch: &'a RecordBatch, name: &str) -> Result<&'a StringArray, MemoryError> {
    let column = batch
        .column_by_name(name)
        .ok_or_else(|| MemoryError::Storage(format!("missing column: {name}")))?;
    column
        .as_any()
        .downcast_ref::<StringArray>()
        .ok_or_else(|| MemoryError::Storage(format!("invalid string column: {name}")))
}

fn required_string(col: &StringArray, index: usize, name: &str) -> Result<String, MemoryError> {
    if col.is_null(index) {
        return Err(MemoryError::Storage(format!(
            "required column {name} is null at row {index}"
        )));
    }
    Ok(col.value(index).to_string())
}

fn nullable_string(col: &StringArray, index: usize) -> Option<String> {
    if col.is_null(index) {
        None
    } else {
        Some(col.value(index).to_string())
    }
}

fn compare_desc(a: &LocalMemoryItem, b: &LocalMemoryItem) -> Ordering {
    b.created_at
        .cmp(&a.created_at)
        .then_with(|| b.id.cmp(&a.id))
}

fn read_memory_search_batches(
    batches: &[RecordBatch],
) -> Result<Vec<crate::modules::memory::types::LocalMemorySearchItem>, MemoryError> {
    use crate::modules::memory::types::LocalMemorySearchItem;

    let mut results = Vec::new();
    for batch in batches {
        let id_col = as_string_col(batch, "id")?;
        let content_col = as_string_col(batch, "content")?;
        let session_col = as_string_col(batch, "session_id")?;
        let assistant_col = as_string_col(batch, "assistant_id")?;
        let meta_col = as_string_col(batch, "meta_info_json")?;
        let created_col = as_string_col(batch, "created_at")?;
        let updated_col = as_string_col(batch, "updated_at")?;
        let score_col = batch.column_by_name("_distance");

        for row in 0..batch.num_rows() {
            let distance = score_col
                .and_then(|c| c.as_any().downcast_ref::<Float32Array>())
                .map(|c| c.value(row))
                .unwrap_or(0.0);
            // LanceDB returns L2 distance; convert to similarity (1 / (1 + distance))
            let score = 1.0 / (1.0 + distance);

            let meta_info = nullable_string(meta_col, row)
                .map(|raw| serde_json::from_str(&raw))
                .transpose()?;

            results.push(LocalMemorySearchItem {
                id: required_string(id_col, row, "id")?,
                content: required_string(content_col, row, "content")?,
                session_id: nullable_string(session_col, row),
                assistant_id: nullable_string(assistant_col, row),
                meta_info,
                score,
                created_at: required_string(created_col, row, "created_at")?,
                updated_at: required_string(updated_col, row, "updated_at")?,
            });
        }
    }
    Ok(results)
}

fn encode_cursor(item: &LocalMemoryItem) -> String {
    format!("{}|{}", item.created_at, item.id)
}

fn decode_cursor(raw: Option<String>) -> Result<Option<CursorKey>, MemoryError> {
    let Some(raw) = raw.map(|x| x.trim().to_string()).filter(|x| !x.is_empty()) else {
        return Ok(None);
    };
    let mut parts = raw.splitn(2, '|');
    let created_at = parts.next().unwrap_or("").trim().to_string();
    let id = parts.next().unwrap_or("").trim().to_string();
    if created_at.is_empty() || id.is_empty() {
        return Err(MemoryError::validation("invalid cursor format"));
    }
    Ok(Some(CursorKey { created_at, id }))
}
