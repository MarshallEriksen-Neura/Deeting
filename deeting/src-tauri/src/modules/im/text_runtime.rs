use std::collections::HashMap;
use std::future::Future;

use crate::modules::im::handlers::{
    build_direct_card_action_outcome, build_text_approval_prompt, generate_local_chat_reply_outcome,
};
use crate::modules::im::{ImConnectionProfile, MessageContent};
use crate::state::AppState;

#[derive(Debug, Clone)]
struct PendingTextApproval {
    approval_token: String,
    call_id: Option<String>,
    tool_name: String,
}

#[derive(Debug, Default)]
pub(crate) struct TextImConversationRuntime {
    pending_text_approvals: HashMap<String, PendingTextApproval>,
}

impl TextImConversationRuntime {
    pub async fn handle_incoming_text<F, Fut>(
        &mut self,
        app_state: &AppState,
        app_handle: &tauri::AppHandle,
        profile: &ImConnectionProfile,
        peer_id: &str,
        text: &str,
        channel_label: &str,
        mut send_text: F,
    ) -> Result<(), String>
    where
        F: FnMut(String) -> Fut,
        Fut: Future<Output = Result<(), String>>,
    {
        if let Some(pending) = self.pending_text_approvals.get(peer_id).cloned() {
            if let Some(approved) = parse_text_approval_command(text) {
                self.pending_text_approvals.remove(peer_id);
                let outcome = build_direct_card_action_outcome(
                    app_handle,
                    app_state,
                    if approved {
                        "approve_tool"
                    } else {
                        "reject_tool"
                    },
                    &serde_json::json!({
                        "approval_token": pending.approval_token,
                        "call_id": pending.call_id,
                        "tool_name": pending.tool_name,
                    }),
                )
                .await?;

                let mut sent_any = false;
                for follow_up in outcome.follow_up_messages {
                    if let MessageContent::Text { text } = follow_up {
                        send_text(text).await?;
                        sent_any = true;
                    }
                }
                if !sent_any {
                    send_text(
                        if approved {
                            "已批准，当前流程继续执行。"
                        } else {
                            "已拒绝，本次工具调用不会继续执行。"
                        }
                        .to_string(),
                    )
                    .await?;
                }
                return Ok(());
            }

            send_text("当前有待审批操作，请先回复 `1` 确认执行，或回复 `0` 拒绝执行。".to_string())
                .await?;
            return Ok(());
        }

        let session_id = format!("im:{}:chat:{}", profile.id, peer_id);
        send_text("收到，正在处理中…".to_string()).await?;

        let Some(reply_outcome) =
            generate_local_chat_reply_outcome(app_state, app_handle, text, session_id.as_str())
                .await?
        else {
            return Ok(());
        };

        if let Some(approval_request) = reply_outcome.approval_request {
            let approval_prompt = build_text_approval_prompt(&approval_request);
            self.pending_text_approvals.insert(
                peer_id.to_string(),
                PendingTextApproval {
                    approval_token: approval_request.approval_token,
                    call_id: approval_request.call_id,
                    tool_name: approval_request.tool_name,
                },
            );
            send_text(approval_prompt).await?;
            return Ok(());
        }

        match reply_outcome.content {
            MessageContent::Text { text } => {
                send_text(text).await?;
            }
            _ => {
                send_text(format!(
                    "当前{}通道暂不支持该回复格式，请在桌面端查看完整结果。",
                    channel_label
                ))
                .await?;
            }
        }

        Ok(())
    }
}

pub(crate) fn parse_text_approval_command(text: &str) -> Option<bool> {
    match text.trim() {
        "1" => Some(true),
        "0" => Some(false),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::parse_text_approval_command;

    #[test]
    fn parse_text_approval_command_accepts_numeric_choices() {
        assert_eq!(parse_text_approval_command("1"), Some(true));
        assert_eq!(parse_text_approval_command("0"), Some(false));
        assert_eq!(parse_text_approval_command(" yes "), None);
    }
}
