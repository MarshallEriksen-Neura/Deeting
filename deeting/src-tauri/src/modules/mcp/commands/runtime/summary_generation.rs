use super::super::{runtime::request_provider_chat_completion, support::*};
use super::summary_format::{
    build_local_summary_prompt_input, LOCAL_CONVERSATION_SUMMARY_MAX_CHARS,
};
use super::text_utils::{extract_text_from_chat_completion_response, truncate_text_chars};

pub(crate) const LOCAL_CONVERSATION_SUMMARY_MAX_TOKENS: u32 = 768;
pub(crate) const LOCAL_CONVERSATION_SUMMARY_WORKER_IDLE_INTERVAL_SECS: u64 = 2;
const LOCAL_CONVERSATION_TOPIC_TITLE_MAX_CHARS: usize = 40;
const LOCAL_CONVERSATION_TOPIC_NAMING_MAX_TOKENS: u32 = 96;
const LOCAL_CONVERSATION_AUXILIARY_TEMPERATURE: f32 = 0.2;
const LOCAL_CONVERSATION_TOPIC_NAMING_PROMPT_TEMPLATE: &str = r#"
请根据用户的第一句话生成一个简短话题标题，要求：
1) 10-20 字以内；2) 不要引号与句号；3) 仅输出标题文本。
用户内容：{first_message}
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

fn sanitize_generated_title(title: &str, fallback: &str) -> Option<String> {
    let mut text = title.trim().replace(['\n', '\r'], " ");
    text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    text = text
        .trim_matches(|ch| matches!(ch, '“' | '”' | '"' | '\'' | '`'))
        .trim_matches(|ch| matches!(ch, ' ' | '-' | '–' | '—' | '·' | '•' | ':' | '：'))
        .to_string();
    if text.is_empty() {
        text = fallback.trim().to_string();
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
    max_tokens: u32,
    session_id: Option<&str>,
) -> Result<Option<String>, String> {
    let response = request_provider_chat_completion(
        app_state,
        provider_model_id,
        model_id,
        vec![LocalChatInputMessage {
            role: "user".to_string(),
            content: prompt.to_string(),
        }],
        None,
        Some(LOCAL_CONVERSATION_AUXILIARY_TEMPERATURE),
        Some(max_tokens),
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
        LOCAL_CONVERSATION_TOPIC_NAMING_MAX_TOKENS,
        session_id,
    )
    .await?;
    Ok(generated.and_then(|value| sanitize_generated_title(&value, normalized_first_message)))
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
        LOCAL_CONVERSATION_SUMMARY_MAX_TOKENS,
        session_id,
    )
    .await?;
    Ok(generated
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(|value| truncate_text_chars(&value, LOCAL_CONVERSATION_SUMMARY_MAX_CHARS)))
}
