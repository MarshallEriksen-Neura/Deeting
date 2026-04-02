use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 工具审批请求 —— 平台无关
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ToolApprovalPayload {
    pub approval_token: String,
    pub call_id: Option<String>,
    pub tool_name: String,
    pub description: Option<String>,
    pub risk_level: Option<String>,
    pub risk_reasons: Vec<String>,
    pub arguments: Option<Value>,
}

/// 轻量对话回复 —— 平台无关，不含 IM 卡片
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextChatReply {
    pub text: Option<String>,
    pub approval_request: Option<ToolApprovalPayload>,
}

/// 审批操作结果 —— 平台无关
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApprovalActionResult {
    pub tool_name: String,
    pub approved: bool,
    pub follow_up_texts: Vec<String>,
}
