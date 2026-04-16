use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalKnowledgeTreeQuery {
    pub parent_id: Option<String>,
    pub q: Option<String>,
    pub sort_field: Option<String>,
    pub sort_direction: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalKnowledgeFolder {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub file_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalKnowledgeFile {
    pub id: String,
    pub name: String,
    pub file_type: String,
    pub size: i64,
    pub status: String,
    pub chunks: Option<i64>,
    pub error_message: Option<String>,
    pub folder_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalKnowledgeChunk {
    pub id: String,
    pub file_id: String,
    pub index: i64,
    pub content: String,
    pub token_count: i64,
    pub chunk_type: String,
    pub section_path: Vec<String>,
    pub page_hint: Option<i64>,
    pub char_start: Option<i64>,
    pub char_end: Option<i64>,
    pub char_count: i64,
    pub content_hash: Option<String>,
    pub quality_flags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalKnowledgeBreadcrumbItem {
    pub id: Option<String>,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalKnowledgeTreeResponse {
    pub folders: Vec<LocalKnowledgeFolder>,
    pub files: Vec<LocalKnowledgeFile>,
    pub breadcrumb: Vec<LocalKnowledgeBreadcrumbItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalKnowledgeStatsResponse {
    pub used_bytes: i64,
    pub total_bytes: Option<i64>,
    pub total_vectors: i64,
    pub total_files: i64,
    pub total_folders: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalKnowledgeChunkListResponse {
    pub items: Vec<LocalKnowledgeChunk>,
    pub total: i64,
    pub offset: i64,
    pub limit: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalKnowledgeSearchHit {
    pub chunk_id: String,
    pub file_id: String,
    pub file_name: String,
    pub index: i64,
    pub content: String,
    pub token_count: i64,
    pub chunk_type: String,
    pub section_path: Vec<String>,
    pub page_hint: Option<i64>,
    pub char_start: Option<i64>,
    pub char_end: Option<i64>,
    pub char_count: i64,
    pub content_hash: Option<String>,
    pub quality_flags: Vec<String>,
    pub score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateLocalKnowledgeFolderRequest {
    pub name: String,
    pub parent_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateLocalKnowledgeFolderRequest {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateLocalUserDocumentRequest {
    pub filename: String,
    pub folder_id: Option<String>,
    pub media_asset_id: Option<String>,
    pub status: Option<String>,
    pub error_message: Option<String>,
    pub chunk_count: Option<i64>,
    pub embedding_model: Option<String>,
    pub meta_info: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateLocalUserDocumentRequest {
    pub name: Option<String>,
    pub folder_id: Option<String>,
    pub folder_id_provided: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalUserDocumentListQuery {
    pub folder_id: Option<String>,
    pub status: Option<String>,
    pub q: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalUserDocumentChunkListQuery {
    pub offset: Option<i64>,
    pub limit: Option<i64>,
}
