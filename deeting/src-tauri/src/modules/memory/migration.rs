use std::sync::Arc;

use arrow_array::{
    Array, Float32Array, RecordBatch, RecordBatchIterator, StringArray,
};
use arrow_schema::{DataType, Field};
use futures_util::TryStreamExt;
use lancedb::query::ExecutableQuery;
use lancedb::Connection;

use crate::modules::memory::error::MemoryError;

/// Schema V1: id, content, session_id, assistant_id, meta_info_json, is_deleted, created_at, updated_at
/// Schema V2: V1 + embedding (FixedSizeList<f32>, nullable), embedding_model (Utf8, nullable)
/// Schema V3: V2 + tags_json, category, source, vitality, last_accessed_at
pub const CURRENT_MEMORY_SCHEMA_VERSION: u32 = 3;

/// Detect schema version by introspecting which columns exist.
pub async fn detect_schema_version(
    conn: &Connection,
    table_name: &str,
) -> Result<u32, MemoryError> {
    let table = conn.open_table(table_name).execute().await?;
    let schema = table.schema().await?;

    if schema.field_with_name("vitality").is_ok() {
        return Ok(3);
    }
    if schema.field_with_name("embedding").is_ok() {
        return Ok(2);
    }
    Ok(1)
}

/// Run incremental migrations from `current_version` up to `target_version`.
pub async fn migrate_to_latest(
    conn: &Connection,
    table_name: &str,
    current_version: u32,
    target_version: u32,
    embedding_dim: i32,
) -> Result<(), MemoryError> {
    let mut version = current_version;
    while version < target_version {
        match version {
            1 => {
                log::info!(
                    "memory migration: upgrading {} from V1 to V2 (adding embedding field, dim={})",
                    table_name,
                    embedding_dim
                );
                migrate_v1_to_v2(conn, table_name, embedding_dim).await?;
                log::info!("memory migration: {} upgraded to V2 successfully", table_name);
            }
            2 => {
                log::info!(
                    "memory migration: upgrading {} from V2 to V3 (adding vitality, tags, category, source)",
                    table_name
                );
                migrate_v2_to_v3(conn, table_name, embedding_dim).await?;
                log::info!("memory migration: {} upgraded to V3 successfully", table_name);
            }
            _ => break,
        }
        version += 1;
    }
    Ok(())
}

/// V1 → V2: Add `embedding` (FixedSizeList<f32>, nullable) and `embedding_model` (Utf8, nullable).
///
/// LanceDB does not support ALTER TABLE ADD COLUMN, so we:
/// 1. Read all existing rows
/// 2. Drop the old table
/// 3. Recreate with the V2 schema
/// 4. Re-insert rows with null values for new columns
async fn migrate_v1_to_v2(
    conn: &Connection,
    table_name: &str,
    embedding_dim: i32,
) -> Result<(), MemoryError> {
    let table = conn.open_table(table_name).execute().await?;

    // 1. Read all existing data
    let old_batches: Vec<RecordBatch> = table
        .query()
        .execute()
        .await?
        .try_collect::<Vec<_>>()
        .await?;

    let total_rows: usize = old_batches.iter().map(|b| b.num_rows()).sum();
    log::info!(
        "memory migration v1→v2: read {} rows from {}",
        total_rows,
        table_name
    );

    // 2. Drop and recreate with V2 schema
    conn.drop_table(table_name, &[]).await?;

    let new_schema = super::store::local_memory_schema_v2(embedding_dim);
    conn.create_empty_table(table_name, new_schema.clone())
        .execute()
        .await?;

    if total_rows == 0 {
        return Ok(());
    }

    // 3. Re-insert rows with null embedding columns
    let new_table = conn.open_table(table_name).execute().await?;
    for old_batch in &old_batches {
        let num_rows = old_batch.num_rows();
        if num_rows == 0 {
            continue;
        }

        let new_batch = extend_batch_with_null_embedding(old_batch, embedding_dim)?;
        let schema = new_batch.schema();
        new_table
            .add(RecordBatchIterator::new(
                vec![Ok(new_batch)].into_iter(),
                schema,
            ))
            .execute()
            .await?;
    }

    Ok(())
}

/// Extend a V1 RecordBatch with null embedding and embedding_model columns.
fn extend_batch_with_null_embedding(
    old_batch: &RecordBatch,
    embedding_dim: i32,
) -> Result<RecordBatch, MemoryError> {
    let num_rows = old_batch.num_rows();

    // Collect existing V1 columns in order
    let id_col = old_batch.column_by_name("id")
        .ok_or_else(|| MemoryError::Storage("missing column: id".into()))?;
    let content_col = old_batch.column_by_name("content")
        .ok_or_else(|| MemoryError::Storage("missing column: content".into()))?;
    let session_col = old_batch.column_by_name("session_id")
        .ok_or_else(|| MemoryError::Storage("missing column: session_id".into()))?;
    let assistant_col = old_batch.column_by_name("assistant_id")
        .ok_or_else(|| MemoryError::Storage("missing column: assistant_id".into()))?;
    let meta_col = old_batch.column_by_name("meta_info_json")
        .ok_or_else(|| MemoryError::Storage("missing column: meta_info_json".into()))?;
    let deleted_col = old_batch.column_by_name("is_deleted")
        .ok_or_else(|| MemoryError::Storage("missing column: is_deleted".into()))?;
    let created_col = old_batch.column_by_name("created_at")
        .ok_or_else(|| MemoryError::Storage("missing column: created_at".into()))?;
    let updated_col = old_batch.column_by_name("updated_at")
        .ok_or_else(|| MemoryError::Storage("missing column: updated_at".into()))?;

    // New columns: null embedding and null embedding_model
    let null_embedding = arrow_array::new_null_array(
        &DataType::FixedSizeList(
            Arc::new(Field::new("item", DataType::Float32, true)),
            embedding_dim,
        ),
        num_rows,
    );
    let null_model = Arc::new(StringArray::from(vec![None as Option<&str>; num_rows])) as Arc<dyn Array>;

    let new_schema = super::store::local_memory_schema_v2(embedding_dim);

    RecordBatch::try_new(
        new_schema,
        vec![
            id_col.clone(),
            content_col.clone(),
            session_col.clone(),
            assistant_col.clone(),
            meta_col.clone(),
            deleted_col.clone(),
            created_col.clone(),
            updated_col.clone(),
            null_embedding,
            null_model,
        ],
    )
    .map_err(|e| MemoryError::Storage(format!("failed to build migrated batch: {}", e)))
}

/// V2 → V3: Add tags_json, category, source, vitality, last_accessed_at columns.
///
/// Same strategy: read all → drop → recreate with V3 → re-insert with defaults.
async fn migrate_v2_to_v3(
    conn: &Connection,
    table_name: &str,
    embedding_dim: i32,
) -> Result<(), MemoryError> {
    let table = conn.open_table(table_name).execute().await?;

    let old_batches: Vec<RecordBatch> = table
        .query()
        .execute()
        .await?
        .try_collect::<Vec<_>>()
        .await?;

    let total_rows: usize = old_batches.iter().map(|b| b.num_rows()).sum();
    log::info!(
        "memory migration v2→v3: read {} rows from {}",
        total_rows,
        table_name
    );

    conn.drop_table(table_name, &[]).await?;

    let new_schema = super::store::local_memory_schema_v3(embedding_dim);
    conn.create_empty_table(table_name, new_schema.clone())
        .execute()
        .await?;

    if total_rows == 0 {
        return Ok(());
    }

    let new_table = conn.open_table(table_name).execute().await?;
    for old_batch in &old_batches {
        let num_rows = old_batch.num_rows();
        if num_rows == 0 {
            continue;
        }

        let new_batch = extend_v2_batch_with_v3_columns(old_batch, embedding_dim)?;
        let schema = new_batch.schema();
        new_table
            .add(RecordBatchIterator::new(
                vec![Ok(new_batch)].into_iter(),
                schema,
            ))
            .execute()
            .await?;
    }

    Ok(())
}

/// Extend a V2 RecordBatch with V3 columns (null tags_json, null category, null source,
/// vitality=1.0, null last_accessed_at).
fn extend_v2_batch_with_v3_columns(
    old_batch: &RecordBatch,
    embedding_dim: i32,
) -> Result<RecordBatch, MemoryError> {
    let num_rows = old_batch.num_rows();

    // All 10 V2 columns
    let id_col = get_col(old_batch, "id")?;
    let content_col = get_col(old_batch, "content")?;
    let session_col = get_col(old_batch, "session_id")?;
    let assistant_col = get_col(old_batch, "assistant_id")?;
    let meta_col = get_col(old_batch, "meta_info_json")?;
    let deleted_col = get_col(old_batch, "is_deleted")?;
    let created_col = get_col(old_batch, "created_at")?;
    let updated_col = get_col(old_batch, "updated_at")?;
    let embedding_col = get_col(old_batch, "embedding")?;
    let model_col = get_col(old_batch, "embedding_model")?;

    // V3 columns with defaults
    let null_tags = Arc::new(StringArray::from(vec![None as Option<&str>; num_rows])) as Arc<dyn Array>;
    let null_category = Arc::new(StringArray::from(vec![None as Option<&str>; num_rows])) as Arc<dyn Array>;
    let null_source = Arc::new(StringArray::from(vec![None as Option<&str>; num_rows])) as Arc<dyn Array>;
    let default_vitality = Arc::new(Float32Array::from(vec![1.0_f32; num_rows])) as Arc<dyn Array>;
    let null_last_accessed = Arc::new(StringArray::from(vec![None as Option<&str>; num_rows])) as Arc<dyn Array>;

    let new_schema = super::store::local_memory_schema_v3(embedding_dim);

    RecordBatch::try_new(
        new_schema,
        vec![
            id_col,
            content_col,
            session_col,
            assistant_col,
            meta_col,
            deleted_col,
            created_col,
            updated_col,
            embedding_col,
            model_col,
            null_tags,
            null_category,
            null_source,
            default_vitality,
            null_last_accessed,
        ],
    )
    .map_err(|e| MemoryError::Storage(format!("failed to build v2→v3 migrated batch: {}", e)))
}

fn get_col(batch: &RecordBatch, name: &str) -> Result<Arc<dyn Array>, MemoryError> {
    batch
        .column_by_name(name)
        .cloned()
        .ok_or_else(|| MemoryError::Storage(format!("missing column: {}", name)))
}
