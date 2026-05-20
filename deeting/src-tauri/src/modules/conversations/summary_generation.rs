use super::summary_format::{
    build_local_summary_prompt_input, LOCAL_CONVERSATION_SUMMARY_MAX_CHARS,
};
use super::text_utils::{extract_text_from_chat_completion_response, truncate_text_chars};
use crate::modules::desktop_runtime::runtime::chat_completion::request_provider_chat_completion;
use crate::modules::providers::model_guard::resolve_local_secretary_model_connection;
use crate::state::AppState;
use mcp_core::types::LocalChatInputMessage;
use mcp_session::conversation::LocalConversationHistoryMessage;

pub(crate) const LOCAL_CONVERSATION_SUMMARY_MAX_TOKENS: u32 = 768;
pub(crate) const LOCAL_CONVERSATION_SUMMARY_WORKER_IDLE_INTERVAL_SECS: u64 = 2;
const LOCAL_CONVERSATION_TOPIC_TITLE_MAX_CHARS: usize = 40;
const LOCAL_CONVERSATION_TOPIC_NAMING_MAX_TOKENS: u32 = 48;
const LOCAL_CONVERSATION_AUXILIARY_TEMPERATURE: f32 = 0.2;
const LOCAL_CONVERSATION_TOPIC_NAMING_PROMPT_TEMPLATE: &str = r#"
你是会话命名器。请根据用户第一句话生成侧边栏会话标题。

硬性规则：
- 只输出最终标题文本，不要解释、不要复述用户内容、不要加前缀。
- 不要输出“首先”“用户的内容是”“用户的问题是”“标题是”等说明性句子。
- 标题控制在 4-16 个中文字符，或 3-8 个英文单词。
- 不要引号、句号、Markdown、编号、冒号。

用户第一句话：
{first_message}

最终标题：
"#;
const LOCAL_CONVERSATION_SUMMARY_PROMPT_TEMPLATE: &str = r#"
请对以下多轮对话内容进行摘要，要求：
1) 保留关键信息和上下文，包括用户意图、重要决策和结论；
2) 去除冗余和重复内容；
3) 摘要长度控制在 500 字以内；
4) 仅输出摘要文本，不要额外解释。

对话内容：
{conversation}
"#;

fn normalize_title_text(value: &str) -> String {
    let mut text = value.trim().replace(['\n', '\r'], " ");
    text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    text.trim_matches(|ch| matches!(ch, '“' | '”' | '"' | '\'' | '`' | '*' | '#'))
        .trim_matches(|ch| matches!(ch, ' ' | '-' | '–' | '—' | '·' | '•' | ':' | '：'))
        .trim_end_matches(|ch| matches!(ch, '。' | '.' | '！' | '!' | '？' | '?' | ';' | '；'))
        .to_string()
}

fn trim_title_after_marker(value: &str) -> Option<String> {
    const MARKERS: [&str; 14] = [
        "最终标题：",
        "最终标题:",
        "会话标题：",
        "会话标题:",
        "标题可以是：",
        "标题可以是:",
        "标题是：",
        "标题是:",
        "标题：",
        "标题:",
        "命名为：",
        "命名为:",
        "concise title:",
        "title:",
    ];
    let lower = value.to_ascii_lowercase();
    let mut marker_match = None;
    for marker in MARKERS {
        if let Some(index) = lower.rfind(&marker.to_ascii_lowercase()) {
            marker_match = Some((index, marker.len()));
            break;
        }
    }
    let (index, marker_len) = marker_match?;
    let candidate = &value[index + marker_len..];
    let candidate = candidate
        .split(['\n', '\r', '。', '！', '？', ';', '；'])
        .next()
        .unwrap_or(candidate);
    let text = normalize_title_text(candidate);
    (!text.is_empty()).then_some(text)
}

fn looks_like_title_explanation(value: &str) -> bool {
    let text = value.trim();
    if text.is_empty() {
        return false;
    }
    let lower = text.to_ascii_lowercase();
    [
        "首先",
        "好的",
        "嗯",
        "用户的内容",
        "用户内容",
        "用户的问题",
        "用户问",
        "用户说",
        "用户想",
        "the user",
        "user is asking",
        "based on",
        "this conversation",
        "sure",
    ]
    .iter()
    .any(|prefix| {
        text.starts_with(prefix)
            || lower.starts_with(&prefix.to_ascii_lowercase())
            || lower.starts_with(&format!("{},", prefix.to_ascii_lowercase()))
    })
}

fn sanitize_generated_title(title: &str, fallback: &str) -> Option<String> {
    let mut text = trim_title_after_marker(title).unwrap_or_else(|| {
        title
            .lines()
            .find(|line| !line.trim().is_empty())
            .map(normalize_title_text)
            .unwrap_or_default()
    });
    if looks_like_title_explanation(&text) {
        text.clear();
    }
    if text.is_empty() {
        text = normalize_title_text(fallback);
    }
    if text.is_empty() {
        return None;
    }
    Some(truncate_text_chars(
        &text,
        LOCAL_CONVERSATION_TOPIC_TITLE_MAX_CHARS,
    ))
}

pub(crate) async fn request_local_auxiliary_text(
    app_state: &AppState,
    provider_model_id: &str,
    model_id: &str,
    prompt: &str,
    max_tokens: Option<u32>,
    session_id: Option<&str>,
) -> Result<Option<String>, String> {
    let response = request_provider_chat_completion(
        app_state,
        provider_model_id,
        model_id,
        vec![LocalChatInputMessage {
            role: "user".to_string(),
            content: prompt.to_string(),
            reasoning_content: None,
            tool_calls: vec![],
            tool_call_id: None,
            name: None,
        }],
        None,
        Some(LOCAL_CONVERSATION_AUXILIARY_TEMPERATURE),
        max_tokens,
        crate::modules::ai_upstream::ReasoningRequestConfig::default(),
        None,
        session_id,
    )
    .await?;
    Ok(extract_text_from_chat_completion_response(&response))
}

pub(crate) async fn generate_local_conversation_title_with_model(
    app_state: &AppState,
    provider_model_id: &str,
    model_id: &str,
    first_message: &str,
    session_id: Option<&str>,
) -> Result<Option<String>, String> {
    let normalized_first_message = first_message.trim();
    if normalized_first_message.is_empty() {
        return Ok(None);
    }
    let prompt = LOCAL_CONVERSATION_TOPIC_NAMING_PROMPT_TEMPLATE
        .replace("{first_message}", normalized_first_message);
    let generated = request_local_auxiliary_text(
        app_state,
        provider_model_id,
        model_id,
        &prompt,
        Some(LOCAL_CONVERSATION_TOPIC_NAMING_MAX_TOKENS),
        session_id,
    )
    .await?;
    Ok(generated.and_then(|value| sanitize_generated_title(&value, normalized_first_message)))
}

pub(crate) async fn generate_local_conversation_title_with_secretary_model(
    app_state: &AppState,
    first_message: &str,
    session_id: Option<&str>,
) -> Result<Option<String>, String> {
    let model_connection = resolve_local_secretary_model_connection(app_state).await?;

    generate_local_conversation_title_with_model(
        app_state,
        &model_connection.provider_model_id,
        &model_connection.model_id,
        first_message,
        session_id,
    )
    .await
}

pub(crate) async fn generate_local_conversation_summary_with_model(
    app_state: &AppState,
    provider_model_id: &str,
    model_id: &str,
    messages: &[LocalConversationHistoryMessage],
    session_id: Option<&str>,
) -> Result<Option<String>, String> {
    let conversation = build_local_summary_prompt_input(messages);
    if conversation.trim().is_empty() {
        return Ok(None);
    }
    let prompt =
        LOCAL_CONVERSATION_SUMMARY_PROMPT_TEMPLATE.replace("{conversation}", &conversation);
    let generated = request_local_auxiliary_text(
        app_state,
        provider_model_id,
        model_id,
        &prompt,
        Some(LOCAL_CONVERSATION_SUMMARY_MAX_TOKENS),
        session_id,
    )
    .await?;
    Ok(generated
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(|value| truncate_text_chars(&value, LOCAL_CONVERSATION_SUMMARY_MAX_CHARS)))
}

pub(crate) async fn generate_local_conversation_summary_with_secretary_model(
    app_state: &AppState,
    messages: &[LocalConversationHistoryMessage],
    session_id: Option<&str>,
) -> Result<Option<(String, String)>, String> {
    let model_connection = resolve_local_secretary_model_connection(app_state).await?;
    let model_id = model_connection.model_id.clone();
    let summary = generate_local_conversation_summary_with_model(
        app_state,
        &model_connection.provider_model_id,
        &model_id,
        messages,
        session_id,
    )
    .await?;

    Ok(summary.map(|value| (value, model_id)))
}

#[cfg(test)]
mod tests {
    use super::sanitize_generated_title;

    #[test]
    fn title_sanitizer_removes_markdown_wrappers() {
        let title =
            sanitize_generated_title("**开源桌面AI引擎 Deeting 讨论**", "请介绍 Deeting 桌面端");

        assert_eq!(title.as_deref(), Some("开源桌面AI引擎 Deeting 讨论"));
    }

    #[test]
    fn title_sanitizer_extracts_title_after_explanation_marker() {
        let title = sanitize_generated_title(
            "首先，用户的内容是：“一辆车在高速上爆胎怎么办”，所以标题可以是：高速爆胎处理。",
            "一辆车在高速上爆胎怎么办",
        );

        assert_eq!(title.as_deref(), Some("高速爆胎处理"));
    }

    #[test]
    fn title_sanitizer_falls_back_when_response_explains_instead_of_names() {
        let title = sanitize_generated_title(
            "用户的内容是关于 hallucination 的讨论，需要总结成标题。",
            "hallucination 是什么，怎么缓解",
        );

        assert_eq!(title.as_deref(), Some("hallucination 是什么，怎么缓解"));
    }

    #[test]
    fn title_sanitizer_handles_english_title_marker() {
        let title = sanitize_generated_title(
            "The user is asking about FT. A concise title: FT Concept Discussion",
            "What is FT?",
        );

        assert_eq!(title.as_deref(), Some("FT Concept Discussion"));
    }
}
