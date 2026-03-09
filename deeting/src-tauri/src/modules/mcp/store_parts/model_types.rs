#[derive(Clone)]
pub struct NewSource {
    pub name: String,
    pub source_type: McpSourceType,
    pub path_or_url: String,
    pub trust_level: McpTrustLevel,
    pub status: McpSourceStatus,
    pub last_synced_at: Option<String>,
    pub is_read_only: bool,
}

#[derive(Clone)]
pub struct ToolUpsert {
    pub id: Option<String>,
    pub source_id: String,
    pub identifier: Option<String>,
    pub name: String,
    pub source_type: McpSourceType,
    pub status: McpToolStatus,
    pub ping_ms: Option<i64>,
    pub capabilities: Vec<String>,
    pub description: String,
    pub error: Option<String>,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub env: Option<HashMap<String, String>>,
    pub config_json: String,
    pub config_hash: String,
    pub pending_config_json: Option<String>,
    pub pending_config_hash: Option<String>,
    pub conflict_status: McpConflictStatus,
    pub is_read_only: bool,
    pub is_new: bool,
}

pub struct ExtractedToolFields {
    pub name: String,
    pub description: String,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub env: Option<HashMap<String, String>>,
    pub capabilities: Vec<String>,
}

pub struct LocalConversationRegenerateContext {
    pub session_id: String,
    pub assistant_id: Option<String>,
    pub deleted_turn_index: Option<i64>,
    pub messages: Vec<LocalChatInputMessage>,
}

#[derive(Clone)]
pub struct LocalConversationChatContext {
    pub session_id: String,
    pub assistant_id: Option<String>,
    pub messages: Vec<LocalChatInputMessage>,
}
