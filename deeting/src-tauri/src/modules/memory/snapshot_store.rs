use sqlx::sqlite::SqlitePool;

use crate::modules::memory::error::MemoryError;
use crate::modules::memory::types::MemorySnapshot;

/// SQLite-based store for memory audit trail snapshots.
pub struct SnapshotStore {
    pool: SqlitePool,
}

impl SnapshotStore {
    pub async fn new(database_url: &str) -> Result<Self, MemoryError> {
        let pool = SqlitePool::connect(database_url)
            .await
            .map_err(|e| MemoryError::Storage(format!("snapshot db connect failed: {}", e)))?;
        let store = Self { pool };
        store.init().await?;
        Ok(store)
    }

    pub async fn with_pool(pool: SqlitePool) -> Result<Self, MemoryError> {
        let store = Self { pool };
        store.init().await?;
        Ok(store)
    }

    async fn init(&self) -> Result<(), MemoryError> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS memory_snapshots (
                id TEXT PRIMARY KEY,
                memory_id TEXT NOT NULL,
                action TEXT NOT NULL,
                old_content TEXT,
                new_content TEXT,
                old_metadata TEXT,
                new_metadata TEXT,
                created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
            )
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|e| MemoryError::Storage(format!("snapshot table init failed: {}", e)))?;

        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_snapshots_memory_id ON memory_snapshots(memory_id)",
        )
        .execute(&self.pool)
        .await
        .map_err(|e| MemoryError::Storage(format!("snapshot index init failed: {}", e)))?;

        Ok(())
    }

    /// Record a snapshot of a memory change (UPDATE or DELETE).
    pub async fn record(
        &self,
        memory_id: &str,
        action: &str,
        old_content: Option<&str>,
        new_content: Option<&str>,
        old_metadata: Option<&str>,
        new_metadata: Option<&str>,
    ) -> Result<String, MemoryError> {
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            r#"
            INSERT INTO memory_snapshots (id, memory_id, action, old_content, new_content, old_metadata, new_metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&id)
        .bind(memory_id)
        .bind(action)
        .bind(old_content)
        .bind(new_content)
        .bind(old_metadata)
        .bind(new_metadata)
        .execute(&self.pool)
        .await
        .map_err(|e| MemoryError::Storage(format!("snapshot record failed: {}", e)))?;

        Ok(id)
    }

    /// List snapshots for a given memory, newest first.
    pub async fn list_by_memory(
        &self,
        memory_id: &str,
        limit: i64,
    ) -> Result<Vec<MemorySnapshot>, MemoryError> {
        let rows = sqlx::query_as::<_, SnapshotRow>(
            "SELECT id, memory_id, action, old_content, new_content, old_metadata, new_metadata, created_at \
             FROM memory_snapshots WHERE memory_id = ? ORDER BY created_at DESC LIMIT ?",
        )
        .bind(memory_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| MemoryError::Storage(format!("snapshot list failed: {}", e)))?;

        Ok(rows.into_iter().map(|r| r.into()).collect())
    }

    /// Get a specific snapshot by ID.
    pub async fn get_snapshot(
        &self,
        snapshot_id: &str,
    ) -> Result<Option<MemorySnapshot>, MemoryError> {
        let row = sqlx::query_as::<_, SnapshotRow>(
            "SELECT id, memory_id, action, old_content, new_content, old_metadata, new_metadata, created_at \
             FROM memory_snapshots WHERE id = ? LIMIT 1",
        )
        .bind(snapshot_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| MemoryError::Storage(format!("snapshot get failed: {}", e)))?;

        Ok(row.map(|r| r.into()))
    }
}

#[derive(sqlx::FromRow)]
struct SnapshotRow {
    id: String,
    memory_id: String,
    action: String,
    old_content: Option<String>,
    new_content: Option<String>,
    old_metadata: Option<String>,
    new_metadata: Option<String>,
    created_at: String,
}

impl From<SnapshotRow> for MemorySnapshot {
    fn from(row: SnapshotRow) -> Self {
        Self {
            id: row.id,
            memory_id: row.memory_id,
            action: row.action,
            old_content: row.old_content,
            new_content: row.new_content,
            old_metadata: row.old_metadata,
            new_metadata: row.new_metadata,
            created_at: row.created_at,
        }
    }
}
