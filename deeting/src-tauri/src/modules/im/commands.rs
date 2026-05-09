use mcp_session::conversation::LocalConversationCreateRequest;
use serde::{Deserialize, Serialize};

use crate::modules::im::ImConnectionProfile;
use crate::state::AppState;

use super::MessageContent;

const IM_ACTIVE_SESSION_CONFIG_KEY_PREFIX: &str = "im.active_session";
const IM_SESSION_LIST_CONFIG_KEY_PREFIX: &str = "im.session_list";
const IM_SESSION_LIST_MAX_ITEMS: usize = 12;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct StoredImSessionList {
    session_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ResolvedImSession {
    session_id: String,
    title: String,
    is_default: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ImCommand {
    NewSession,
    Sessions,
    Current,
    Reset,
    UseSession { index: usize },
    UseSessionInvalid,
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
        "sessions" => Some(ImCommand::Sessions),
        "current" => Some(ImCommand::Current),
        "reset" => Some(ImCommand::Reset),
        "use" => {
            let index = trimmed
                .split_whitespace()
                .nth(1)
                .and_then(|value| value.trim().parse::<usize>().ok())
                .filter(|value| *value > 0);
            Some(match index {
                Some(index) => ImCommand::UseSession { index },
                None => ImCommand::UseSessionInvalid,
            })
        }
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

fn build_im_session_list_config_key(profile_id: &str, peer_id: &str) -> String {
    format!(
        "{}.{}.{}",
        IM_SESSION_LIST_CONFIG_KEY_PREFIX,
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

async fn load_peer_session_ids(
    app_state: &AppState,
    profile_id: &str,
    peer_id: &str,
) -> Result<Vec<String>, String> {
    let key = build_im_session_list_config_key(profile_id, peer_id);
    let raw = app_state
        .mcp
        .store
        .get_desktop_config(&key)
        .await
        .map_err(|err| err.to_string())?;
    let Some(raw) = raw.map(|value| value.trim().to_string()) else {
        return Ok(Vec::new());
    };
    if raw.is_empty() {
        return Ok(Vec::new());
    }

    let parsed = serde_json::from_str::<StoredImSessionList>(&raw).unwrap_or(StoredImSessionList {
        session_ids: Vec::new(),
    });
    let mut deduped = Vec::new();
    for session_id in parsed.session_ids {
        let normalized = session_id.trim().to_string();
        if normalized.is_empty() || deduped.contains(&normalized) {
            continue;
        }
        deduped.push(normalized);
    }
    Ok(deduped)
}

async fn persist_peer_session_ids(
    app_state: &AppState,
    profile_id: &str,
    peer_id: &str,
    session_ids: &[String],
) -> Result<(), String> {
    let key = build_im_session_list_config_key(profile_id, peer_id);
    let payload = StoredImSessionList {
        session_ids: session_ids.to_vec(),
    };
    let serialized = serde_json::to_string(&payload).map_err(|err| err.to_string())?;
    app_state
        .mcp
        .store
        .set_desktop_config(&key, &serialized)
        .await
        .map_err(|err| err.to_string())
}

async fn prepend_peer_session_id(
    app_state: &AppState,
    profile_id: &str,
    peer_id: &str,
    session_id: &str,
) -> Result<(), String> {
    let normalized = session_id.trim().to_string();
    if normalized.is_empty() {
        return Ok(());
    }

    let mut session_ids = load_peer_session_ids(app_state, profile_id, peer_id).await?;
    session_ids.retain(|item| item != &normalized);
    session_ids.insert(0, normalized);
    session_ids.truncate(IM_SESSION_LIST_MAX_ITEMS);
    persist_peer_session_ids(app_state, profile_id, peer_id, &session_ids).await
}

fn build_new_session_title(profile: &ImConnectionProfile, peer_id: &str) -> String {
    format!("IM {} {}", profile.platform, peer_id.trim())
}

fn default_session_title(profile: &ImConnectionProfile, peer_id: &str) -> String {
    format!("默认主会话 ({}/{})", profile.platform, peer_id.trim())
}

async fn resolve_known_sessions(
    app_state: &AppState,
    profile: &ImConnectionProfile,
    peer_id: &str,
) -> Result<Vec<ResolvedImSession>, String> {
    let default_session_id = default_im_session_id(profile.id.as_str(), peer_id);
    let mut sessions = vec![ResolvedImSession {
        session_id: default_session_id.clone(),
        title: default_session_title(profile, peer_id),
        is_default: true,
    }];

    let persisted = load_peer_session_ids(app_state, profile.id.as_str(), peer_id).await?;
    let mut cleaned = Vec::new();
    for session_id in persisted {
        if session_id == default_session_id {
            continue;
        }
        let details = match app_state
            .mcp
            .store
            .get_local_admin_conversation(&session_id)
            .await
        {
            Ok(item) => item,
            Err(_) => continue,
        };
        let title = details
            .title
            .clone()
            .unwrap_or_else(|| format!("会话 {}", session_id));
        cleaned.push(session_id.clone());
        sessions.push(ResolvedImSession {
            session_id,
            title,
            is_default: false,
        });
    }

    persist_peer_session_ids(app_state, profile.id.as_str(), peer_id, &cleaned).await?;
    Ok(sessions)
}

fn format_sessions_reply(
    sessions: &[ResolvedImSession],
    current_session_id: &str,
) -> MessageContent {
    let mut lines = vec!["可用会话：".to_string()];
    for (index, session) in sessions.iter().enumerate() {
        let current_marker = if session.session_id == current_session_id {
            " [当前]"
        } else {
            ""
        };
        let default_marker = if session.is_default { " [默认]" } else { "" };
        lines.push(format!(
            "{}. {}{}{}",
            index + 1,
            session.title,
            default_marker,
            current_marker
        ));
    }
    lines.push("发送 `/use 序号` 切换，发送 `/new` 新建会话。".to_string());
    MessageContent::Text {
        text: lines.join("\n"),
    }
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
    let default_session_id = default_im_session_id(profile.id.as_str(), peer_id);
    let active_session_id = load_active_session_id(app_state, profile.id.as_str(), peer_id)
        .await?
        .unwrap_or_else(|| default_session_id.clone());

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
            prepend_peer_session_id(app_state, profile.id.as_str(), peer_id, &created.session_id)
                .await?;

            ImCommandOutcome {
                reply: MessageContent::Text {
                    text: "已创建新会话，后续消息会进入这个新会话。\n发送 `/sessions` 可查看会话列表。"
                        .to_string(),
                },
                active_session_id: Some(created.session_id),
            }
        }
        ImCommand::Sessions => {
            let sessions = resolve_known_sessions(app_state, profile, peer_id).await?;
            ImCommandOutcome {
                reply: format_sessions_reply(&sessions, &active_session_id),
                active_session_id: None,
            }
        }
        ImCommand::Current => {
            let sessions = resolve_known_sessions(app_state, profile, peer_id).await?;
            let current = sessions
                .iter()
                .find(|session| session.session_id == active_session_id)
                .cloned()
                .unwrap_or(ResolvedImSession {
                    session_id: active_session_id.clone(),
                    title: "当前会话".to_string(),
                    is_default: active_session_id == default_session_id,
                });
            ImCommandOutcome {
                reply: MessageContent::Text {
                    text: format!(
                        "当前会话：{}{}\n发送 `/sessions` 查看所有会话。",
                        current.title,
                        if current.is_default { " [默认]" } else { "" }
                    ),
                },
                active_session_id: None,
            }
        }
        ImCommand::Reset => {
            persist_active_session_id(
                app_state,
                profile.id.as_str(),
                peer_id,
                default_session_id.as_str(),
            )
            .await?;
            ImCommandOutcome {
                reply: MessageContent::Text {
                    text: "已切回默认主会话。".to_string(),
                },
                active_session_id: Some(default_session_id),
            }
        }
        ImCommand::UseSession { index } => {
            let sessions = resolve_known_sessions(app_state, profile, peer_id).await?;
            let Some(target) = sessions.get(index.saturating_sub(1)).cloned() else {
                let reply = format_sessions_reply(&sessions, &active_session_id);
                return Ok(Some(ImCommandOutcome {
                    reply: match reply {
                        MessageContent::Text { text } => MessageContent::Text {
                            text: format!("会话编号无效。\n{text}"),
                        },
                        other => other,
                    },
                    active_session_id: None,
                }));
            };
            persist_active_session_id(
                app_state,
                profile.id.as_str(),
                peer_id,
                target.session_id.as_str(),
            )
            .await?;
            if !target.is_default {
                prepend_peer_session_id(
                    app_state,
                    profile.id.as_str(),
                    peer_id,
                    target.session_id.as_str(),
                )
                .await?;
            }
            ImCommandOutcome {
                reply: MessageContent::Text {
                    text: format!("已切换到会话：{}", target.title),
                },
                active_session_id: Some(target.session_id),
            }
        }
        ImCommand::UseSessionInvalid => ImCommandOutcome {
            reply: MessageContent::Text {
                text: "用法不对。请发送 `/use 2` 这样的命令切换到某个会话。".to_string(),
            },
            active_session_id: None,
        },
        ImCommand::Unknown { raw_name } => ImCommandOutcome {
            reply: MessageContent::Text {
                text: format!(
                    "暂不支持命令 `/{}`。\n当前可用命令：`/new`、`/sessions`、`/use`、`/current`、`/reset`",
                    raw_name
                ),
            },
            active_session_id: None,
        },
    };

    Ok(Some(outcome))
}

#[cfg(test)]
mod tests {
    use super::{
        build_im_active_session_config_key, build_im_session_list_config_key, parse_im_command,
        ImCommand,
    };

    #[test]
    fn parse_im_command_recognizes_new_session_command() {
        assert_eq!(parse_im_command("/new"), Some(ImCommand::NewSession));
        assert_eq!(parse_im_command(" /NEW  "), Some(ImCommand::NewSession));
        assert_eq!(
            parse_im_command("/new extra words"),
            Some(ImCommand::NewSession)
        );
        assert_eq!(parse_im_command("/sessions"), Some(ImCommand::Sessions));
        assert_eq!(parse_im_command("/current"), Some(ImCommand::Current));
        assert_eq!(parse_im_command("/reset"), Some(ImCommand::Reset));
        assert_eq!(
            parse_im_command("/use 2"),
            Some(ImCommand::UseSession { index: 2 })
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
        assert_eq!(parse_im_command("/use"), Some(ImCommand::UseSessionInvalid));
        assert_eq!(
            parse_im_command("/use abc"),
            Some(ImCommand::UseSessionInvalid)
        );
        assert_eq!(parse_im_command("hello"), None);
    }

    #[test]
    fn build_im_active_session_config_key_is_stable() {
        assert_eq!(
            build_im_active_session_config_key("profile-1", "peer-9"),
            "im.active_session.profile-1.peer-9"
        );
        assert_eq!(
            build_im_session_list_config_key("profile-1", "peer-9"),
            "im.session_list.profile-1.peer-9"
        );
    }
}
