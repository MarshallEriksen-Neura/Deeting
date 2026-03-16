// Shell Executor 集成示例
// 
// 展示如何将 shell_execute 集成到现有的 MCP 工具执行流程中

use crate::modules::shell_executor::{ShellExecuteCoreTool, ShellExecutionRequest};
use crate::modules::mcp::{ToolRiskAssessment, PendingToolCall};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::collections::HashMap;
use tokio::sync::RwLock;

/// 示例: 集成到现有的工具执行流程
pub async fn execute_shell_tool_example(
    home_dir: PathBuf,
    pending_tool_calls: Arc<RwLock<HashMap<String, PendingToolCall>>>,
    tool_name: &str,
    arguments: Value,
) -> Result<Value, String> {
    // 1. 创建 Shell Executor
    let shell_tool = ShellExecuteCoreTool::new(home_dir);
    
    // 2. 风险评估 (复用现有系统)
    let command = arguments.get("command")
        .and_then(|v| v.as_str())
        .ok_or("Missing 'command' parameter")?;
    
    let risk = shell_tool.assess_risk(command, &arguments);
    
    // 3. 审批流程 (复用现有系统)
    if risk.requires_approval {
        // 使用现有的审批流程
        return queue_for_approval(
            pending_tool_calls,
            tool_name,
            arguments,
            risk,
        ).await;
    }
    
    // 4. 直接执行
    shell_tool.execute(arguments).await
}

/// 示例: 审批流程 (复用现有系统)
async fn queue_for_approval(
    pending_tool_calls: Arc<RwLock<HashMap<String, PendingToolCall>>>,
    tool_name: &str,
    arguments: Value,
    risk: ToolRiskAssessment,
) -> Result<Value, String> {
    // 生成审批 token
    let approval_token = uuid::Uuid::new_v4().to_string();
    
    // 创建待审批调用
    let pending = PendingToolCall {
        tool_id: None,
        tool_name: tool_name.to_string(),
        arguments: arguments.clone(),
        call_id: None,
        execution_token: None,
        tool_fingerprint: format!("shell_execute:{}", 
            arguments.get("command").and_then(|v| v.as_str()).unwrap_or("")
        ),
        approval_grant_key: None,
        created_at_unix_ms: chrono::Utc::now().timestamp_millis(),
        expires_at_unix_ms: chrono::Utc::now().timestamp_millis() + 300_000, // 5 minutes
    };
    
    // 存储
    pending_tool_calls.write().await.insert(approval_token.clone(), pending);
    
    // 返回审批请求
    Ok(json!({
        "status": "REQUIRES_APPROVAL",
        "approval_token": approval_token,
        "tool_name": tool_name,
        "arguments": arguments,
        "risk_level": risk.risk_level,
        "risk_reasons": risk.reasons,
        "expires_in_ms": 300_000,
    }))
}

/// 示例: 用户批准后执行
pub async fn execute_approved_shell_command(
    home_dir: PathBuf,
    arguments: Value,
) -> Result<Value, String> {
    // 创建 Shell Executor
    let shell_tool = ShellExecuteCoreTool::new(home_dir);
    
    // 执行命令
    shell_tool.execute(arguments).await
}

/// 示例: 在 Core Tool 系统中注册
pub fn register_shell_execute_tool() {
    use crate::modules::mcp::commands::runtime::CoreToolContract;
    
    let tool = CoreToolContract {
        name: "shell_execute",
        description: "Execute shell commands on the user's machine with security checks and user approval.",
        input_schema: json!({
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "The command to execute"
                },
                "working_dir": {
                    "type": "string",
                    "description": "Working directory"
                },
                "timeout_seconds": {
                    "type": "integer",
                    "default": 300
                }
            },
            "required": ["command"]
        }),
        output_schema: json!({
            "type": "object",
            "properties": {
                "stdout": {"type": "string"},
                "stderr": {"type": "string"},
                "exit_code": {"type": "integer"},
                "duration_ms": {"type": "integer"},
            }
        }),
        permission_scope: &["shell_execution", "host_access"],
        read_only: false,
        mutating: true,
        risk_level: "MEDIUM",
        example_arguments: json!({
            "command": "git status",
            "working_dir": "/home/user/project"
        }),
    };
    
    // 添加到 Core Tool 列表
    // code_mode_core_tools().push(tool);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    
    #[tokio::test]
    async fn test_shell_executor_integration() {
        let home_dir = PathBuf::from("/home/test");
        let pending_tool_calls = Arc::new(RwLock::new(HashMap::new()));
        
        // 测试白名单命令 (自动批准)
        let result = execute_shell_tool_example(
            home_dir.clone(),
            pending_tool_calls.clone(),
            "shell_execute",
            json!({"command": "git status"}),
        ).await;
        
        // 应该直接执行
        assert!(result.is_ok());
        
        // 测试危险命令 (需要审批)
        let result = execute_shell_tool_example(
            home_dir.clone(),
            pending_tool_calls.clone(),
            "shell_execute",
            json!({"command": "rm -rf node_modules"}),
        ).await;
        
        // 应该返回审批请求
        assert!(result.is_ok());
        let response = result.unwrap();
        assert_eq!(response["status"], "REQUIRES_APPROVAL");
        assert!(response.get("approval_token").is_some());
    }
    
    #[tokio::test]
    async fn test_risk_assessment() {
        let home_dir = PathBuf::from("/home/test");
        let shell_tool = ShellExecuteCoreTool::new(home_dir);
        
        // 测试低风险命令
        let risk = shell_tool.assess_risk("git status", &json!({}));
        assert_eq!(risk.risk_level, "LOW");
        assert!(!risk.requires_approval);
        
        // 测试高风险命令
        let risk = shell_tool.assess_risk("rm -rf /", &json!({}));
        assert_eq!(risk.risk_level, "CRITICAL");
        assert!(risk.requires_approval);
    }
}
