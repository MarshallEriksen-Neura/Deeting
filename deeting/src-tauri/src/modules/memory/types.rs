use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalMemoryItem {
    pub id: String,
    pub content: String,
    pub session_id: Option<String>,
    pub assistant_id: Option<String>,
    pub meta_info: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embedding_model: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateLocalMemoryRequest {
    pub content: String,
    pub session_id: Option<String>,
    pub assistant_id: Option<String>,
    pub meta_info: Option<Value>,
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
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalMemorySearchResult {
    pub items: Vec<LocalMemorySearchItem>,
}
