use crate::modules::ai_upstream::request_provider_chat_completion;
use crate::modules::providers::model_guard::resolve_local_secretary_model_connection;
use crate::state::AppState;
use mcp_core::types::LocalChatInputMessage;

const PLAN_GENERATOR_SYSTEM_PROMPT: &str = r#"
You are a workflow plan generator for a desktop AI assistant called Deeting.

Your job is to take a user's goal and produce a coarse-grained workflow proposal with 3-5 phases.

Output format — use this exact markdown template:

# Workflow Proposal

Title: {short title}
Goal: {user's goal restated clearly}

## Global Constraints
- {any constraints from the user's request}

## Phase 1: {phase title}
- Worker: direct_llm:default
- Goal: {what this phase should accomplish}
- Expected output: {name of the expected output}
- User Notes:

## Phase 2: {phase title}
- Worker: direct_llm:default
- Goal: {what this phase should accomplish}
- Expected output: {name}
- Depends on: Phase 1
- User Notes:

(continue for 3-5 phases)

Rules:
- Keep phases coarse. Each phase is a bounded unit of work, not a detailed step.
- Default worker to "direct_llm:default" unless the user mentions a specific capability.
- Always end with a finalization/synthesis phase.
- Phase dependencies should be listed as "Depends on: Phase N" when applicable.
- Leave "User Notes:" empty — the user will fill it in.
- Write in the same language as the user's goal.
"#;

fn build_user_content(goal: &str, hints: Option<&str>) -> String {
    let mut content = format!("Goal: {}", goal.trim());
    if let Some(hints) = hints.map(str::trim).filter(|value| !value.is_empty()) {
        content.push_str("\n\nAdditional context: ");
        content.push_str(hints);
    }
    content
}

fn extract_proposal_text(response: &serde_json::Value) -> Result<String, String> {
    let proposal_text = response
        .get("content")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    if proposal_text.is_empty() {
        Err("LLM returned empty proposal".to_string())
    } else {
        Ok(proposal_text)
    }
}

pub(crate) async fn generate_proposal(
    app_state: &AppState,
    goal: &str,
    hints: Option<&str>,
) -> Result<String, String> {
    let normalized_goal = goal.trim();
    if normalized_goal.is_empty() {
        return Err("workflow proposal goal is required".to_string());
    }

    let model_connection = resolve_local_secretary_model_connection(app_state).await?;
    let messages = vec![
        LocalChatInputMessage {
            role: "system".to_string(),
            content: PLAN_GENERATOR_SYSTEM_PROMPT.to_string(),
            tool_calls: vec![],
            tool_call_id: None,
            name: None,
        },
        LocalChatInputMessage {
            role: "user".to_string(),
            content: build_user_content(normalized_goal, hints),
            tool_calls: vec![],
            tool_call_id: None,
            name: None,
        },
    ];

    let response = request_provider_chat_completion(
        app_state,
        &model_connection.provider_model_id,
        &model_connection.model_id,
        messages,
        None,
        Some(0.3),
        Some(2048),
        None,
        None,
    )
    .await?;

    extract_proposal_text(&response)
}

#[cfg(test)]
mod tests {
    use super::{build_user_content, extract_proposal_text};

    #[test]
    fn build_user_content_includes_hints_when_present() {
        let content = build_user_content("Do a thing", Some("Focus on desktop only"));
        assert!(content.contains("Goal: Do a thing"));
        assert!(content.contains("Additional context: Focus on desktop only"));
    }

    #[test]
    fn extract_proposal_text_rejects_empty_response() {
        let error = extract_proposal_text(&serde_json::json!({ "content": "" }))
            .expect_err("empty content should fail");
        assert!(error.contains("empty proposal"));
    }
}
