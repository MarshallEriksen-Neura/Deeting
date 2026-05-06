#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GeneratedArtifactRecord {
    pub artifact_id: String,
    pub artifact_kind: String,
    pub title: String,
    pub status: String,
    pub origin_session_id: Option<String>,
    pub origin_message_id: Option<String>,
    pub origin_block_id: Option<String>,
    pub current_revision_id: String,
    pub created_at: String,
    pub updated_at: String,
    pub last_opened_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GeneratedArtifactRevisionRecord {
    pub revision_id: String,
    pub artifact_id: String,
    pub revision_number: i64,
    pub parent_revision_id: Option<String>,
    pub file_id: String,
    pub filename: String,
    pub content_type: String,
    pub size: i64,
    pub source_json: String,
    pub outline_json: Option<String>,
    pub preview_text: Option<String>,
    pub change_summary: Option<String>,
    pub creation_mode: String,
    pub created_at: String,
    pub binary_status: String,
    pub binary_pruned_at: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CreateGeneratedArtifactRevision {
    pub artifact_kind: String,
    pub title: String,
    pub file_id: String,
    pub filename: String,
    pub content_type: String,
    pub size: i64,
    pub source_json: String,
    pub outline_json: Option<String>,
    pub preview_text: Option<String>,
    pub change_summary: Option<String>,
    pub creation_mode: String,
    pub origin_session_id: Option<String>,
    pub origin_message_id: Option<String>,
    pub origin_block_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct AppendGeneratedArtifactRevision {
    pub artifact_id: String,
    pub base_revision_id: Option<String>,
    pub file_id: String,
    pub filename: String,
    pub content_type: String,
    pub size: i64,
    pub source_json: String,
    pub outline_json: Option<String>,
    pub preview_text: Option<String>,
    pub change_summary: Option<String>,
    pub creation_mode: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreatedGeneratedArtifactRevision {
    pub artifact_id: String,
    pub revision_id: String,
    pub revision_number: i64,
}
