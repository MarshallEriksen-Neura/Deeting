use serde::{Deserialize, Serialize};
use serde_json::Value;

pub use mcp_core::types::{
    CreateSourceRequest, ImportConfigRequest, LocalChatInputMessage, LocalChatToolCall,
    McpConfigPayload, McpConflictStatus, McpLogEntry, McpLogStream, McpSource, McpSourceStatus,
    McpSourceType, McpTool, McpToolConfigPayload, McpToolStatus, McpTransportKind, McpTrustLevel,
    ResolveConflictRequest, SyncSourceRequest, UpdateToolConfigRequest,
};
pub use mcp_registry::types::{
    LocalCapabilityRegistryDiagnosticsBucket, LocalCapabilityRegistryDiagnosticsItem,
    LocalCapabilityRegistryDiagnosticsResponse, LocalCapabilityRegistryParityItem,
};
pub use mcp_session::admin::{
    LocalAdminConversationItem, LocalAdminConversationListResponse,
    LocalAdminConversationMessageItem, LocalAdminConversationMessageListResponse,
    LocalAdminConversationMessageQuery, LocalAdminConversationQuery,
    LocalAdminConversationSummaryItem, LocalAdminConversationSummaryListResponse,
    LocalConversationSummaryBatchRetryRequest, LocalConversationSummaryBatchRetryResponse,
    LocalConversationSummaryEnqueueResponse, LocalConversationSummaryIdleTaskItem,
    LocalConversationSummaryIdleTaskListResponse, LocalConversationSummaryIdleTaskQuery,
    LocalConversationSummaryJobItem, LocalConversationSummaryJobListResponse,
    LocalConversationSummaryJobQuery, LocalConversationSummaryQueueStats, LocalGatewayLogItem,
    LocalGatewayLogListResponse, LocalGatewayLogQuery, LocalGatewayLogStatsBucket,
    LocalGatewayLogStatsResponse, LocalMaintenanceActionRequest, LocalMaintenanceLogItem,
    LocalMaintenanceLogListResponse, LocalMaintenanceLogQuery, LocalTraceFeedback,
    LocalTraceFeedbackRequest,
};
pub use mcp_session::assistant::{
    CloudSystemAssistantSnapshot, CloudSystemAssistantVersionSnapshot,
    CreateAssistantMessageRequest, CreateLocalAssistantRequest, LocalAssistant,
    LocalAssistantEntity, LocalAssistantInstallCreateRequest, LocalAssistantInstallItem,
    LocalAssistantInstallPage, LocalAssistantInstallQuery, LocalAssistantInstallUpdateRequest,
    LocalAssistantMessage, LocalAssistantPreviewRequest, LocalAssistantRatingRequest,
    LocalAssistantRatingResponse, LocalAssistantRoutingFeedbackRequest,
    LocalAssistantRoutingReportItem, LocalAssistantRoutingReportQuery,
    LocalAssistantRoutingReportResponse, LocalAssistantRoutingReportSummary,
    LocalAssistantRoutingState, LocalAssistantSummary, LocalAssistantSummaryVersion,
    LocalAssistantTag, LocalAssistantVersion, LocalChatRequest, LocalChatResponse,
    UpdateLocalAssistantRequest,
};
pub use mcp_session::conversation::{
    CreateConversationMessageRequest, LocalConversationArchiveResponse,
    LocalConversationCancelResponse, LocalConversationClearResponse,
    LocalConversationCompareFinalizeRequest, LocalConversationCompareFinalizeResponse,
    LocalConversationCreateRequest, LocalConversationCreateResponse,
    LocalConversationDeleteResponse, LocalConversationHistoryMessage,
    LocalConversationHistoryQuery, LocalConversationHistoryResponse,
    LocalConversationRegenerateRequest, LocalConversationRegenerateResponse,
    LocalConversationRenameRequest, LocalConversationRenameResponse, LocalConversationSendRequest,
    LocalConversationSendResponse, LocalConversationSessionItem, LocalConversationSessionPage,
    LocalConversationSessionsQuery, LocalConversationStatus, LocalConversationWindowResponse,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudSystemAssetPolicySnapshot {
    pub visibility_scope: String,
    pub local_sync_policy: String,
    pub execution_policy: String,
    pub permission_grants: Vec<String>,
    pub allowed_role_names: Vec<String>,
    pub materialization_state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudSystemAssetSyncItem {
    pub asset_id: String,
    pub title: String,
    pub description: Option<String>,
    pub asset_kind: String,
    pub owner_scope: String,
    pub source_kind: String,
    pub version: String,
    pub artifact_ref: Option<String>,
    pub checksum: Option<String>,
    #[serde(default)]
    pub metadata_json: Value,
    pub policy_snapshot: CloudSystemAssetPolicySnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudSystemAssetSyncResponse {
    #[serde(default)]
    pub items: Vec<CloudSystemAssetSyncItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalSystemAssetSyncResponse {
    pub fetched_count: i64,
    pub assistant_fetched_count: i64,
    pub skill_fetched_count: i64,
    pub upserted_count: i64,
    pub hidden_count: i64,
    pub metadata_only_count: i64,
    pub executable_count: i64,
    pub archived_count: i64,
    pub skill_install_fetched_count: i64,
    pub skill_install_upserted_count: i64,
    pub skill_reinstalled_count: i64,
    pub skill_failed_count: i64,
    pub disabled_skill_count: i64,
    pub archived_assistant_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalSystemAssetRepairResponse {
    pub vector_dimension: i64,
    pub skill_reindexed_count: i64,
    pub assistant_reindexed_count: i64,
    pub sync: LocalSystemAssetSyncResponse,
}

pub use crate::modules::knowledge::types::{
    CreateLocalKnowledgeFolderRequest, CreateLocalUserDocumentRequest,
    LocalKnowledgeBreadcrumbItem, LocalKnowledgeChunk, LocalKnowledgeChunkListResponse,
    LocalKnowledgeFile, LocalKnowledgeFolder, LocalKnowledgeSearchHit, LocalKnowledgeStatsResponse,
    LocalKnowledgeTreeQuery, LocalKnowledgeTreeResponse, LocalUserDocumentChunkListQuery,
    LocalUserDocumentListQuery, UpdateLocalKnowledgeFolderRequest, UpdateLocalUserDocumentRequest,
};
