use std::cmp::Ordering;
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
        if table_names.iter().any(|name| name == LOCAL_MEMORY_TABLE) {
            return Ok(());
        }

        let schema = local_memory_schema();
        self.conn
            .create_empty_table(LOCAL_MEMORY_TABLE, schema)
            .execute()
            .await?;
        Ok(())
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

        let where_clause = build_filter_sql(
            session_id.as_deref(),
            assistant_id.as_deref(),
            true,
        );
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
        let where_clause = build_filter_sql(
            session_id.as_deref(),
            assistant_id.as_deref(),
            true,
        );
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
    Ok(
        time::OffsetDateTime::now_utc()
            .format(&time::format_description::well_known::Rfc3339)?,
    )
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

fn compare_desc(a: &LocalMemoryItem, b: &LocalMemoryItem) -> Ordering {
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

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use serde_json::json;

    use super::*;

    fn temp_lancedb_path() -> String {
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let mut path = std::env::temp_dir();
        path.push(format!("deeting-memory-test-{}-{}", millis, Uuid::new_v4()));
        path.to_string_lossy().to_string()
    }

    fn cleanup_dir(path: &str) {
        let p = PathBuf::from(path);
        if p.exists() {
            let _ = std::fs::remove_dir_all(p);
        }
    }

    #[tokio::test]
    async fn append_and_list() {
        let path = temp_lancedb_path();
        let store = MemoryStore::new(&path).await.unwrap();
        store.init().await.unwrap();

        let inserted = store
            .append(CreateLocalMemoryRequest {
                content: "记住这个偏好".to_string(),
                session_id: Some("session-1".to_string()),
                assistant_id: Some("assistant-1".to_string()),
                meta_info: Some(json!({"source":"chat"})),
            })
            .await
            .unwrap();
        let listed = store
            .list(LocalMemoryListQuery {
                cursor: None,
                limit: Some(10),
                session_id: Some("session-1".to_string()),
                assistant_id: Some("assistant-1".to_string()),
            })
            .await
            .unwrap();

        assert_eq!(listed.items.len(), 1);
        assert_eq!(listed.items[0].id, inserted.id);
        assert_eq!(listed.items[0].content, "记住这个偏好");
        cleanup_dir(&path);
    }

    #[tokio::test]
    async fn delete_hides_row() {
        let path = temp_lancedb_path();
        let store = MemoryStore::new(&path).await.unwrap();
        store.init().await.unwrap();

        let inserted = store
            .append(CreateLocalMemoryRequest {
                content: "需要删除".to_string(),
                session_id: Some("session-2".to_string()),
                assistant_id: None,
                meta_info: None,
            })
            .await
            .unwrap();
        let deleted = store.delete(&inserted.id).await.unwrap();
        assert!(deleted);

        let listed = store
            .list(LocalMemoryListQuery {
                cursor: None,
                limit: Some(20),
                session_id: Some("session-2".to_string()),
                assistant_id: None,
            })
            .await
            .unwrap();
        assert!(listed.items.is_empty());
        cleanup_dir(&path);
    }

    #[tokio::test]
    async fn clear_by_session() {
        let path = temp_lancedb_path();
        let store = MemoryStore::new(&path).await.unwrap();
        store.init().await.unwrap();

        store
            .append(CreateLocalMemoryRequest {
                content: "s1".to_string(),
                session_id: Some("s1".to_string()),
                assistant_id: Some("a".to_string()),
                meta_info: None,
            })
            .await
            .unwrap();
        store
            .append(CreateLocalMemoryRequest {
                content: "s2".to_string(),
                session_id: Some("s2".to_string()),
                assistant_id: Some("a".to_string()),
                meta_info: None,
            })
            .await
            .unwrap();

        let affected = store
            .clear(LocalMemoryClearRequest {
                session_id: Some("s1".to_string()),
                assistant_id: None,
            })
            .await
            .unwrap();
        assert_eq!(affected, 1);

        let listed_s1 = store
            .list(LocalMemoryListQuery {
                cursor: None,
                limit: Some(20),
                session_id: Some("s1".to_string()),
                assistant_id: None,
            })
            .await
            .unwrap();
        assert!(listed_s1.items.is_empty());

        let listed_s2 = store
            .list(LocalMemoryListQuery {
                cursor: None,
                limit: Some(20),
                session_id: Some("s2".to_string()),
                assistant_id: None,
            })
            .await
            .unwrap();
        assert_eq!(listed_s2.items.len(), 1);

        cleanup_dir(&path);
    }

    #[tokio::test]
    async fn append_requires_content() {
        let path = temp_lancedb_path();
        let store = MemoryStore::new(&path).await.unwrap();
        store.init().await.unwrap();

        let err = store
            .append(CreateLocalMemoryRequest {
                content: "   ".to_string(),
                session_id: None,
                assistant_id: None,
                meta_info: None,
            })
            .await
            .unwrap_err();
        assert!(err.to_string().contains("content is required"));
        cleanup_dir(&path);
    }
}
