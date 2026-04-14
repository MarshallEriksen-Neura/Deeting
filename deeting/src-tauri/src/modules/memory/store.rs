use std::cmp::Ordering;
use std::collections::HashSet;
use std::sync::atomic::{AtomicI32, Ordering as AtomicOrdering};
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
    LocalMemoryListResponse, LocalMemorySearchItem, UpdateLocalMemoryRequest,
};
use crate::modules::retrieval_kernel::write_guard::WriteGuardCandidate;

const LOCAL_MEMORY_TABLE: &str = "local_memories";
const LOCAL_ASSET_TABLE: &str = "local_assets";
const USER_KNOWLEDGE_CHUNK_TABLE: &str = "user_knowledge_chunks";
const DEFAULT_LOCAL_ASSET_VECTOR_DIM: i32 = 1536;
pub(crate) const DEFAULT_MEMORY_EMBEDDING_DIM: i32 = 1536;

pub struct MemoryStore {
    conn: Connection,
    embedding_dim: AtomicI32,
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
            embedding_dim: AtomicI32::new(DEFAULT_MEMORY_EMBEDDING_DIM),
        })
    }

    pub async fn init(&self) -> Result<(), MemoryError> {
        self.init_with_dim(self.embedding_dim()).await
    }

    pub async fn init_with_dim(&self, embedding_dim: i32) -> Result<(), MemoryError> {
        let table_names = self.conn.table_names().execute().await?;
        let mut resolved_memory_dim = embedding_dim;

        if !table_names.iter().any(|name| name == LOCAL_MEMORY_TABLE) {
            // Fresh install: create V3 schema directly
            self.conn
                .create_empty_table(LOCAL_MEMORY_TABLE, local_memory_schema_v3(embedding_dim))
                .execute()
                .await?;
            resolved_memory_dim = embedding_dim;
        } else {
            let table = self.conn.open_table(LOCAL_MEMORY_TABLE).execute().await?;
            let schema = table.schema().await?;
            let schema_dim = local_memory_embedding_dimension_from_schema(schema.as_ref());
            if let Some(existing_dim) = schema_dim {
                resolved_memory_dim = existing_dim;
                if existing_dim != embedding_dim {
                    log::warn!(
                        "memory init requested embedding dim {} but existing local_memories schema uses {}; keeping schema dimension",
                        embedding_dim,
                        existing_dim
                    );
                }
            }
            // Existing table: check if migration is needed
            let current_version = crate::modules::memory::migration::detect_schema_version(
                &self.conn,
                LOCAL_MEMORY_TABLE,
            )
            .await?;
            if current_version < crate::modules::memory::migration::CURRENT_MEMORY_SCHEMA_VERSION {
                let migration_dim = schema_dim.unwrap_or(embedding_dim);
                crate::modules::memory::migration::migrate_to_latest(
                    &self.conn,
                    LOCAL_MEMORY_TABLE,
                    current_version,
                    crate::modules::memory::migration::CURRENT_MEMORY_SCHEMA_VERSION,
                    migration_dim,
                )
                .await?;
                resolved_memory_dim = migration_dim;
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

        if !table_names
            .iter()
            .any(|name| name == USER_KNOWLEDGE_CHUNK_TABLE)
        {
            self.conn
                .create_empty_table(
                    USER_KNOWLEDGE_CHUNK_TABLE,
                    local_asset_schema(DEFAULT_LOCAL_ASSET_VECTOR_DIM),
                )
                .execute()
                .await?;
        }

        self.embedding_dim
            .store(resolved_memory_dim, AtomicOrdering::Relaxed);

        Ok(())
    }

    fn embedding_dim(&self) -> i32 {
        self.embedding_dim.load(AtomicOrdering::Relaxed)
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
        self.upsert_asset_into_table(
            LOCAL_ASSET_TABLE,
            id,
            name,
            description,
            asset_type,
            source_type,
            pkg_name,
            vector,
            metadata,
        )
        .await
    }

    pub async fn update_asset_metadata(
        &self,
        id: &str,
        metadata: Option<serde_json::Value>,
    ) -> Result<bool, MemoryError> {
        let normalized_id = id.trim();
        if normalized_id.is_empty() {
            return Err(MemoryError::validation("asset id is required"));
        }

        let table = self.conn.open_table(LOCAL_ASSET_TABLE).execute().await?;
        let batches = table
            .query()
            .only_if(format!("id = '{}'", sql_escape(normalized_id)))
            .limit(1)
            .execute()
            .await?
            .try_collect::<Vec<_>>()
            .await?;

        let batch = match batches.first() {
            Some(batch) if batch.num_rows() > 0 => batch,
            _ => return Ok(false),
        };

        let id_col = as_string_col(batch, "id")?;
        let name_col = as_string_col(batch, "name")?;
        let description_col = as_string_col(batch, "description")?;
        let asset_type_col = as_string_col(batch, "asset_type")?;
        let source_type_col = as_string_col(batch, "source_type")?;
        let pkg_name_col = as_string_col(batch, "pkg_name")?;
        let vector = extract_asset_vector(batch, 0)?;

        self.upsert_asset_into_table(
            LOCAL_ASSET_TABLE,
            id_col.value(0).to_string(),
            name_col.value(0).to_string(),
            description_col.value(0).to_string(),
            asset_type_col.value(0).to_string(),
            source_type_col.value(0).to_string(),
            nullable_string(pkg_name_col, 0),
            vector,
            metadata,
        )
        .await?;

        Ok(true)
    }

    pub async fn upsert_knowledge_chunk_asset(
        &self,
        id: String,
        document_id: String,
        document_name: String,
        content: String,
        chunk_index: i64,
        token_count: i64,
        vector: Vec<f32>,
        metadata: Option<serde_json::Value>,
    ) -> Result<(), MemoryError> {
        let mut merged_meta = metadata.unwrap_or_else(|| serde_json::json!({}));
        if let Some(obj) = merged_meta.as_object_mut() {
            obj.entry("document_id".to_string())
                .or_insert_with(|| serde_json::Value::String(document_id.clone()));
            obj.entry("document_name".to_string())
                .or_insert_with(|| serde_json::Value::String(document_name.clone()));
            obj.entry("chunk_index".to_string())
                .or_insert_with(|| serde_json::Value::from(chunk_index));
            obj.entry("token_count".to_string())
                .or_insert_with(|| serde_json::Value::from(token_count));
        }

        self.upsert_asset_into_table(
            USER_KNOWLEDGE_CHUNK_TABLE,
            id,
            document_name,
            content,
            "knowledge_chunk".to_string(),
            "local_document".to_string(),
            Some(document_id),
            vector,
            Some(merged_meta),
        )
        .await
    }

    async fn upsert_asset_into_table(
        &self,
        table_name: &str,
        id: String,
        name: String,
        description: String,
        asset_type: String,
        source_type: String,
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

        let table = self.conn.open_table(table_name).execute().await?;
        let table_schema = table.schema().await?;
        let expected_dim = local_asset_vector_dimension_from_schema(table_schema.as_ref())
            .ok_or_else(|| {
                MemoryError::validation(format!("{table_name} vector field is missing"))
            })?;
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

        table.delete(&format!("id = '{}'", sql_escape(&id))).await?;
        table
            .add(RecordBatchIterator::new(vec![Ok(batch)], schema))
            .execute()
            .await?;
        Ok(())
    }

    pub async fn recreate_local_asset_table(&self, vector_dim: i32) -> Result<(), MemoryError> {
        self.recreate_asset_table(LOCAL_ASSET_TABLE, vector_dim)
            .await
    }

    pub async fn recreate_knowledge_chunk_table(&self, vector_dim: i32) -> Result<(), MemoryError> {
        self.recreate_asset_table(USER_KNOWLEDGE_CHUNK_TABLE, vector_dim)
            .await
    }

    async fn recreate_asset_table(
        &self,
        table_name: &str,
        vector_dim: i32,
    ) -> Result<(), MemoryError> {
        if vector_dim <= 0 {
            return Err(MemoryError::validation(
                "vector dimension must be greater than zero",
            ));
        }

        let table_names = self.conn.table_names().execute().await?;
        if table_names.iter().any(|name| name == table_name) {
            self.conn.drop_table(table_name, &[]).await?;
        }

        self.conn
            .create_empty_table(table_name, local_asset_schema(vector_dim))
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

    pub async fn delete_knowledge_chunk_assets_by_document_id(
        &self,
        document_id: &str,
    ) -> Result<(), MemoryError> {
        let table_names = self.conn.table_names().execute().await?;
        if !table_names
            .iter()
            .any(|name| name == USER_KNOWLEDGE_CHUNK_TABLE)
        {
            return Ok(());
        }

        let table = self
            .conn
            .open_table(USER_KNOWLEDGE_CHUNK_TABLE)
            .execute()
            .await?;
        table
            .delete(&format!("pkg_name = '{}'", sql_escape(document_id)))
            .await?;
        Ok(())
    }

    pub async fn delete_assets_by_ids(&self, asset_ids: &[String]) -> Result<(), MemoryError> {
        if asset_ids.is_empty() {
            return Ok(());
        }

        let table_names = self.conn.table_names().execute().await?;
        if !table_names.iter().any(|name| name == LOCAL_ASSET_TABLE) {
            return Ok(());
        }

        let table = self.conn.open_table(LOCAL_ASSET_TABLE).execute().await?;
        let predicate = asset_ids
            .iter()
            .map(|asset_id| format!("id = '{}'", sql_escape(asset_id)))
            .collect::<Vec<_>>()
            .join(" OR ");
        table.delete(&predicate).await?;
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
        self.search_assets_in_table(LOCAL_ASSET_TABLE, vector, limit, asset_type, None)
            .await
    }

    pub async fn search_knowledge_chunk_assets(
        &self,
        vector: Vec<f32>,
        limit: usize,
    ) -> Result<Vec<serde_json::Value>, MemoryError> {
        self.search_assets_in_table(USER_KNOWLEDGE_CHUNK_TABLE, vector, limit, None, None)
            .await
    }

    pub async fn search_knowledge_chunk_assets_in_documents(
        &self,
        vector: Vec<f32>,
        limit: usize,
        document_ids: &[String],
    ) -> Result<Vec<serde_json::Value>, MemoryError> {
        let normalized_document_ids = document_ids
            .iter()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>();
        if normalized_document_ids.is_empty() {
            return Ok(Vec::new());
        }

        self.search_assets_in_table(
            USER_KNOWLEDGE_CHUNK_TABLE,
            vector,
            limit,
            None,
            Some(normalized_document_ids.as_slice()),
        )
        .await
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

    async fn search_assets_in_table(
        &self,
        table_name: &str,
        vector: Vec<f32>,
        limit: usize,
        asset_type: Option<&str>,
        package_names: Option<&[String]>,
    ) -> Result<Vec<serde_json::Value>, MemoryError> {
        let table = self.conn.open_table(table_name).execute().await?;
        let mut vector_query = table.vector_search(vector.clone())?.limit(limit);

        if let Some(filter) = build_asset_search_filter_sql(asset_type, package_names) {
            vector_query = vector_query.only_if(filter);
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

        self.search_assets_linear_fallback_in_table(
            table_name,
            vector,
            limit,
            asset_type,
            package_names,
        )
        .await
    }

    async fn search_assets_linear_fallback_in_table(
        &self,
        table_name: &str,
        vector: Vec<f32>,
        limit: usize,
        asset_type: Option<&str>,
        package_names: Option<&[String]>,
    ) -> Result<Vec<serde_json::Value>, MemoryError> {
        let table = self.conn.open_table(table_name).execute().await?;
        let batches = table
            .query()
            .execute()
            .await?
            .try_collect::<Vec<_>>()
            .await?;
        let package_name_filter = package_names.map(|values| {
            values
                .iter()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .collect::<HashSet<_>>()
        });
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
                .ok_or_else(|| {
                    MemoryError::Storage("missing or invalid vector column".to_string())
                })?;
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
                let package_name = nullable_string(pkg_col, row);
                if let Some(expected_package_names) = package_name_filter.as_ref() {
                    let Some(candidate_package_name) = package_name.as_deref().map(str::trim)
                    else {
                        continue;
                    };
                    if !expected_package_names.contains(candidate_package_name) {
                        continue;
                    }
                }
                let start = row.saturating_mul(value_len);
                let end = start.saturating_add(value_len);
                if end > values_col.len() {
                    continue;
                }
                let candidate = (start..end)
                    .map(|idx| {
                        if values_col.is_null(idx) {
                            0.0
                        } else {
                            values_col.value(idx)
                        }
                    })
                    .collect::<Vec<_>>();
                let score = cosine_similarity(&vector, &candidate);
                results.push(serde_json::json!({
                    "id": id_col.value(row),
                    "name": name_col.value(row),
                    "description": desc_col.value(row),
                    "asset_type": asset_type_value,
                    "source_type": s_type_col.value(row),
                    "pkg_name": package_name,
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
        let capability_id = normalize_optional(payload.capability_id);
        let meta_info_json = payload
            .meta_info
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;
        let tags_json = payload
            .tags
            .as_ref()
            .map(|t| serde_json::to_string(t))
            .transpose()?;
        let category = normalize_optional(payload.category);
        let source = normalize_optional(payload.source);

        let id = Uuid::new_v4().to_string();
        let now = now_rfc3339();

        let embedding_dim = self.embedding_dim();
        let schema = local_memory_schema_v3(embedding_dim);
        let null_embedding = build_embedding_array(embedding_dim, None)?;

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec![Some(id.clone())])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![Some(content.clone())])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![session_id.clone()])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![capability_id.clone()])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![meta_info_json.clone()])) as Arc<dyn Array>,
                Arc::new(BooleanArray::from(vec![false])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![Some(now.clone())])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![Some(now.clone())])) as Arc<dyn Array>,
                null_embedding,
                Arc::new(StringArray::from(vec![None as Option<&str>])) as Arc<dyn Array>,
                // V3 fields
                Arc::new(StringArray::from(vec![tags_json.clone()])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![category.clone()])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![source.clone()])) as Arc<dyn Array>,
                Arc::new(Float32Array::from(vec![Some(1.0_f32)])) as Arc<dyn Array>,
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
            capability_id,
            meta_info: payload.meta_info,
            embedding_model: None,
            category,
            source,
            tags: payload.tags,
            vitality: Some(1.0),
            last_accessed_at: None,
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
        let capability_id = normalize_optional(query.capability_id);

        let where_clause = build_filter_sql(session_id.as_deref(), capability_id.as_deref(), true);
        let table = self.table().await?;
        let mut stmt = table.query().select(Select::columns(&[
            "id",
            "content",
            "session_id",
            "capability_id",
            "meta_info_json",
            "embedding_model",
            "tags_json",
            "category",
            "source",
            "vitality",
            "last_accessed_at",
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

    pub async fn get(&self, id: &str) -> Result<Option<LocalMemoryItem>, MemoryError> {
        let normalized_id = id.trim();
        if normalized_id.is_empty() {
            return Err(MemoryError::validation("id is required"));
        }

        let batches = self
            .table()
            .await?
            .query()
            .only_if(format!(
                "id = '{}' AND is_deleted = false",
                sql_escape(normalized_id)
            ))
            .limit(1)
            .execute()
            .await?
            .try_collect::<Vec<_>>()
            .await?;

        let Some(batch) = batches.first() else {
            return Ok(None);
        };
        let mut items = read_items_from_batch(batch)?;
        Ok(items.pop())
    }

    pub async fn list_all_memories(&self) -> Result<Vec<LocalMemoryItem>, MemoryError> {
        let batches = self
            .table()
            .await?
            .query()
            .only_if("is_deleted = false")
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

    pub async fn recreate_local_memory_table(&self, vector_dim: i32) -> Result<(), MemoryError> {
        if vector_dim <= 0 {
            return Err(MemoryError::validation(
                "vector dimension must be greater than zero",
            ));
        }

        let table_names = self.conn.table_names().execute().await?;
        if table_names.iter().any(|name| name == LOCAL_MEMORY_TABLE) {
            self.conn.drop_table(LOCAL_MEMORY_TABLE, &[]).await?;
        }

        self.conn
            .create_empty_table(LOCAL_MEMORY_TABLE, local_memory_schema_v3(vector_dim))
            .execute()
            .await?;

        self.embedding_dim
            .store(vector_dim, AtomicOrdering::Relaxed);
        Ok(())
    }

    pub async fn insert_memory_record(
        &self,
        item: &LocalMemoryItem,
        embedding: Option<Vec<f32>>,
        embedding_model: Option<String>,
    ) -> Result<(), MemoryError> {
        let embedding_dim = self.embedding_dim();
        let meta_info_json = item
            .meta_info
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;
        let tags_json = item.tags.as_ref().map(serde_json::to_string).transpose()?;
        let embedding_col = build_embedding_array(embedding_dim, embedding)?;
        let schema = local_memory_schema_v3(embedding_dim);
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec![Some(item.id.clone())])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![Some(item.content.clone())])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![item.session_id.clone()])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![item.capability_id.clone()])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![meta_info_json])) as Arc<dyn Array>,
                Arc::new(BooleanArray::from(vec![false])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![Some(item.created_at.clone())])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![Some(item.updated_at.clone())])) as Arc<dyn Array>,
                embedding_col,
                Arc::new(StringArray::from(vec![
                    embedding_model.or_else(|| item.embedding_model.clone())
                ])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![tags_json])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![item.category.clone()])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![item.source.clone()])) as Arc<dyn Array>,
                Arc::new(Float32Array::from(vec![item.vitality.unwrap_or(1.0)])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![item.last_accessed_at.clone()])) as Arc<dyn Array>,
            ],
        )?;

        self.table()
            .await?
            .add(RecordBatchIterator::new(
                vec![Ok(batch)].into_iter(),
                schema,
            ))
            .execute()
            .await?;

        Ok(())
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
        let capability_id = normalize_optional(payload.capability_id);
        let where_clause = build_filter_sql(session_id.as_deref(), capability_id.as_deref(), true);
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
        let capability_id = normalize_optional(payload.capability_id);
        let meta_info_json = payload
            .meta_info
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;
        let tags_json = payload
            .tags
            .as_ref()
            .map(|t| serde_json::to_string(t))
            .transpose()?;
        let category = normalize_optional(payload.category);
        let source = normalize_optional(payload.source);

        let id = Uuid::new_v4().to_string();
        let now = now_rfc3339();

        let embedding_opts: Vec<Option<f32>> = embedding.into_iter().map(Some).collect();
        let vec_dim = i32::try_from(embedding_opts.len())
            .map_err(|_| MemoryError::validation("embedding dimension too large"))?;
        let embedding_dim = self.embedding_dim();
        if vec_dim != embedding_dim {
            return Err(MemoryError::validation(format!(
                "embedding dimension mismatch: expected {}, got {}",
                embedding_dim, vec_dim
            )));
        }

        let schema = local_memory_schema_v3(embedding_dim);
        let embedding_col = build_embedding_array(
            embedding_dim,
            Some(embedding_opts.into_iter().flatten().collect()),
        )?;

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec![Some(id.clone())])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![Some(content.clone())])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![session_id.clone()])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![capability_id.clone()])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![meta_info_json.clone()])) as Arc<dyn Array>,
                Arc::new(BooleanArray::from(vec![false])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![Some(now.clone())])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![Some(now.clone())])) as Arc<dyn Array>,
                embedding_col,
                Arc::new(StringArray::from(vec![embedding_model.clone()])) as Arc<dyn Array>,
                // V3 fields
                Arc::new(StringArray::from(vec![tags_json.clone()])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![category.clone()])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![source.clone()])) as Arc<dyn Array>,
                Arc::new(Float32Array::from(vec![Some(1.0_f32)])) as Arc<dyn Array>,
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
            capability_id,
            meta_info: payload.meta_info,
            embedding_model,
            category,
            source,
            tags: payload.tags,
            vitality: Some(1.0),
            last_accessed_at: None,
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
        capability_id: Option<&str>,
        category: Option<&str>,
        source: Option<&str>,
        tags: Option<&[String]>,
    ) -> Result<Vec<LocalMemorySearchItem>, MemoryError> {
        let filter =
            build_memory_search_filter_sql(session_id, capability_id, category, source, tags, true);
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
                log::warn!(
                    "memory vector search unavailable, falling back to linear: {}",
                    e
                );
            }
        }

        // Linear fallback: scan all rows with embeddings, compute cosine similarity
        self.search_memories_linear_fallback(
            query_embedding,
            limit,
            session_id,
            capability_id,
            category,
            source,
            tags,
        )
        .await
    }

    pub(crate) async fn search_memories_for_write_guard(
        &self,
        query_embedding: Vec<f32>,
        limit: usize,
        session_id: Option<&str>,
        capability_id: Option<&str>,
        category: Option<&str>,
        source: Option<&str>,
        tags: Option<&[String]>,
    ) -> Result<Vec<WriteGuardCandidate>, MemoryError> {
        let filter =
            build_memory_search_filter_sql(session_id, capability_id, category, source, tags, true);
        let table = self.table().await?;

        let mut vector_query = table.vector_search(query_embedding.clone())?.limit(limit);
        if !filter.is_empty() {
            vector_query = vector_query.only_if(filter.clone());
        }

        match vector_query.execute().await {
            Ok(stream) => {
                let batches = stream.try_collect::<Vec<_>>().await?;
                match read_write_guard_candidate_batches(&batches, &query_embedding) {
                    Ok(results) if !results.is_empty() => return Ok(results),
                    Ok(_) => {}
                    Err(error) => {
                        log::warn!(
                            "write guard exact rerank unavailable from vector batches, falling back to linear: {}",
                            error
                        );
                    }
                }
            }
            Err(e) => {
                log::warn!(
                    "write guard vector search unavailable, falling back to linear: {}",
                    e
                );
            }
        }

        self.search_memories_for_write_guard_linear_fallback(
            query_embedding,
            limit,
            session_id,
            capability_id,
            category,
            source,
            tags,
        )
        .await
    }

    async fn search_memories_linear_fallback(
        &self,
        query_embedding: Vec<f32>,
        limit: usize,
        session_id: Option<&str>,
        capability_id: Option<&str>,
        category: Option<&str>,
        source: Option<&str>,
        tags: Option<&[String]>,
    ) -> Result<Vec<LocalMemorySearchItem>, MemoryError> {
        let filter =
            build_memory_search_filter_sql(session_id, capability_id, category, source, tags, true);
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
            let assistant_col = as_string_col(batch, "capability_id")?;
            let meta_col = as_string_col(batch, "meta_info_json")?;
            let created_col = as_string_col(batch, "created_at")?;
            let updated_col = as_string_col(batch, "updated_at")?;
            let category_col = batch
                .column_by_name("category")
                .and_then(|c| c.as_any().downcast_ref::<StringArray>());
            let source_col = batch
                .column_by_name("source")
                .and_then(|c| c.as_any().downcast_ref::<StringArray>());
            let tags_col = batch
                .column_by_name("tags_json")
                .and_then(|c| c.as_any().downcast_ref::<StringArray>());
            let vitality_col = batch
                .column_by_name("vitality")
                .and_then(|c| c.as_any().downcast_ref::<Float32Array>());
            let last_accessed_col = batch
                .column_by_name("last_accessed_at")
                .and_then(|c| c.as_any().downcast_ref::<StringArray>());

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
                    .map(|idx| {
                        if values_col.is_null(idx) {
                            0.0
                        } else {
                            values_col.value(idx)
                        }
                    })
                    .collect();
                let score = cosine_similarity(&query_embedding, &candidate);

                let meta_info = nullable_string(meta_col, row)
                    .map(|raw| serde_json::from_str(&raw))
                    .transpose()?;
                let category = category_col.and_then(|col| nullable_string(col, row));
                let source = source_col.and_then(|col| nullable_string(col, row));
                let tags = tags_col
                    .and_then(|col| nullable_string(col, row))
                    .and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok());
                let vitality = vitality_col.and_then(|col| {
                    if col.is_null(row) {
                        None
                    } else {
                        Some(col.value(row))
                    }
                });
                let last_accessed_at = last_accessed_col.and_then(|col| nullable_string(col, row));

                results.push(LocalMemorySearchItem {
                    id: required_string(id_col, row, "id")?,
                    content: required_string(content_col, row, "content")?,
                    session_id: nullable_string(session_col, row),
                    capability_id: nullable_string(assistant_col, row),
                    meta_info,
                    score,
                    category,
                    source,
                    tags,
                    vitality,
                    last_accessed_at,
                    created_at: required_string(created_col, row, "created_at")?,
                    updated_at: required_string(updated_col, row, "updated_at")?,
                });
            }
        }

        results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(Ordering::Equal));
        if results.len() > limit {
            results.truncate(limit);
        }
        Ok(results)
    }

    async fn search_memories_for_write_guard_linear_fallback(
        &self,
        query_embedding: Vec<f32>,
        limit: usize,
        session_id: Option<&str>,
        capability_id: Option<&str>,
        category: Option<&str>,
        source: Option<&str>,
        tags: Option<&[String]>,
    ) -> Result<Vec<WriteGuardCandidate>, MemoryError> {
        let filter =
            build_memory_search_filter_sql(session_id, capability_id, category, source, tags, true);
        let table = self.table().await?;
        let mut stmt = table.query();
        if !filter.is_empty() {
            stmt = stmt.only_if(filter);
        }
        let batches = stmt.execute().await?.try_collect::<Vec<_>>().await?;
        let mut results = read_write_guard_candidate_batches(&batches, &query_embedding)?;
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
        let assistant_col = as_string_col(batch, "capability_id")?;
        let meta_col = as_string_col(batch, "meta_info_json")?;
        let deleted_col = batch
            .column_by_name("is_deleted")
            .and_then(|c| c.as_any().downcast_ref::<BooleanArray>())
            .ok_or_else(|| MemoryError::Storage("missing is_deleted column".into()))?;
        let created_col = as_string_col(batch, "created_at")?;

        // Read V3 columns (may be absent on older schemas, default gracefully)
        let tags_col = batch
            .column_by_name("tags_json")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());
        let category_col = batch
            .column_by_name("category")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());
        let source_col = batch
            .column_by_name("source")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());
        let vitality_col = batch
            .column_by_name("vitality")
            .and_then(|c| c.as_any().downcast_ref::<Float32Array>());
        let last_accessed_col = batch
            .column_by_name("last_accessed_at")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());

        let embedding_dim = self.embedding_dim();
        let schema = local_memory_schema_v3(embedding_dim);
        let embedding_arr = build_embedding_array(embedding_dim, Some(embedding))?;

        let now = now_rfc3339();
        let new_batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec![Some(id_col.value(0).to_string())]))
                    as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![Some(
                    content_col.value(0).to_string(),
                )])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![nullable_string(session_col, 0)]))
                    as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![nullable_string(assistant_col, 0)]))
                    as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![nullable_string(meta_col, 0)])) as Arc<dyn Array>,
                Arc::new(BooleanArray::from(vec![deleted_col.value(0)])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![Some(
                    created_col.value(0).to_string(),
                )])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![Some(now)])) as Arc<dyn Array>,
                embedding_arr,
                Arc::new(StringArray::from(vec![embedding_model])) as Arc<dyn Array>,
                // V3 fields preserved
                Arc::new(StringArray::from(vec![
                    tags_col.and_then(|c| nullable_string(c, 0))
                ])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![
                    category_col.and_then(|c| nullable_string(c, 0))
                ])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![
                    source_col.and_then(|c| nullable_string(c, 0))
                ])) as Arc<dyn Array>,
                Arc::new(Float32Array::from(vec![vitality_col
                    .map(|c| if c.is_null(0) { 1.0 } else { c.value(0) })
                    .unwrap_or(1.0)])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![
                    last_accessed_col.and_then(|c| nullable_string(c, 0))
                ])) as Arc<dyn Array>,
            ],
        )?;

        // Delete old row, insert updated row
        table.delete(&format!("id = '{}'", sql_escape(id))).await?;
        table
            .add(RecordBatchIterator::new(
                vec![Ok(new_batch)].into_iter(),
                schema,
            ))
            .execute()
            .await?;

        Ok(true)
    }

    /// Find the single most similar memory by embedding vector (for Write Guard).
    /// Returns (id, content, similarity_score) of the best match, or None.
    pub async fn find_top1_similar(
        &self,
        query_embedding: Vec<f32>,
        session_id: Option<&str>,
        capability_id: Option<&str>,
    ) -> Result<Option<(String, String, f32)>, MemoryError> {
        Ok(self
            .search_memories_for_write_guard(
                query_embedding,
                1,
                session_id,
                capability_id,
                None,
                None,
                None,
            )
            .await?
            .into_iter()
            .next()
            .map(|candidate| (candidate.id, candidate.content, candidate.exact_score)))
    }

    /// Update a memory's content (for Write Guard UPDATE action).
    /// Performs delete + re-insert with merged content.
    pub async fn update_memory_content(
        &self,
        id: &str,
        new_content: &str,
        new_embedding: Option<Vec<f32>>,
        embedding_model: Option<String>,
    ) -> Result<Option<LocalMemoryItem>, MemoryError> {
        self.update_memory(
            id,
            UpdateLocalMemoryRequest {
                content: new_content.to_string(),
                meta_info: None,
                category: None,
                source: None,
                tags: None,
            },
            new_embedding,
            embedding_model,
        )
        .await
    }

    pub async fn update_memory(
        &self,
        id: &str,
        payload: UpdateLocalMemoryRequest,
        new_embedding: Option<Vec<f32>>,
        embedding_model: Option<String>,
    ) -> Result<Option<LocalMemoryItem>, MemoryError> {
        let table = self.table().await?;
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
            _ => return Ok(None),
        };

        let id_col = as_string_col(batch, "id")?;
        let session_col = as_string_col(batch, "session_id")?;
        let assistant_col = as_string_col(batch, "capability_id")?;
        let meta_col = as_string_col(batch, "meta_info_json")?;
        let deleted_col = batch
            .column_by_name("is_deleted")
            .and_then(|c| c.as_any().downcast_ref::<BooleanArray>())
            .ok_or_else(|| MemoryError::Storage("missing is_deleted column".into()))?;
        let created_col = as_string_col(batch, "created_at")?;
        let tags_col = batch
            .column_by_name("tags_json")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());
        let category_col = batch
            .column_by_name("category")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());
        let source_col = batch
            .column_by_name("source")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());
        let vitality_col = batch
            .column_by_name("vitality")
            .and_then(|c| c.as_any().downcast_ref::<Float32Array>());
        let last_accessed_col = batch
            .column_by_name("last_accessed_at")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());

        let content = payload.content.trim().to_string();
        if content.is_empty() {
            return Err(MemoryError::validation("content is required"));
        }

        let now = now_rfc3339();
        let embedding_dim = self.embedding_dim();
        let schema = local_memory_schema_v3(embedding_dim);

        let embedding_arr = build_embedding_array(embedding_dim, new_embedding)?;

        let row_id = id_col.value(0).to_string();
        let session_id = nullable_string(session_col, 0);
        let capability_id = nullable_string(assistant_col, 0);
        let existing_meta_raw = nullable_string(meta_col, 0);
        let meta_raw = payload
            .meta_info
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?
            .or(existing_meta_raw.clone());
        let meta_info: Option<serde_json::Value> =
            meta_raw.as_deref().map(serde_json::from_str).transpose()?;
        let tags_raw = tags_col.and_then(|c| nullable_string(c, 0));
        let tags: Option<Vec<String>> = tags_raw
            .as_deref()
            .and_then(|raw| serde_json::from_str(raw).ok());
        let tags = payload.tags.clone().or(tags);
        let category = normalize_optional(payload.category)
            .or_else(|| category_col.and_then(|c| nullable_string(c, 0)));
        let source = normalize_optional(payload.source)
            .or_else(|| source_col.and_then(|c| nullable_string(c, 0)));
        let vitality = vitality_col
            .map(|c| if c.is_null(0) { 1.0 } else { c.value(0) })
            .unwrap_or(1.0);
        let last_accessed_at = last_accessed_col.and_then(|c| nullable_string(c, 0));
        let created_at = created_col.value(0).to_string();
        let tags_json = tags.as_ref().map(serde_json::to_string).transpose()?;

        let new_batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec![Some(row_id.clone())])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![Some(content.clone())])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![session_id.clone()])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![capability_id.clone()])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![meta_raw])) as Arc<dyn Array>,
                Arc::new(BooleanArray::from(vec![deleted_col.value(0)])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![Some(created_at.clone())])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![Some(now.clone())])) as Arc<dyn Array>,
                embedding_arr,
                Arc::new(StringArray::from(vec![embedding_model.clone()])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![tags_json])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![category.clone()])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![source.clone()])) as Arc<dyn Array>,
                Arc::new(Float32Array::from(vec![vitality])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![last_accessed_at.clone()])) as Arc<dyn Array>,
            ],
        )?;

        table.delete(&format!("id = '{}'", sql_escape(id))).await?;
        table
            .add(RecordBatchIterator::new(
                vec![Ok(new_batch)].into_iter(),
                schema,
            ))
            .execute()
            .await?;

        Ok(Some(LocalMemoryItem {
            id: row_id,
            content,
            session_id,
            capability_id,
            meta_info,
            embedding_model,
            category,
            source,
            tags,
            vitality: Some(vitality),
            last_accessed_at,
            created_at,
            updated_at: now,
        }))
    }

    /// Batch-update vitality and last_accessed_at for a set of memory IDs.
    pub async fn update_vitality_batch(
        &self,
        updates: &[(String, f32)], // (id, new_vitality)
    ) -> Result<usize, MemoryError> {
        if updates.is_empty() {
            return Ok(0);
        }
        let table = self.table().await?;
        let now = now_rfc3339();
        let mut count = 0usize;

        for (id, new_vitality) in updates {
            let affected = table
                .update()
                .only_if(format!("id = '{}' AND is_deleted = false", sql_escape(id)))
                .column("vitality", format!("{}", new_vitality))
                .column("last_accessed_at", format!("'{}'", sql_escape(&now)))
                .execute()
                .await?;
            if affected.rows_updated > 0 {
                count += 1;
            }
        }
        Ok(count)
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
        Field::new("capability_id", DataType::Utf8, true),
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

/// V3 schema: V2 + tags_json, category, source, vitality, last_accessed_at.
pub(crate) fn local_memory_schema_v3(embedding_dim: i32) -> SchemaRef {
    Arc::new(Schema::new(vec![
        Field::new("id", DataType::Utf8, false),
        Field::new("content", DataType::Utf8, false),
        Field::new("session_id", DataType::Utf8, true),
        Field::new("capability_id", DataType::Utf8, true),
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
        // V3 fields
        Field::new("tags_json", DataType::Utf8, true),
        Field::new("category", DataType::Utf8, true),
        Field::new("source", DataType::Utf8, true),
        Field::new("vitality", DataType::Float32, true),
        Field::new("last_accessed_at", DataType::Utf8, true),
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

fn local_memory_embedding_dimension_from_schema(schema: &Schema) -> Option<i32> {
    schema
        .field_with_name("embedding")
        .ok()
        .and_then(|field| match field.data_type() {
            DataType::FixedSizeList(_, size) => Some(*size),
            _ => None,
        })
}

fn build_filter_sql(
    session_id: Option<&str>,
    capability_id: Option<&str>,
    include_not_deleted: bool,
) -> String {
    let mut clauses = Vec::new();
    if include_not_deleted {
        clauses.push("is_deleted = false".to_string());
    }
    if let Some(session) = session_id {
        clauses.push(format!("session_id = '{}'", sql_escape(session)));
    }
    if let Some(assistant) = capability_id {
        clauses.push(format!("capability_id = '{}'", sql_escape(assistant)));
    }
    clauses.join(" AND ")
}

fn build_memory_search_filter_sql(
    session_id: Option<&str>,
    capability_id: Option<&str>,
    category: Option<&str>,
    source: Option<&str>,
    tags: Option<&[String]>,
    include_not_deleted: bool,
) -> String {
    let mut clauses = Vec::new();
    let base = build_filter_sql(session_id, capability_id, include_not_deleted);
    if !base.is_empty() {
        clauses.push(base);
    }
    if let Some(category) = category.map(str::trim).filter(|value| !value.is_empty()) {
        clauses.push(format!("category = '{}'", sql_escape(category)));
    }
    if let Some(source) = source.map(str::trim).filter(|value| !value.is_empty()) {
        clauses.push(format!("source = '{}'", sql_escape(source)));
    }
    if let Some(tags) = tags {
        let tag_clauses: Vec<String> = tags
            .iter()
            .map(|tag| tag.trim())
            .filter(|tag| !tag.is_empty())
            .map(|tag| {
                let needle = format!("\"{}\"", tag);
                format!("tags_json LIKE '%{}%'", sql_escape(&needle))
            })
            .collect();
        if !tag_clauses.is_empty() {
            clauses.push(format!("({})", tag_clauses.join(" OR ")));
        }
    }
    clauses.join(" AND ")
}

fn build_embedding_array(
    embedding_dim: i32,
    embedding: Option<Vec<f32>>,
) -> Result<Arc<dyn Array>, MemoryError> {
    match embedding {
        Some(embedding) => {
            let vec_dim = i32::try_from(embedding.len())
                .map_err(|_| MemoryError::validation("embedding dimension too large"))?;
            if vec_dim != embedding_dim {
                return Err(MemoryError::validation(format!(
                    "embedding dimension mismatch: expected {}, got {}",
                    embedding_dim, vec_dim
                )));
            }

            Ok(Arc::new(FixedSizeListArray::from_iter_primitive::<
                arrow_array::types::Float32Type,
                _,
                _,
            >(
                vec![Some(embedding.into_iter().map(Some).collect::<Vec<_>>())],
                embedding_dim,
            )) as Arc<dyn Array>)
        }
        None => Ok(arrow_array::new_null_array(
            &DataType::FixedSizeList(
                Arc::new(Field::new("item", DataType::Float32, true)),
                embedding_dim,
            ),
            1,
        )),
    }
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

/// Extract (id, content, similarity_score) from vector search result batches.
#[allow(dead_code)]
fn extract_top1_from_batches(
    batches: &[RecordBatch],
) -> Result<Option<(String, String, f32)>, MemoryError> {
    for batch in batches {
        if batch.num_rows() == 0 {
            continue;
        }
        let id_col = as_string_col(batch, "id")?;
        let content_col = as_string_col(batch, "content")?;
        let distance = batch
            .column_by_name("_distance")
            .and_then(|c| c.as_any().downcast_ref::<Float32Array>())
            .map(|c| c.value(0))
            .unwrap_or(0.0);
        let score = 1.0 / (1.0 + distance);
        return Ok(Some((
            required_string(id_col, 0, "id")?,
            required_string(content_col, 0, "content")?,
            score,
        )));
    }
    Ok(None)
}

fn read_write_guard_candidate_batches(
    batches: &[RecordBatch],
    query_embedding: &[f32],
) -> Result<Vec<WriteGuardCandidate>, MemoryError> {
    let mut results = Vec::new();
    for batch in batches {
        let id_col = as_string_col(batch, "id")?;
        let content_col = as_string_col(batch, "content")?;
        let session_col = as_string_col(batch, "session_id")?;
        let assistant_col = as_string_col(batch, "capability_id")?;
        let meta_col = as_string_col(batch, "meta_info_json")?;
        let created_col = as_string_col(batch, "created_at")?;
        let updated_col = as_string_col(batch, "updated_at")?;
        let category_col = batch
            .column_by_name("category")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());
        let source_col = batch
            .column_by_name("source")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());
        let tags_col = batch
            .column_by_name("tags_json")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());
        let vitality_col = batch
            .column_by_name("vitality")
            .and_then(|c| c.as_any().downcast_ref::<Float32Array>());
        let last_accessed_col = batch
            .column_by_name("last_accessed_at")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());

        for row in 0..batch.num_rows() {
            let candidate = extract_memory_embedding(batch, row)?;
            let exact_score = cosine_similarity(query_embedding, &candidate);
            let meta_info = nullable_string(meta_col, row)
                .map(|raw| serde_json::from_str(&raw))
                .transpose()?;
            let category = category_col.and_then(|col| nullable_string(col, row));
            let source = source_col.and_then(|col| nullable_string(col, row));
            let tags = tags_col
                .and_then(|col| nullable_string(col, row))
                .and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok());
            let vitality = vitality_col.and_then(|col| {
                if col.is_null(row) {
                    None
                } else {
                    Some(col.value(row))
                }
            });
            let last_accessed_at = last_accessed_col.and_then(|col| nullable_string(col, row));

            results.push(WriteGuardCandidate {
                id: required_string(id_col, row, "id")?,
                content: required_string(content_col, row, "content")?,
                session_id: nullable_string(session_col, row),
                capability_id: nullable_string(assistant_col, row),
                meta_info,
                category,
                source,
                tags,
                vitality,
                last_accessed_at,
                created_at: required_string(created_col, row, "created_at")?,
                updated_at: required_string(updated_col, row, "updated_at")?,
                exact_score,
            });
        }
    }

    results.sort_by(|left, right| {
        right
            .exact_score
            .partial_cmp(&left.exact_score)
            .unwrap_or(Ordering::Equal)
    });
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

fn extract_memory_embedding(batch: &RecordBatch, row: usize) -> Result<Vec<f32>, MemoryError> {
    let embedding_col = batch
        .column_by_name("embedding")
        .and_then(|c| c.as_any().downcast_ref::<FixedSizeListArray>())
        .ok_or_else(|| MemoryError::Storage("missing or invalid embedding column".into()))?;
    if embedding_col.is_null(row) {
        return Err(MemoryError::Storage("embedding column is null".into()));
    }
    let values_col = embedding_col
        .values()
        .as_any()
        .downcast_ref::<Float32Array>()
        .ok_or_else(|| MemoryError::Storage("invalid embedding values column".into()))?;
    let value_len = usize::try_from(embedding_col.value_length())
        .map_err(|_| MemoryError::Storage("invalid embedding value length".into()))?;
    let start = row.saturating_mul(value_len);
    let end = start.saturating_add(value_len);
    if end > values_col.len() {
        return Err(MemoryError::Storage(
            "embedding vector length exceeds values column".into(),
        ));
    }
    Ok((start..end)
        .map(|idx| {
            if values_col.is_null(idx) {
                0.0
            } else {
                values_col.value(idx)
            }
        })
        .collect())
}

fn extract_asset_vector(batch: &RecordBatch, row: usize) -> Result<Vec<f32>, MemoryError> {
    let vector_col = batch
        .column_by_name("vector")
        .and_then(|c| c.as_any().downcast_ref::<FixedSizeListArray>())
        .ok_or_else(|| MemoryError::Storage("missing or invalid vector column".into()))?;
    if vector_col.is_null(row) {
        return Err(MemoryError::Storage("asset vector column is null".into()));
    }
    let values_col = vector_col
        .values()
        .as_any()
        .downcast_ref::<Float32Array>()
        .ok_or_else(|| MemoryError::Storage("invalid asset vector values column".into()))?;
    let value_len = usize::try_from(vector_col.value_length())
        .map_err(|_| MemoryError::Storage("invalid asset vector value length".into()))?;
    let start = row.saturating_mul(value_len);
    let end = start.saturating_add(value_len);
    if end > values_col.len() {
        return Err(MemoryError::Storage(
            "asset vector length exceeds values column".into(),
        ));
    }
    Ok((start..end)
        .map(|idx| {
            if values_col.is_null(idx) {
                0.0
            } else {
                values_col.value(idx)
            }
        })
        .collect())
}

fn build_asset_search_filter_sql(
    asset_type: Option<&str>,
    package_names: Option<&[String]>,
) -> Option<String> {
    let mut clauses = Vec::new();

    if let Some(value) = asset_type.map(str::trim).filter(|value| !value.is_empty()) {
        clauses.push(format!("asset_type = '{}'", sql_escape(value)));
    }

    if let Some(values) = package_names {
        let normalized_values = values
            .iter()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .map(|value| format!("'{}'", sql_escape(value)))
            .collect::<Vec<_>>();
        if !normalized_values.is_empty() {
            clauses.push(format!("pkg_name IN ({})", normalized_values.join(", ")));
        }
    }

    (!clauses.is_empty()).then(|| clauses.join(" AND "))
}

fn read_items_from_batch(batch: &RecordBatch) -> Result<Vec<LocalMemoryItem>, MemoryError> {
    let id_col = as_string_col(batch, "id")?;
    let content_col = as_string_col(batch, "content")?;
    let session_col = as_string_col(batch, "session_id")?;
    let assistant_col = as_string_col(batch, "capability_id")?;
    let meta_col = as_string_col(batch, "meta_info_json")?;
    let created_col = as_string_col(batch, "created_at")?;
    let updated_col = as_string_col(batch, "updated_at")?;
    // Optional columns (may not be present in older schemas or selected columns)
    let model_col = batch
        .column_by_name("embedding_model")
        .and_then(|c| c.as_any().downcast_ref::<StringArray>());
    let tags_col = batch
        .column_by_name("tags_json")
        .and_then(|c| c.as_any().downcast_ref::<StringArray>());
    let category_col = batch
        .column_by_name("category")
        .and_then(|c| c.as_any().downcast_ref::<StringArray>());
    let source_col = batch
        .column_by_name("source")
        .and_then(|c| c.as_any().downcast_ref::<StringArray>());
    let vitality_col = batch
        .column_by_name("vitality")
        .and_then(|c| c.as_any().downcast_ref::<Float32Array>());
    let last_accessed_col = batch
        .column_by_name("last_accessed_at")
        .and_then(|c| c.as_any().downcast_ref::<StringArray>());

    let mut items = Vec::with_capacity(batch.num_rows());
    for row in 0..batch.num_rows() {
        let meta_info = nullable_string(meta_col, row)
            .map(|raw| serde_json::from_str(&raw))
            .transpose()?;
        let embedding_model = model_col.and_then(|col| nullable_string(col, row));
        let tags = tags_col
            .and_then(|col| nullable_string(col, row))
            .and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok());
        let category = category_col.and_then(|col| nullable_string(col, row));
        let source = source_col.and_then(|col| nullable_string(col, row));
        let vitality = vitality_col.and_then(|col| {
            if col.is_null(row) {
                None
            } else {
                Some(col.value(row))
            }
        });
        let last_accessed_at = last_accessed_col.and_then(|col| nullable_string(col, row));

        items.push(LocalMemoryItem {
            id: required_string(id_col, row, "id")?,
            content: required_string(content_col, row, "content")?,
            session_id: nullable_string(session_col, row),
            capability_id: nullable_string(assistant_col, row),
            meta_info,
            embedding_model,
            category,
            source,
            tags,
            vitality,
            last_accessed_at,
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
) -> Result<Vec<LocalMemorySearchItem>, MemoryError> {
    let mut results = Vec::new();
    for batch in batches {
        let id_col = as_string_col(batch, "id")?;
        let content_col = as_string_col(batch, "content")?;
        let session_col = as_string_col(batch, "session_id")?;
        let assistant_col = as_string_col(batch, "capability_id")?;
        let meta_col = as_string_col(batch, "meta_info_json")?;
        let created_col = as_string_col(batch, "created_at")?;
        let updated_col = as_string_col(batch, "updated_at")?;
        let score_col = batch.column_by_name("_distance");
        let category_col = batch
            .column_by_name("category")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());
        let source_col = batch
            .column_by_name("source")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());
        let tags_col = batch
            .column_by_name("tags_json")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());
        let vitality_col = batch
            .column_by_name("vitality")
            .and_then(|c| c.as_any().downcast_ref::<Float32Array>());
        let last_accessed_col = batch
            .column_by_name("last_accessed_at")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());

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
            let category = category_col.and_then(|col| nullable_string(col, row));
            let source = source_col.and_then(|col| nullable_string(col, row));
            let tags = tags_col
                .and_then(|col| nullable_string(col, row))
                .and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok());
            let vitality = vitality_col.and_then(|col| {
                if col.is_null(row) {
                    None
                } else {
                    Some(col.value(row))
                }
            });
            let last_accessed_at = last_accessed_col.and_then(|col| nullable_string(col, row));

            results.push(LocalMemorySearchItem {
                id: required_string(id_col, row, "id")?,
                content: required_string(content_col, row, "content")?,
                session_id: nullable_string(session_col, row),
                capability_id: nullable_string(assistant_col, row),
                meta_info,
                score,
                category,
                source,
                tags,
                vitality,
                last_accessed_at,
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

#[cfg(test)]
mod tests {
    use super::*;

    fn test_path(label: &str) -> String {
        let path =
            std::env::temp_dir().join(format!("deeting-memory-{}-{}", label, uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).expect("create temp dir");
        path.to_string_lossy().into_owned()
    }

    async fn create_test_store() -> MemoryStore {
        let uri = test_path("store");
        let store = MemoryStore::new(&uri).await.expect("create store");
        store.init().await.expect("init store");
        store
    }

    fn test_embedding() -> Vec<f32> {
        let mut embedding = vec![0.0; DEFAULT_MEMORY_EMBEDDING_DIM as usize];
        embedding[0] = 0.9;
        embedding[1] = 0.1;
        embedding
    }

    fn test_embedding_with_dim(dim: usize) -> Vec<f32> {
        let mut embedding = vec![0.0; dim];
        embedding[0] = 0.9;
        if dim > 1 {
            embedding[1] = 0.1;
        }
        embedding
    }

    #[test]
    fn build_asset_search_filter_sql_combines_asset_type_and_package_names() {
        let package_names = vec!["doc-1".to_string(), "doc-2".to_string()];
        let filter = build_asset_search_filter_sql(Some("knowledge_chunk"), Some(&package_names))
            .expect("filter");

        assert_eq!(
            filter,
            "asset_type = 'knowledge_chunk' AND pkg_name IN ('doc-1', 'doc-2')"
        );
    }

    #[tokio::test]
    async fn search_memories_applies_category_source_and_tag_filters() {
        let store = create_test_store().await;

        store
            .append_with_embedding(
                CreateLocalMemoryRequest {
                    content: "likes black coffee".into(),
                    session_id: None,
                    capability_id: None,
                    meta_info: None,
                    category: Some("preference".into()),
                    source: Some("manual".into()),
                    tags: Some(vec!["coffee".into(), "taste".into()]),
                },
                test_embedding(),
                Some("test".into()),
            )
            .await
            .expect("append matching memory");

        store
            .append_with_embedding(
                CreateLocalMemoryRequest {
                    content: "visited office".into(),
                    session_id: None,
                    capability_id: None,
                    meta_info: None,
                    category: Some("event".into()),
                    source: Some("auto_extraction".into()),
                    tags: Some(vec!["travel".into()]),
                },
                test_embedding(),
                Some("test".into()),
            )
            .await
            .expect("append non matching memory");

        let tags = vec!["coffee".to_string()];
        let results = store
            .search_memories(
                test_embedding(),
                5,
                None,
                None,
                Some("preference"),
                Some("manual"),
                Some(tags.as_slice()),
            )
            .await
            .expect("search memories");

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].category.as_deref(), Some("preference"));
        assert_eq!(results[0].source.as_deref(), Some("manual"));
        assert_eq!(
            results[0].tags.as_ref(),
            Some(&vec!["coffee".to_string(), "taste".to_string()])
        );
    }

    #[tokio::test]
    async fn recreate_local_memory_table_updates_dimension_and_preserves_reinserted_rows() {
        let store = create_test_store().await;
        let original = store
            .append(CreateLocalMemoryRequest {
                content: "prefers pour over".into(),
                session_id: None,
                capability_id: None,
                meta_info: Some(serde_json::json!({"source": "chat"})),
                category: Some("preference".into()),
                source: Some("manual".into()),
                tags: Some(vec!["coffee".into(), "brew".into()]),
            })
            .await
            .expect("append memory");

        let exported = store.list_all_memories().await.expect("list memories");
        assert_eq!(exported.len(), 1);

        store
            .recreate_local_memory_table(4)
            .await
            .expect("recreate memory table");
        store
            .insert_memory_record(
                &exported[0],
                Some(test_embedding_with_dim(4)),
                Some("rebuild".into()),
            )
            .await
            .expect("reinsert memory");

        let restored = store
            .get(&original.id)
            .await
            .expect("fetch restored memory")
            .expect("memory exists");
        let results = store
            .search_memories(
                test_embedding_with_dim(4),
                5,
                None,
                None,
                Some("preference"),
                Some("manual"),
                None,
            )
            .await
            .expect("search memories");

        assert_eq!(restored.id, original.id);
        assert_eq!(restored.embedding_model.as_deref(), Some("rebuild"));
        assert_eq!(restored.tags, original.tags);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, original.id);
    }

    #[tokio::test]
    async fn init_uses_existing_memory_schema_dimension_after_restart() {
        let uri = test_path("restart-memory-dim");
        let store = MemoryStore::new(&uri).await.expect("create initial store");
        store.init().await.expect("init initial store");
        store
            .recreate_local_memory_table(4)
            .await
            .expect("recreate memory table");
        drop(store);

        let restarted = MemoryStore::new(&uri)
            .await
            .expect("create restarted store");
        restarted.init().await.expect("init restarted store");

        restarted
            .append_with_embedding(
                CreateLocalMemoryRequest {
                    content: "stores with existing dimension".into(),
                    session_id: None,
                    capability_id: None,
                    meta_info: None,
                    category: Some("fact".into()),
                    source: Some("auto_extraction".into()),
                    tags: None,
                },
                test_embedding_with_dim(4),
                Some("test".into()),
            )
            .await
            .expect("append memory with restored dimension");
    }

    #[tokio::test]
    async fn upsert_asset_replaces_existing_row_with_same_id() {
        let store = create_test_store().await;
        let asset_id = "tool.find_skills".to_string();

        store
            .upsert_asset(
                asset_id.clone(),
                "find_skills".into(),
                "first description".into(),
                "tool".into(),
                "user".into(),
                Some("skill:find-skills".into()),
                test_embedding(),
                Some(serde_json::json!({"version": 1})),
            )
            .await
            .expect("insert initial asset");

        store
            .upsert_asset(
                asset_id.clone(),
                "find_skills".into(),
                "updated description".into(),
                "tool".into(),
                "user".into(),
                Some("skill:find-skills".into()),
                test_embedding(),
                Some(serde_json::json!({"version": 2})),
            )
            .await
            .expect("replace existing asset");

        let assets = store.list_assets_catalog().await.expect("list assets");
        let matching_assets = assets
            .iter()
            .filter(|asset| {
                asset.get("id").and_then(|value| value.as_str()) == Some(asset_id.as_str())
            })
            .collect::<Vec<_>>();

        assert_eq!(matching_assets.len(), 1);
        assert_eq!(
            matching_assets[0]
                .get("description")
                .and_then(|value| value.as_str()),
            Some("updated description")
        );
        assert_eq!(
            matching_assets[0]["metadata"]["version"],
            serde_json::json!(2)
        );
    }
}
