use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The action taken by the Write Guard during an append operation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum WriteAction {
    /// New knowledge — directly added.
    Add,
    /// Knowledge evolution — existing memory updated/merged.
    Update,
    /// High duplication — silently discarded.
    Noop,
}

/// Result of an append operation that went through the Write Guard.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WriteGuardResult {
    pub action: WriteAction,
    /// The memory item (present for Add and Update, None for Noop).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item: Option<LocalMemoryItem>,
    /// The similarity score of the closest existing memory (if checked).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub similarity_score: Option<f32>,
    /// The id of the existing memory that was updated (for Update action).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_memory_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalMemoryItem {
    pub id: String,
    pub content: String,
    pub session_id: Option<String>,
    pub assistant_id: Option<String>,
    pub meta_info: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embedding_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vitality: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_accessed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateLocalMemoryRequest {
    pub content: String,
    pub session_id: Option<String>,
    pub assistant_id: Option<String>,
    pub meta_info: Option<Value>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LocalMemoryListQuery {
    pub cursor: Option<String>,
    pub limit: Option<i64>,
    pub session_id: Option<String>,
    pub assistant_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalMemoryListResponse {
    pub items: Vec<LocalMemoryItem>,
    pub next_cursor: Option<String>,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalMemoryDeleteResponse {
    pub id: String,
    pub deleted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LocalMemoryClearRequest {
    pub session_id: Option<String>,
    pub assistant_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalMemoryClearResponse {
    pub cleared: i64,
}

// --- Search types ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalMemorySearchQuery {
    pub query: String,
    pub limit: Option<usize>,
    pub session_id: Option<String>,
    pub assistant_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalMemorySearchItem {
    pub id: String,
    pub content: String,
    pub session_id: Option<String>,
    pub assistant_id: Option<String>,
    pub meta_info: Option<Value>,
    pub score: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vitality: Option<f32>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalMemorySearchResult {
    pub items: Vec<LocalMemorySearchItem>,
}

// --- Snapshot types ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemorySnapshot {
    pub id: String,
    pub memory_id: String,
    pub action: String,
    pub old_content: Option<String>,
    pub new_content: Option<String>,
    pub old_metadata: Option<String>,
    pub new_metadata: Option<String>,
    pub created_at: String,
}
