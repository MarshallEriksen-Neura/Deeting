use mcp_session::conversation::LocalConversationCreateRequest;

use crate::modules::im::ImConnectionProfile;
use crate::state::AppState;

use super::MessageContent;

const IM_ACTIVE_SESSION_CONFIG_KEY_PREFIX: &str = "im.active_session";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ImCommand {
    NewSession,
    Unknown { raw_name: String },
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ImCommandOutcome {
    pub reply: MessageContent,
    pub active_session_id: Option<String>,
}

pub(crate) fn default_im_session_id(profile_id: &str, peer_id: &str) -> String {
    format!("im:{}:chat:{}", profile_id.trim(), peer_id.trim())
}

pub(crate) fn parse_im_command(text: &str) -> Option<ImCommand> {
    let trimmed = text.trim();
    if !trimmed.starts_with('/') {
        return None;
    }

    let raw_name = trimmed
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .trim()
        .trim_start_matches('/')
        .to_ascii_lowercase();

    if raw_name.is_empty() {
        return None;
    }

    match raw_name.as_str() {
        "new" => Some(ImCommand::NewSession),
        _ => Some(ImCommand::Unknown { raw_name }),
    }
}

pub(crate) fn build_im_active_session_config_key(profile_id: &str, peer_id: &str) -> String {
    format!(
        "{}.{}.{}",
        IM_ACTIVE_SESSION_CONFIG_KEY_PREFIX,
        profile_id.trim(),
        peer_id.trim()
    )
}

pub(crate) async fn load_active_session_id(
    app_state: &AppState,
    profile_id: &str,
    peer_id: &str,
) -> Result<Option<String>, String> {
    let key = build_im_active_session_config_key(profile_id, peer_id);
    let value = app_state
        .mcp
        .store
        .get_desktop_config(&key)
        .await
        .map_err(|err| err.to_string())?;

    Ok(value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty()))
}

pub(crate) async fn persist_active_session_id(
    app_state: &AppState,
    profile_id: &str,
    peer_id: &str,
    session_id: &str,
) -> Result<(), String> {
    let normalized_session_id = session_id.trim();
    if normalized_session_id.is_empty() {
        return Err("session_id is required".to_string());
    }

    let key = build_im_active_session_config_key(profile_id, peer_id);
    app_state
        .mcp
        .store
        .set_desktop_config(&key, normalized_session_id)
        .await
        .map_err(|err| err.to_string())
}

fn build_new_session_title(profile: &ImConnectionProfile, peer_id: &str) -> String {
    format!("IM {} {}", profile.platform, peer_id.trim())
}

pub(crate) async fn execute_im_command(
    app_state: &AppState,
    profile: &ImConnectionProfile,
    peer_id: &str,
    text: &str,
) -> Result<Option<ImCommandOutcome>, String> {
    let Some(command) = parse_im_command(text) else {
        return Ok(None);
    };

    let outcome = match command {
        ImCommand::NewSession => {
            let created = app_state
                .mcp
                .store
                .create_local_conversation(LocalConversationCreateRequest {
                    assistant_id: None,
                    title: Some(build_new_session_title(profile, peer_id)),
                })
                .await
                .map_err(|err| err.to_string())?;

            persist_active_session_id(app_state, profile.id.as_str(), peer_id, &created.session_id)
                .await?;

            ImCommandOutcome {
                reply: MessageContent::Text {
                    text: format!(
                        "已创建新会话，后续消息将进入这个会话。\n会话 ID: `{}`",
                        created.session_id
                    ),
                },
                active_session_id: Some(created.session_id),
            }
        }
        ImCommand::Unknown { raw_name } => ImCommandOutcome {
            reply: MessageContent::Text {
                text: format!("暂不支持命令 `/{}`。\n当前可用命令：`/new`", raw_name),
            },
            active_session_id: None,
        },
    };

    Ok(Some(outcome))
}

#[cfg(test)]
mod tests {
    use super::{build_im_active_session_config_key, parse_im_command, ImCommand};

    #[test]
    fn parse_im_command_recognizes_new_session_command() {
        assert_eq!(parse_im_command("/new"), Some(ImCommand::NewSession));
        assert_eq!(parse_im_command(" /NEW  "), Some(ImCommand::NewSession));
        assert_eq!(
            parse_im_command("/new extra words"),
            Some(ImCommand::NewSession)
        );
    }

    #[test]
    fn parse_im_command_marks_unknown_slash_command() {
        assert_eq!(
            parse_im_command("/resume"),
            Some(ImCommand::Unknown {
                raw_name: "resume".to_string(),
            })
        );
        assert_eq!(parse_im_command("hello"), None);
    }

    #[test]
    fn build_im_active_session_config_key_is_stable() {
        assert_eq!(
            build_im_active_session_config_key("profile-1", "peer-9"),
            "im.active_session.profile-1.peer-9"
        );
    }
}
