use desktop_runtime_core::{
    Assumption, ExecutionStrategy, Fact, Rule, Unknown, VerificationTarget, WorldModelFrame,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub(crate) const WORLD_MODEL_UPDATE_FIELD: &str = "world_model_update";
pub(crate) const WORLD_MODEL_UPDATE_START_TAG: &str = "<!--wm_update-->";
pub(crate) const WORLD_MODEL_UPDATE_END_TAG: &str = "<!--/wm_update-->";

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct WorldModelUpdate {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub intent: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub execution_strategy: Option<ExecutionStrategy>,
    #[serde(default)]
    pub facts: Vec<String>,
    #[serde(default)]
    pub assumptions: Vec<String>,
    #[serde(default)]
    pub resolved_unknowns: Vec<String>,
    #[serde(default)]
    pub new_unknowns: Vec<String>,
    #[serde(default)]
    pub verification_targets: Vec<String>,
    #[serde(default)]
    pub rules: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proposed_next_phase: Option<ProposedPhase>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct ProposedPhase {
    pub step_type: String,
    pub rationale: String,
    #[serde(default)]
    pub verification_target_refs: Vec<String>,
}

pub(crate) struct ExtractedWorldModelUpdate {
    pub update: WorldModelUpdate,
    pub stripped_text: String,
}

pub(crate) fn parse_world_model_update_value(args: &Value) -> WorldModelUpdate {
    let intent = string_field(args, "intent");
    let execution_strategy = args
        .get("execution_strategy")
        .or_else(|| args.get("strategy_revision"))
        .and_then(Value::as_str)
        .and_then(parse_execution_strategy);
    let facts = string_list_field(args, "facts")
        .or_else(|| {
            args.get("context_assessment")
                .and_then(Value::as_str)
                .map(split_sentences)
        })
        .unwrap_or_default();
    let assumptions = string_list_field(args, "assumptions").unwrap_or_else(|| {
        facts
            .iter()
            .filter(|sentence| is_assumption_sentence(sentence))
            .cloned()
            .collect()
    });
    let resolved_unknowns = string_list_field(args, "resolved_unknowns").unwrap_or_default();
    let new_unknowns = string_list_field(args, "new_unknowns")
        .or_else(|| string_list_field(args, "unknowns"))
        .unwrap_or_default();
    let verification_targets = string_list_field(args, "verification_targets")
        .or_else(|| {
            args.get("tool_plan")
                .and_then(Value::as_str)
                .map(split_step_entries)
        })
        .unwrap_or_default();
    let rules = string_list_field(args, "rules")
        .or_else(|| {
            args.get("constraints")
                .and_then(Value::as_str)
                .map(split_step_entries)
        })
        .unwrap_or_default();
    let proposed_next_phase = args
        .get("proposed_next_phase")
        .and_then(Value::as_object)
        .and_then(parse_proposed_phase);

    WorldModelUpdate {
        intent,
        execution_strategy,
        facts,
        assumptions,
        resolved_unknowns,
        new_unknowns,
        verification_targets,
        rules,
        proposed_next_phase,
    }
}

pub(crate) fn extract_world_model_update_from_text(
    text: &str,
) -> Option<ExtractedWorldModelUpdate> {
    let start = text.find(WORLD_MODEL_UPDATE_START_TAG)?;
    let payload_start = start + WORLD_MODEL_UPDATE_START_TAG.len();
    let relative_end = text[payload_start..].find(WORLD_MODEL_UPDATE_END_TAG)?;
    let end = payload_start + relative_end;
    let payload = text[payload_start..end].trim();
    let value = serde_json::from_str::<Value>(payload).ok()?;
    let update = parse_world_model_update_value(&value);
    let stripped_text = format!(
        "{}{}",
        text[..start].trim_end(),
        text[end + WORLD_MODEL_UPDATE_END_TAG.len()..].trim_start()
    )
    .trim()
    .to_string();
    Some(ExtractedWorldModelUpdate {
        update,
        stripped_text,
    })
}

pub(crate) fn extract_world_model_update_from_response(
    mut response: Value,
) -> (Value, Option<WorldModelUpdate>) {
    let Some(content) = response.get("content").and_then(Value::as_str) else {
        return (response, None);
    };
    let Some(extracted) = extract_world_model_update_from_text(content) else {
        return (response, None);
    };
    if let Some(object) = response.as_object_mut() {
        object.insert(
            "content".to_string(),
            Value::String(extracted.stripped_text.clone()),
        );
        object.insert(
            WORLD_MODEL_UPDATE_FIELD.to_string(),
            serde_json::to_value(&extracted.update).unwrap_or(Value::Null),
        );
    }
    (response, Some(extracted.update))
}

pub(crate) fn apply_world_model_update_to_frame(
    mut frame: WorldModelFrame,
    update: Option<&WorldModelUpdate>,
) -> WorldModelFrame {
    let Some(update) = update else {
        return frame;
    };

    if let Some(strategy) = update.execution_strategy {
        frame.execution_strategy = strategy;
    }

    for statement in &update.facts {
        if frame.known_facts.iter().any(|fact| {
            fact.source == WORLD_MODEL_UPDATE_FIELD && fact.statement == statement.as_str()
        }) {
            continue;
        }
        let index = frame.known_facts.len();
        frame.known_facts.push(Fact {
            id: format!("wm-fact-{index}"),
            statement: statement.clone(),
            source: WORLD_MODEL_UPDATE_FIELD.to_string(),
        });
    }
    if !frame
        .known_facts
        .iter()
        .any(|fact| fact.source == WORLD_MODEL_UPDATE_FIELD)
    {
        let index = frame.known_facts.len();
        frame.known_facts.push(Fact {
            id: format!("wm-fact-{index}"),
            statement: update
                .intent
                .clone()
                .unwrap_or_else(|| "world model update captured frame metadata".to_string()),
            source: WORLD_MODEL_UPDATE_FIELD.to_string(),
        });
    }
    for statement in &update.assumptions {
        if frame
            .assumptions
            .iter()
            .any(|assumption| assumption.statement == statement.as_str())
        {
            continue;
        }
        let index = frame.assumptions.len();
        frame.assumptions.push(Assumption {
            id: format!("wm-assumption-{index}"),
            statement: statement.clone(),
        });
    }
    for resolved in &update.resolved_unknowns {
        frame
            .unknowns
            .retain(|unknown| unknown.question != resolved.as_str());
    }
    for question in &update.new_unknowns {
        if frame
            .unknowns
            .iter()
            .any(|unknown| unknown.question == question.as_str())
        {
            continue;
        }
        let index = frame.unknowns.len();
        frame.unknowns.push(Unknown {
            id: format!("wm-unknown-{index}"),
            question: question.clone(),
        });
    }
    for description in &update.verification_targets {
        if frame
            .verification_targets
            .iter()
            .any(|target| target.description == description.as_str())
        {
            continue;
        }
        let index = frame.verification_targets.len();
        frame.verification_targets.push(VerificationTarget {
            id: format!("wm-vt-{index}"),
            description: description.clone(),
        });
    }
    for instruction in &update.rules {
        if frame
            .adaptation_rules
            .iter()
            .any(|rule| rule.instruction == instruction.as_str())
        {
            continue;
        }
        let index = frame.adaptation_rules.len();
        frame.adaptation_rules.push(Rule {
            id: format!("wm-rule-{index}"),
            instruction: instruction.clone(),
        });
    }

    frame.proposed_next_phase = update
        .proposed_next_phase
        .as_ref()
        .map(|proposed| serde_json::to_value(proposed).unwrap_or(Value::Null));

    frame
}

fn parse_proposed_phase(obj: &serde_json::Map<String, Value>) -> Option<ProposedPhase> {
    let step_type = obj
        .get("step_type")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())?
        .to_string();
    let rationale = obj
        .get("rationale")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())?
        .to_string();
    let verification_target_refs = obj
        .get("verification_target_refs")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(Value::as_str)
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default();

    Some(ProposedPhase {
        step_type,
        rationale,
        verification_target_refs,
    })
}

fn string_field(args: &Value, key: &str) -> Option<String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn string_list_field(args: &Value, key: &str) -> Option<Vec<String>> {
    let value = args.get(key)?;
    if let Some(items) = value.as_array() {
        return Some(
            items
                .iter()
                .filter_map(Value::as_str)
                .map(clean_entry)
                .filter(|entry| !entry.is_empty())
                .collect(),
        );
    }
    value.as_str().map(split_step_entries)
}

fn parse_execution_strategy(value: &str) -> Option<ExecutionStrategy> {
    match value.trim().to_ascii_lowercase().as_str() {
        "direct_iteration" | "directiteration" | "direct" => {
            Some(ExecutionStrategy::DirectIteration)
        }
        "delegated_workflow" | "delegatedworkflow" | "workflow" => {
            Some(ExecutionStrategy::DelegatedWorkflow)
        }
        "delegated_agent" | "delegatedagent" | "agent" | "worker" => {
            Some(ExecutionStrategy::DelegatedAgent)
        }
        "hybrid" => Some(ExecutionStrategy::Hybrid),
        _ => None,
    }
}

fn split_sentences(input: &str) -> Vec<String> {
    input
        .split(|ch| matches!(ch, '.' | '。' | ';' | '；'))
        .map(clean_entry)
        .filter(|entry| !entry.is_empty())
        .collect()
}

fn split_step_entries(input: &str) -> Vec<String> {
    input
        .lines()
        .flat_map(|line| line.split(|ch| matches!(ch, '.' | '。' | ';' | '；')))
        .map(clean_entry)
        .filter(|entry| !entry.is_empty())
        .collect()
}

fn clean_entry(value: &str) -> String {
    value
        .trim()
        .trim_start_matches(|ch: char| {
            ch.is_ascii_digit()
                || matches!(ch, '-' | '*' | '+' | ')' | '(' | ':' | '：' | '、')
                || ch.is_whitespace()
        })
        .trim()
        .to_string()
}

fn is_assumption_sentence(sentence: &str) -> bool {
    let normalized = sentence.to_ascii_lowercase();
    sentence.contains("假设")
        || sentence.contains("可能")
        || normalized.contains("likely")
        || normalized.contains("assume")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_world_model_update_accepts_execution_strategy() {
        let extract = parse_world_model_update_value(&serde_json::json!({
            "intent": "change config",
            "execution_strategy": "delegated_workflow",
            "facts": ["Need multiple dependent steps."],
            "verification_targets": ["read file", "write file"],
            "rules": ["Keep changes narrow"],
        }));

        assert_eq!(
            extract.execution_strategy,
            Some(ExecutionStrategy::DelegatedWorkflow)
        );
        assert_eq!(extract.intent.as_deref(), Some("change config"));
    }

    #[test]
    fn parse_world_model_update_ignores_unknown_execution_strategy() {
        let extract = parse_world_model_update_value(&serde_json::json!({
            "intent": "answer",
            "execution_strategy": "made_up_strategy",
            "verification_targets": ["answer directly"],
        }));

        assert_eq!(extract.execution_strategy, None);
    }

    #[test]
    fn parse_world_model_update_accepts_proposed_next_phase() {
        let extract = parse_world_model_update_value(&serde_json::json!({
            "intent": "implement feature",
            "execution_strategy": "delegated_workflow",
            "facts": ["Need to verify implementation."],
            "verification_targets": ["read code", "write tests", "verify"],
            "rules": ["Keep changes minimal"],
            "proposed_next_phase": {
                "step_type": "tool_call",
                "rationale": "Need to read existing code first",
                "verification_target_refs": ["verify implementation works"]
            }
        }));

        assert!(extract.proposed_next_phase.is_some());
        let phase = extract.proposed_next_phase.unwrap();
        assert_eq!(phase.step_type, "tool_call");
        assert_eq!(phase.rationale, "Need to read existing code first");
        assert_eq!(phase.verification_target_refs.len(), 1);
    }

    #[test]
    fn parse_world_model_update_handles_missing_proposed_phase() {
        let extract = parse_world_model_update_value(&serde_json::json!({
            "intent": "answer question",
            "verification_targets": ["answer directly"],
        }));

        assert!(extract.proposed_next_phase.is_none());
    }

    #[test]
    fn extracts_and_strips_inline_world_model_update() {
        let extracted = extract_world_model_update_from_text(
            "answer\n<!--wm_update-->{\"facts\":[\"read code\"],\"new_unknowns\":[\"test gap\"]}<!--/wm_update-->",
        )
        .expect("update");

        assert_eq!(extracted.stripped_text, "answer");
        assert_eq!(extracted.update.facts, vec!["read code"]);
        assert_eq!(extracted.update.new_unknowns, vec!["test gap"]);
    }
}
