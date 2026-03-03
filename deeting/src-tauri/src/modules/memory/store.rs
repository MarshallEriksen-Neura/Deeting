use std::sync::Arc;

use arrow_array::{Array, BooleanArray, RecordBatch, RecordBatchIterator, StringArray};
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
const LOCAL_TOOL_TABLE: &str = "local_tools";
const LOCAL_ASSISTANT_TABLE: &str = "local_assistants";

pub struct MemoryStore {
    conn: Connection,
}

impl MemoryStore {
    pub async fn new(uri: &str) -> Result<Self, MemoryError> {
        let normalized_uri = uri.trim().to_string();
        if normalized_uri.is_empty() {
            return Err(MemoryError::validation("lancedb path is required"));
        }
        let conn = connect(&normalized_uri).execute().await?;
        Ok(Self { conn })
    }

    pub async fn init(&self) -> Result<(), MemoryError> {
        let table_names = self.conn.table_names().execute().await?;

        if !table_names.iter().any(|name| name == LOCAL_MEMORY_TABLE) {
            let schema = local_memory_schema();
            self.conn
                .create_empty_table(LOCAL_MEMORY_TABLE, schema)
                .execute()
                .await?;
        }

        if !table_names.iter().any(|name| name == LOCAL_TOOL_TABLE) {
            let schema = local_tool_schema();
            self.conn
                .create_empty_table(LOCAL_TOOL_TABLE, schema)
                .execute()
                .await?;
        }

        if !table_names.iter().any(|name| name == LOCAL_ASSISTANT_TABLE) {
            let schema = local_assistant_schema();
            self.conn
                .create_empty_table(LOCAL_ASSISTANT_TABLE, schema)
                .execute()
                .await?;
        }

        Ok(())
    }

    pub async fn append_tool(
        &self,
        id: String,
        name: String,
        description: String,
        identifier: Option<String>,
        vector: Vec<f32>,
    ) -> Result<(), MemoryError> {
        let now = now_rfc3339()?;
        let batch = RecordBatch::try_new(
            local_tool_schema(),
            vec![
                Arc::new(StringArray::from(vec![Some(id)])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![Some(name)])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![Some(description)])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![identifier])) as Arc<dyn Array>,
                Arc::new(build_fixed_size_vector_array(vector)) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![Some(now.clone())])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![Some(now)])) as Arc<dyn Array>,
            ],
        )?;

        let table = self.conn.open_table(LOCAL_TOOL_TABLE).execute().await?;
        table
            .add(RecordBatchIterator::new(
                vec![Ok(batch)],
                local_tool_schema(),
            ))
            .execute()
            .await?;
        Ok(())
    }

    pub async fn append_assistant(
        &self,
        id: String,
        name: String,
        description: String,
        tags: Option<String>,
        vector: Vec<f32>,
    ) -> Result<(), MemoryError> {
        let now = now_rfc3339()?;
        let batch = RecordBatch::try_new(
            local_assistant_schema(),
            vec![
                Arc::new(StringArray::from(vec![Some(id)])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![Some(name)])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![Some(description)])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![tags])) as Arc<dyn Array>,
                Arc::new(build_fixed_size_vector_array(vector)) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![Some(now.clone())])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![Some(now)])) as Arc<dyn Array>,
            ],
        )?;

        let table = self
            .conn
            .open_table(LOCAL_ASSISTANT_TABLE)
            .execute()
            .await?;
        table
            .add(RecordBatchIterator::new(
                vec![Ok(batch)],
                local_assistant_schema(),
            ))
            .execute()
            .await?;
        Ok(())
    }

    pub async fn search_tools(
        &self,
        vector: Vec<f32>,
        limit: usize,
    ) -> Result<Vec<serde_json::Value>, MemoryError> {
        let table = self.conn.open_table(LOCAL_TOOL_TABLE).execute().await?;
        let batches = table
            .vector_search(vector)?
            .column("vector")
            .limit(limit)
            .execute()
            .await?
            .try_collect::<Vec<_>>()
            .await?;

        let mut results = Vec::new();
        for batch in batches {
            let id_col = as_string_col(&batch, "id")?;
            let name_col = as_string_col(&batch, "name")?;
            let desc_col = as_string_col(&batch, "description")?;
            let ident_col = as_string_col(&batch, "identifier")?;

            for row in 0..batch.num_rows() {
                results.push(serde_json::json!({
                    "id": id_col.value(row),
                    "name": name_col.value(row),
                    "description": desc_col.value(row),
                    "identifier": nullable_string(ident_col, row),
                }));
            }
        }
        Ok(results)
    }

    pub async fn search_assistants(
        &self,
        vector: Vec<f32>,
        limit: usize,
    ) -> Result<Vec<serde_json::Value>, MemoryError> {
        let table = self
            .conn
            .open_table(LOCAL_ASSISTANT_TABLE)
            .execute()
            .await?;
        let batches = table
            .vector_search(vector)?
            .column("vector")
            .limit(limit)
            .execute()
            .await?
            .try_collect::<Vec<_>>()
            .await?;

        let mut results = Vec::new();
        for batch in batches {
            let id_col = as_string_col(&batch, "id")?;
            let name_col = as_string_col(&batch, "name")?;
            let desc_col = as_string_col(&batch, "description")?;
            let tags_col = as_string_col(&batch, "tags")?;

            for row in 0..batch.num_rows() {
                results.push(serde_json::json!({
                    "id": id_col.value(row),
                    "name": name_col.value(row),
                    "description": desc_col.value(row),
                    "tags": nullable_string(tags_col, row),
                }));
            }
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
        let now = now_rfc3339()?;

        let batch = RecordBatch::try_new(
            local_memory_schema(),
            vec![
                Arc::new(StringArray::from(vec![Some(id.clone())])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![Some(content.clone())])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![session_id.clone()])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![assistant_id.clone()])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![meta_info_json.clone()])) as Arc<dyn Array>,
                Arc::new(BooleanArray::from(vec![false])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![Some(now.clone())])) as Arc<dyn Array>,
                Arc::new(StringArray::from(vec![Some(now.clone())])) as Arc<dyn Array>,
            ],
        )?;
        let schema = batch.schema();
        let reader = RecordBatchIterator::new(vec![Ok(batch)].into_iter(), schema);
        let table = self.table().await?;
        table.add(reader).execute().await?;

        Ok(LocalMemoryItem {
            id,
            content,
            session_id,
            assistant_id,
            meta_info: payload.meta_info,
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

        let now = now_rfc3339()?;
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
        Ok(affected > 0)
    }

    pub async fn clear(&self, payload: LocalMemoryClearRequest) -> Result<i64, MemoryError> {
        let session_id = normalize_optional(payload.session_id);
        let assistant_id = normalize_optional(payload.assistant_id);
        let where_clause = build_filter_sql(session_id.as_deref(), assistant_id.as_deref(), true);
        let now = now_rfc3339()?;
        let table = self.table().await?;
        let mut operation = table
            .update()
            .column("is_deleted", "true")
            .column("updated_at", format!("'{}'", sql_escape(&now)));
        if !where_clause.is_empty() {
            operation = operation.only_if(where_clause);
        }
        let affected = operation.execute().await?;
        Ok(affected as i64)
    }

    async fn table(&self) -> Result<Table, MemoryError> {
        Ok(self.conn.open_table(LOCAL_MEMORY_TABLE).execute().await?)
    }
}

#[derive(Debug, Clone)]
struct CursorKey {
    created_at: String,
    id: String,
}

fn local_memory_schema() -> SchemaRef {
    Arc::new(Schema::new(vec![
        Field::new("id", DataType::Utf8, false),
        Field::new("content", DataType::Utf8, false),
        Field::new("session_id", DataType::Utf8, true),
        Field::new("assistant_id", DataType::Utf8, true),
        Field::new("meta_info_json", DataType::Utf8, true),
        Field::new("is_deleted", DataType::Boolean, false),
        Field::new("created_at", DataType::Utf8, false),
        Field::new("updated_at", DataType::Utf8, false),
    ]))
}

fn local_tool_schema() -> SchemaRef {
    Arc::new(Schema::new(vec![
        Field::new("id", DataType::Utf8, false),
        Field::new("name", DataType::Utf8, false),
        Field::new("description", DataType::Utf8, false),
        Field::new("identifier", DataType::Utf8, true),
        Field::new(
            "vector",
            DataType::FixedSizeList(Arc::new(Field::new("item", DataType::Float32, true)), 1536),
            false,
        ),
        Field::new("created_at", DataType::Utf8, false),
        Field::new("updated_at", DataType::Utf8, false),
    ]))
}

fn local_assistant_schema() -> SchemaRef {
    Arc::new(Schema::new(vec![
        Field::new("id", DataType::Utf8, false),
        Field::new("name", DataType::Utf8, false),
        Field::new("description", DataType::Utf8, false),
        Field::new("tags", DataType::Utf8, true),
        Field::new(
            "vector",
            DataType::FixedSizeList(Arc::new(Field::new("item", DataType::Float32, true)), 1536),
            false,
        ),
        Field::new("created_at", DataType::Utf8, false),
        Field::new("updated_at", DataType::Utf8, false),
    ]))
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

fn now_rfc3339() -> Result<String, MemoryError> {
    Ok(time::OffsetDateTime::now_utc().format(&time::format_description::well_known::Rfc3339)?)
}

fn normalize_optional(value: Option<String>) -> Option<String> {
    value
        .map(|raw| raw.trim().to_string())
        .filter(|raw| !raw.is_empty())
}

fn sql_escape(raw: &str) -> String {
    raw.replace('\'', "''")
}

fn read_items_from_batch(batch: &RecordBatch) -> Result<Vec<LocalMemoryItem>, MemoryError> {
    let id_col = as_string_col(batch, "id")?;
    let content_col = as_string_col(batch, "content")?;
    let session_col = as_string_col(batch, "session_id")?;
    let assistant_col = as_string_col(batch, "assistant_id")?;
    let meta_col = as_string_col(batch, "meta_info_json")?;
    let created_col = as_string_col(batch, "created_at")?;
    let updated_col = as_string_col(batch, "updated_at")?;

    let mut items = Vec::with_capacity(batch.num_rows());
    for row in 0..batch.num_rows() {
        let meta_info = nullable_string(meta_col, row)
            .map(|raw| serde_json::from_str(&raw))
            .transpose()?;
        items.push(LocalMemoryItem {
            id: required_string(id_col, row, "id")?,
            content: required_string(content_col, row, "content")?,
            session_id: nullable_string(session_col, row),
            assistant_id: nullable_string(assistant_col, row),
            meta_info,
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

#[allow(dead_code)]
fn as_bool_col<'a>(batch: &'a RecordBatch, name: &str) -> Result<&'a BooleanArray, MemoryError> {
    let column = batch
        .column_by_name(name)
        .ok_or_else(|| MemoryError::Storage(format!("missing column: {name}")))?;
    column
        .as_any()
        .downcast_ref::<BooleanArray>()
        .ok_or_else(|| MemoryError::Storage(format!("invalid bool column: {name}")))
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

fn compare_desc(a: &LocalMemoryItem, b: &LocalMemoryItem) -> std::cmp::Ordering {
    b.created_at
        .cmp(&a.created_at)
        .then_with(|| b.id.cmp(&a.id))
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

fn build_fixed_size_vector_array(mut vector: Vec<f32>) -> arrow_array::FixedSizeListArray {
    const DIMENSION: usize = 1536;
    if vector.len() > DIMENSION {
        vector.truncate(DIMENSION);
    } else if vector.len() < DIMENSION {
        vector.resize(DIMENSION, 0.0);
    }
    let values: Vec<Option<f32>> = vector.into_iter().map(Some).collect();
    arrow_array::FixedSizeListArray::from_iter_primitive::<arrow_array::types::Float32Type, _, _>(
        vec![Some(values)],
        DIMENSION as i32,
    )
}
