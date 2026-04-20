use super::{
    should_run_semantic_recall,
    sovereign::{DecisionLocus, Self_},
};
use crate::modules::custom_task_agents::store::{get_custom_task_agent, list_custom_task_agents};
use crate::modules::custom_task_agents::types::CustomTaskAgentProfile;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};

pub(crate) const WORKER_TASK_PACKET_SCHEMA_VERSION: i64 = 1;
const WORKER_CANDIDATE_SHORTLIST_LIMIT: usize = 3;
const WORKER_PROFILE_PRIOR_SCORE_CAP: f32 = 1.0;
const WORKER_PROFILE_PRIOR_SCORE_WEIGHT: f32 = 12.0;

#[derive(Debug, Clone)]
struct WorkerCandidateCard {
    profile: CustomTaskAgentProfile,
    final_score: i32,
    reason: String,
    reason_codes: Vec<String>,
    callable_coverage_score: f32,
    modality_fit_score: f32,
    profile_prior_score: f32,
}

#[derive(Debug, Clone)]
pub(crate) struct WorkerTargetSelection {
    pub(crate) profile: CustomTaskAgentProfile,
    pub(crate) score: i32,
    pub(crate) reason: String,
    pub(crate) reason_codes: Vec<String>,
    pub(crate) candidate_count: usize,
    pub(crate) selected_from_top_k: usize,
    pub(crate) callable_coverage_score: f32,
    pub(crate) modality_fit_score: f32,
    pub(crate) profile_prior_score: f32,
}

#[derive(Debug, Clone)]
pub(crate) struct WorkerTaskPacketInput {
    pub(crate) task_id: String,
    pub(crate) route: String,
    pub(crate) goal: String,
    pub(crate) user_query: String,
    pub(crate) raw_user_text: Option<String>,
    pub(crate) image_urls: Vec<String>,
    pub(crate) parent_allowed_tool_names: Vec<String>,
    pub(crate) prefer_workflow_runtime: bool,
    pub(crate) explicit_task_agent_id: Option<String>,
    pub(crate) bound_asset_reference: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct WorkerTaskPacket {
    pub(crate) schema_version: i64,
    pub(crate) task_id: String,
    pub(crate) route: String,
    pub(crate) goal: String,
    pub(crate) user_query: String,
    pub(crate) task_kind: String,
    pub(crate) deliverable_kind: String,
    pub(crate) context_summary: String,
    pub(crate) relevant_inputs: Value,
    pub(crate) required_capabilities: Vec<String>,
    pub(crate) candidate_capabilities: Vec<String>,
    pub(crate) constraints: Vec<String>,
    pub(crate) non_goals: Vec<String>,
    pub(crate) allowed_actions: Vec<String>,
    pub(crate) forbidden_actions: Vec<String>,
    pub(crate) output_contract: Value,
    pub(crate) completion_standard: String,
    pub(crate) escalation_policy: String,
    pub(crate) packet_hash: String,
}

#[cfg_attr(not(test), allow(dead_code))]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct WorkerTaskPacketReceipt {
    pub(crate) packet_hash: String,
    pub(crate) task_kind: String,
    pub(crate) deliverable_kind: String,
    pub(crate) selected_profile_id: String,
}

impl WorkerTaskPacket {
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn receipt(&self, selected_profile_id: &str) -> WorkerTaskPacketReceipt {
        WorkerTaskPacketReceipt {
            packet_hash: self.packet_hash.clone(),
            task_kind: self.task_kind.clone(),
            deliverable_kind: self.deliverable_kind.clone(),
            selected_profile_id: selected_profile_id.to_string(),
        }
    }

    pub(crate) fn as_value(&self) -> Value {
        serde_json::to_value(self).unwrap_or(Value::Null)
    }
}

pub(crate) async fn select_worker_custom_task_agent(
    app_state: &AppState,
    explicit_task_agent_id: Option<&str>,
    query: &str,
) -> Result<Option<WorkerTargetSelection>, String> {
    select_worker_custom_task_agent_with_query_vector(
        app_state,
        explicit_task_agent_id,
        query,
        None,
    )
    .await
}

pub(crate) async fn select_worker_custom_task_agent_with_query_vector(
    app_state: &AppState,
    explicit_task_agent_id: Option<&str>,
    query: &str,
    query_vector: Option<Vec<f32>>,
) -> Result<Option<WorkerTargetSelection>, String> {
    if let Some(selection) =
        select_explicit_worker_custom_task_agent(app_state, explicit_task_agent_id).await?
    {
        return Ok(Some(selection));
    }

    let profiles = list_custom_task_agents(app_state.mcp.store.as_ref())
        .await
        .map_err(|err| err.to_string())?;
    let active_profiles = profiles
        .into_iter()
        .filter(|profile| profile.discoverable && profile.is_enabled && !profile.is_deleted)
        .collect::<Vec<_>>();
    if active_profiles.is_empty() {
        return Ok(None);
    }

    let worker_selection_hint = Self_::consult(
        app_state.mcp.store.as_ref(),
        DecisionLocus::WorkerSelection,
        query,
        active_profiles.len().max(WORKER_CANDIDATE_SHORTLIST_LIMIT),
    )
    .await;
    let profile_prior_scores = worker_selection_hint
        .as_raw()
        .priors
        .iter()
        .map(|item| {
            (
                item.action_key.to_ascii_lowercase(),
                item.effective_weight.clamp(
                    -(WORKER_PROFILE_PRIOR_SCORE_CAP as f64),
                    WORKER_PROFILE_PRIOR_SCORE_CAP as f64,
                ) as f32,
            )
        })
        .collect::<HashMap<_, _>>();

    let mut semantic_ranks = HashMap::new();
    let semantic_vector = if let Some(vector) = query_vector {
        Some(vector)
    } else if should_run_semantic_recall(query) {
        app_state.providers.embedding.embed_text(query).await.ok()
    } else {
        None
    };
    if let Some(vector) = semantic_vector {
        if let Ok(hits) = app_state
            .memory
            .service
            .search_assets(vector, 5, Some("custom_task_agent"))
            .await
        {
            for (idx, hit) in hits.into_iter().enumerate() {
                if let Some(id) = hit.get("id").and_then(Value::as_str) {
                    semantic_ranks.insert(id.to_string(), idx);
                }
            }
        }
    }

    Ok(select_custom_task_agent_candidate_with_bandit(
        app_state,
        query,
        &active_profiles,
        &semantic_ranks,
        &profile_prior_scores,
    )
    .await)
}

async fn select_custom_task_agent_candidate_with_bandit(
    app_state: &AppState,
    query: &str,
    profiles: &[CustomTaskAgentProfile],
    semantic_ranks: &HashMap<String, usize>,
    profile_prior_scores: &HashMap<String, f32>,
) -> Option<WorkerTargetSelection> {
    use crate::modules::providers::bandit_selector::{select_arm, BanditConfig, BanditStrategy};
    use crate::modules::providers::store::{
        utils::now_rfc3339, BANDIT_DEFAULT_STRATEGY, BANDIT_SCENE_WORKER_SELECTION,
    };

    let mut candidates =
        build_worker_candidate_cards(query, profiles, semantic_ranks, profile_prior_scores);
    if candidates.is_empty() {
        return None;
    }
    let candidate_count = candidates.len();
    let shortlist_len = candidate_count.min(WORKER_CANDIDATE_SHORTLIST_LIMIT);
    let shortlist: Vec<WorkerCandidateCard> = candidates.drain(..shortlist_len).collect();

    let arms = app_state
        .providers
        .store
        .list_bandit_arm_states(Some(BANDIT_SCENE_WORKER_SELECTION.to_string()))
        .await
        .unwrap_or_default();
    let arm_map: HashMap<String, &crate::modules::providers::types::BanditArmState> = arms
        .iter()
        .filter_map(|arm| arm.arm_id.as_ref().map(|id| (id.clone(), arm)))
        .collect();

    let default_strategy =
        BanditStrategy::parse(BANDIT_DEFAULT_STRATEGY).unwrap_or(BanditStrategy::Thompson);
    let strategy = arms
        .first()
        .map(|arm| BanditStrategy::parse_or(&arm.strategy, default_strategy))
        .unwrap_or(default_strategy);
    let cfg = BanditConfig {
        epsilon: arms.first().map(|arm| arm.epsilon).unwrap_or(0.1),
        ..BanditConfig::default()
    };
    let current_time = now_rfc3339().unwrap_or_default();

    let picked = select_arm(
        &shortlist,
        |card| card.profile.id.to_string(),
        &arm_map,
        strategy,
        &cfg,
        &current_time,
    )
    .cloned();
    let selected = picked.unwrap_or_else(|| shortlist.into_iter().next().unwrap());
    Some(card_into_worker_target_selection(
        selected,
        candidate_count,
        shortlist_len,
    ))
}

fn card_into_worker_target_selection(
    card: WorkerCandidateCard,
    candidate_count: usize,
    selected_from_top_k: usize,
) -> WorkerTargetSelection {
    WorkerTargetSelection {
        profile: card.profile,
        score: card.final_score,
        reason: card.reason,
        reason_codes: card.reason_codes,
        candidate_count,
        selected_from_top_k,
        callable_coverage_score: card.callable_coverage_score,
        modality_fit_score: card.modality_fit_score,
        profile_prior_score: card.profile_prior_score,
    }
}

pub(crate) async fn select_explicit_worker_custom_task_agent(
    app_state: &AppState,
    explicit_task_agent_id: Option<&str>,
) -> Result<Option<WorkerTargetSelection>, String> {
    let Some(agent_id) = explicit_task_agent_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };

    let Some(profile) = get_custom_task_agent(app_state.mcp.store.as_ref(), agent_id)
        .await
        .map_err(|err| err.to_string())?
    else {
        return Err(format!("explicit task agent '{}' not found", agent_id));
    };

    if !profile.is_enabled || profile.is_deleted {
        return Err(format!(
            "explicit task agent '{}' is unavailable",
            profile.name
        ));
    }

    Ok(Some(WorkerTargetSelection {
        profile,
        score: 10_000,
        reason: "explicit_task_agent".to_string(),
        reason_codes: vec!["explicit_task_agent".to_string()],
        candidate_count: 1,
        selected_from_top_k: 1,
        callable_coverage_score: 1.0,
        modality_fit_score: 1.0,
        profile_prior_score: 0.0,
    }))
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn select_custom_task_agent_candidate(
    query: &str,
    profiles: &[CustomTaskAgentProfile],
    semantic_ranks: &HashMap<String, usize>,
) -> Option<WorkerTargetSelection> {
    select_custom_task_agent_candidate_with_priors(query, profiles, semantic_ranks, &HashMap::new())
}

fn select_custom_task_agent_candidate_with_priors(
    query: &str,
    profiles: &[CustomTaskAgentProfile],
    semantic_ranks: &HashMap<String, usize>,
    profile_prior_scores: &HashMap<String, f32>,
) -> Option<WorkerTargetSelection> {
    let candidates =
        build_worker_candidate_cards(query, profiles, semantic_ranks, profile_prior_scores);
    let candidate_count = candidates.len();
    let selected_from_top_k = candidate_count.min(WORKER_CANDIDATE_SHORTLIST_LIMIT);
    let selected = candidates.into_iter().next()?;
    Some(card_into_worker_target_selection(
        selected,
        candidate_count,
        selected_from_top_k,
    ))
}

pub(crate) fn build_worker_task_packet(
    selection: &WorkerTargetSelection,
    input: WorkerTaskPacketInput,
) -> WorkerTaskPacket {
    let user_query = input
        .user_query
        .trim()
        .to_string()
        .if_empty_then(input.goal.trim().to_string());
    let task_kind = infer_task_kind(
        selection.profile.invocation_kind.as_str(),
        user_query.as_str(),
        input.image_urls.len(),
    );
    let deliverable_kind = infer_deliverable_kind(
        selection.profile.invocation_kind.as_str(),
        task_kind.as_str(),
    );
    let required_capabilities = bound_capability_refs(&selection.profile);
    let candidate_capabilities = input.parent_allowed_tool_names.clone();
    let allowed_actions = build_allowed_actions(
        &selection.profile,
        &required_capabilities,
        input.bound_asset_reference.as_ref(),
    );
    let output_contract = build_output_contract(
        selection.profile.invocation_kind.as_str(),
        task_kind.as_str(),
        deliverable_kind.as_str(),
    );
    let context_summary = build_context_summary(selection, &input);
    let completion_standard = build_completion_standard(deliverable_kind.as_str());

    let mut packet = WorkerTaskPacket {
        schema_version: WORKER_TASK_PACKET_SCHEMA_VERSION,
        task_id: input.task_id,
        route: input.route,
        goal: input.goal.trim().to_string(),
        user_query,
        task_kind,
        deliverable_kind,
        context_summary,
        relevant_inputs: json!({
            "raw_user_text": input.raw_user_text,
            "image_urls": input.image_urls,
            "parent_allowed_tool_names": input.parent_allowed_tool_names,
            "prefer_workflow_runtime": input.prefer_workflow_runtime,
            "explicit_task_agent_id": input.explicit_task_agent_id,
            "bound_asset_reference": input.bound_asset_reference,
        }),
        required_capabilities: if required_capabilities.is_empty() {
            vec!["final_response_only".to_string()]
        } else {
            required_capabilities.clone()
        },
        candidate_capabilities,
        constraints: vec![
            "Execute only this delegated task.".to_string(),
            "Use only the callable MCP tools and callable skill actions bound to this worker."
                .to_string(),
            "Treat the packet as authoritative for scope, constraints, and completion."
                .to_string(),
        ],
        non_goals: vec![
            "Do not re-evaluate whether this task should route to Direct.".to_string(),
            "Do not widen scope into a broader workflow redesign.".to_string(),
            "Do not invent missing success criteria beyond this packet.".to_string(),
        ],
        allowed_actions,
        forbidden_actions: vec![
            "Do not perform extra search_sdk or route planning on your own.".to_string(),
            "Do not self-orchestrate additional workers or workflows.".to_string(),
            "Do not claim capabilities outside the bound callable lanes.".to_string(),
        ],
        output_contract,
        completion_standard,
        escalation_policy:
            "If blocked by missing callable surface or missing local evidence, return blocked and name the missing surface explicitly.".to_string(),
        packet_hash: String::new(),
    };
    packet.packet_hash = compute_worker_task_packet_hash(&packet);
    packet
}

pub(crate) fn render_worker_task_packet_notes(packet: &WorkerTaskPacket) -> String {
    let packet_json = serde_json::to_string_pretty(packet).unwrap_or_else(|_| "{}".to_string());
    format!(
        "Runtime-authored delegated worker packet. Treat this as authoritative context for the quick worker run.\n\n```json\n{packet_json}\n```"
    )
}

fn build_worker_candidate_cards(
    query: &str,
    profiles: &[CustomTaskAgentProfile],
    semantic_ranks: &HashMap<String, usize>,
    profile_prior_scores: &HashMap<String, f32>,
) -> Vec<WorkerCandidateCard> {
    let normalized_query = query.trim().to_lowercase();
    let query_terms = split_match_terms(&normalized_query);
    let mut candidates = Vec::new();

    for profile in profiles {
        let mut base_score = 0i32;
        let mut reasons = Vec::new();
        let normalized_name = profile.name.trim().to_lowercase();
        let normalized_id = profile.id.trim().to_lowercase();

        if !normalized_name.is_empty() && normalized_query.contains(normalized_name.as_str()) {
            base_score += 90;
            reasons.push("name_match");
        }
        if !normalized_id.is_empty() && normalized_query.contains(normalized_id.as_str()) {
            base_score += 100;
            reasons.push("id_match");
        }
        for tag in &profile.tags {
            let tag = tag.trim().to_lowercase();
            if tag.is_empty() {
                continue;
            }
            if normalized_query.contains(tag.as_str()) {
                base_score += 35;
                reasons.push("tag_match");
            }
        }

        let profile_terms = split_match_terms(&format!(
            "{} {} {}",
            profile.name,
            profile.description.as_deref().unwrap_or_default(),
            profile.tags.join(" ")
        ));
        let overlap = query_terms
            .iter()
            .filter(|term| profile_terms.contains(term.as_str()))
            .count();
        if overlap > 0 {
            base_score += (overlap.min(4) as i32) * 5;
            reasons.push("term_overlap");
        }
        if let Some(rank) = semantic_ranks.get(&profile.id) {
            let bonus = match rank {
                0 => 30,
                1 => 20,
                2 => 10,
                _ => 5,
            };
            base_score += bonus;
            reasons.push("semantic_rank");
        }

        let callable_coverage_score = score_callable_coverage(profile, normalized_query.as_str());
        if callable_coverage_score >= 0.7 {
            reasons.push("callable_coverage");
        }

        let modality_fit_score =
            score_modality_fit(profile.invocation_kind.as_str(), normalized_query.as_str());
        if modality_fit_score >= 0.7 {
            reasons.push("modality_fit");
        }

        let profile_prior_score = profile_prior_scores
            .get(&profile.id.to_ascii_lowercase())
            .copied()
            .unwrap_or(0.0);
        if profile_prior_score > 0.05 {
            reasons.push("worker_selection_prior");
        } else if profile_prior_score < -0.05 {
            reasons.push("worker_selection_prior_penalty");
        }
        let final_score = base_score
            + (callable_coverage_score * 25.0).round() as i32
            + (modality_fit_score * 25.0).round() as i32
            + (profile_prior_score * WORKER_PROFILE_PRIOR_SCORE_WEIGHT).round() as i32;

        if final_score < 35 {
            continue;
        }
        let reason_codes = reasons
            .iter()
            .map(|reason| reason.to_string())
            .collect::<Vec<_>>();
        candidates.push(WorkerCandidateCard {
            profile: profile.clone(),
            final_score,
            reason: reasons.join(","),
            reason_codes,
            callable_coverage_score,
            modality_fit_score,
            profile_prior_score,
        });
    }

    candidates.sort_by(|left, right| right.final_score.cmp(&left.final_score));
    candidates
}

fn score_callable_coverage(profile: &CustomTaskAgentProfile, normalized_query: &str) -> f32 {
    let callable_count =
        profile.callable_mcp_tool_ids.len() + profile.callable_skill_action_refs.len();
    let mut score: f32 = match callable_count {
        0 => 0.2,
        1 => 0.55,
        2 => 0.75,
        _ => 0.9,
    };
    if callable_count > 0
        && query_contains_any(
            normalized_query,
            &[
                "search", "find", "inspect", "check", "run", "execute", "edit", "write", "update",
                "install", "browse", "query", "fetch",
            ],
        )
    {
        score = (score + 0.1).min(1.0);
    }
    if profile.source_kind.as_deref() == Some("llm_wiki_maintainer") {
        score = (score + 0.05).min(1.0);
    }
    score
}

fn score_modality_fit(invocation_kind: &str, normalized_query: &str) -> f32 {
    let wants_image = query_contains_any(
        normalized_query,
        &[
            "image",
            "images",
            "picture",
            "draw",
            "drawing",
            "illustration",
            "render",
            "\u{751F}\u{6210}\u{56FE}\u{7247}",
            "\u{753B}\u{56FE}",
            "\u{51FA}\u{56FE}",
            "\u{56FE}\u{50CF}",
            "\u{63D2}\u{753B}",
        ],
    );
    let wants_audio = query_contains_any(
        normalized_query,
        &[
            "audio",
            "speech",
            "voice",
            "tts",
            "read aloud",
            "\u{8BED}\u{97F3}",
            "\u{914D}\u{97F3}",
        ],
    );
    match invocation_kind {
        "image_generation" => {
            if wants_image {
                1.0
            } else {
                0.15
            }
        }
        "text_to_speech" => {
            if wants_audio {
                1.0
            } else {
                0.15
            }
        }
        _ => {
            if wants_image || wants_audio {
                0.3
            } else {
                1.0
            }
        }
    }
}

fn infer_task_kind(invocation_kind: &str, user_query: &str, image_count: usize) -> String {
    if invocation_kind == "image_generation" {
        return "image_generation".to_string();
    }
    if invocation_kind == "text_to_speech" {
        return "text_to_speech".to_string();
    }
    if image_count > 0 {
        return "multimodal_analysis".to_string();
    }
    let normalized_query = user_query.trim().to_lowercase();
    if query_contains_any(
        normalized_query.as_str(),
        &[
            "analyze",
            "analysis",
            "compare",
            "investigate",
            "diagnose",
            "\u{5206}\u{6790}",
        ],
    ) {
        return "analysis".to_string();
    }
    if query_contains_any(
        normalized_query.as_str(),
        &[
            "edit",
            "update",
            "write",
            "fix",
            "maintain",
            "\u{4FEE}\u{6539}",
            "\u{7F16}\u{5199}",
        ],
    ) {
        return "maintenance".to_string();
    }
    "delegated_chat".to_string()
}

fn infer_deliverable_kind(invocation_kind: &str, task_kind: &str) -> String {
    match invocation_kind {
        "image_generation" => "image_result".to_string(),
        "text_to_speech" => "audio_result".to_string(),
        _ if task_kind == "analysis" => "structured_findings".to_string(),
        _ => "delegated_response".to_string(),
    }
}

fn build_context_summary(
    selection: &WorkerTargetSelection,
    input: &WorkerTaskPacketInput,
) -> String {
    let workflow_mode = if input.prefer_workflow_runtime {
        "enabled"
    } else {
        "disabled"
    };
    let base = format!(
        "The desktop runtime already selected route '{}' and chose worker '{}' from {} candidate(s). Workflow handoff preference is {}. Treat this as a bounded delegated subtask, not a fresh routing problem.",
        input.route,
        selection.profile.name,
        selection.candidate_count,
        workflow_mode
    );
    let Some(reference) = input.bound_asset_reference.as_ref() else {
        return base;
    };
    let asset_label = reference
        .get("title")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            reference
                .get("asset_id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
        })
        .unwrap_or("saved local HTML asset");
    format!(
        "{base} A bound saved local HTML asset is attached as reference context: '{}'. Use it as structure/style guidance when relevant, not as a runtime widget to auto-display.",
        asset_label
    )
}

fn bound_capability_refs(profile: &CustomTaskAgentProfile) -> Vec<String> {
    let mut refs = profile.callable_mcp_tool_ids.clone();
    refs.extend(
        profile
            .callable_skill_action_refs
            .iter()
            .map(|item| format!("{}.{}", item.skill_id, item.action_id)),
    );
    refs
}

fn build_allowed_actions(
    profile: &CustomTaskAgentProfile,
    required_capabilities: &[String],
    bound_asset_reference: Option<&Value>,
) -> Vec<String> {
    let mut actions = vec![
        "Read the runtime-authored task packet and follow it literally.".to_string(),
        "Return a bounded delegated result for this task only.".to_string(),
    ];
    if !required_capabilities.is_empty() {
        actions.push(format!(
            "Use only these bound callable references when needed: {}",
            required_capabilities.join(", ")
        ));
    }
    if profile.source_kind.as_deref() == Some("llm_wiki_maintainer") {
        actions.push(
            "Use the maintainer corpus lane for fresh local evidence when that callable is bound."
                .to_string(),
        );
    }
    if bound_asset_reference.is_some() {
        actions.push(
            "Use `bound_asset_reference` as reference context only. Do not assume the saved asset will auto-render in chat."
                .to_string(),
        );
    }
    actions
}

fn build_output_contract(invocation_kind: &str, task_kind: &str, deliverable_kind: &str) -> Value {
    match invocation_kind {
        "image_generation" => json!({
            "kind": deliverable_kind,
            "required_fields": ["images"],
        }),
        "text_to_speech" => json!({
            "kind": deliverable_kind,
            "required_fields": ["audios"],
        }),
        _ if task_kind == "analysis" => json!({
            "kind": deliverable_kind,
            "required_sections": ["summary", "findings", "recommendation"],
        }),
        _ => json!({
            "kind": deliverable_kind,
            "required_sections": ["answer"],
        }),
    }
}

fn build_completion_standard(deliverable_kind: &str) -> String {
    match deliverable_kind {
        "structured_findings" => {
            "Return a concise answer with concrete findings and a recommendation.".to_string()
        }
        "image_result" => "Return generated image outputs or a blocked result.".to_string(),
        "audio_result" => "Return generated audio output or a blocked result.".to_string(),
        _ => {
            "Return the final delegated answer directly; if blocked, say so briefly and concretely."
                .to_string()
        }
    }
}

fn compute_worker_task_packet_hash(packet: &WorkerTaskPacket) -> String {
    let mut canonical = packet.clone();
    canonical.packet_hash.clear();
    let bytes = serde_json::to_vec(&canonical).unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

fn split_match_terms(input: &str) -> HashSet<String> {
    input
        .split(|ch: char| !ch.is_alphanumeric())
        .map(str::trim)
        .filter(|value| value.len() >= 2)
        .map(|value| value.to_lowercase())
        .collect()
}

fn query_contains_any(query: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| query.contains(needle))
}

trait StringExt {
    fn if_empty_then(self, fallback: String) -> String;
}

impl StringExt for String {
    fn if_empty_then(self, fallback: String) -> String {
        if self.trim().is_empty() {
            fallback
        } else {
            self
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_worker_task_packet, select_custom_task_agent_candidate,
        select_custom_task_agent_candidate_with_priors, WorkerTaskPacketInput,
    };
    use crate::modules::custom_task_agents::types::{
        CustomTaskAgentInvocationKind, CustomTaskAgentProfile,
    };
    use serde_json::json;
    use std::collections::HashMap;

    fn build_profile(
        id: &str,
        name: &str,
        description: &str,
        invocation_kind: CustomTaskAgentInvocationKind,
        tags: &[&str],
        preferred_for_image_generation: bool,
        callable_mcp_tool_ids: &[&str],
    ) -> CustomTaskAgentProfile {
        CustomTaskAgentProfile {
            id: id.to_string(),
            name: name.to_string(),
            description: Some(description.to_string()),
            task_prompt: "Complete the delegated task.".to_string(),
            invocation_kind,
            preferred_for_image_generation,
            model_config: None,
            callable_mcp_tool_ids: callable_mcp_tool_ids
                .iter()
                .map(|value| value.to_string())
                .collect(),
            guidance_skill_ids: Vec::new(),
            callable_skill_action_refs: Vec::new(),
            bound_asset_id: None,
            tags: tags.iter().map(|value| value.to_string()).collect(),
            discoverable: true,
            is_enabled: true,
            is_deleted: false,
            source_kind: None,
            source_path: None,
            source_repo: None,
            source_ref: None,
            source_hash: None,
            created_at: "2026-04-15T00:00:00Z".to_string(),
            updated_at: "2026-04-15T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn candidate_selection_carries_shortlist_metadata_and_fit_scores() {
        let profiles = vec![
            build_profile(
                "research.worker",
                "Research Worker",
                "Investigates runtime architecture",
                CustomTaskAgentInvocationKind::Chat,
                &["research", "analysis"],
                false,
                &["tool.search"],
            ),
            build_profile(
                "docs.worker",
                "Docs Worker",
                "Writes docs",
                CustomTaskAgentInvocationKind::Chat,
                &["docs"],
                false,
                &[],
            ),
        ];

        let selection = select_custom_task_agent_candidate(
            "research the desktop runtime architecture",
            &profiles,
            &HashMap::new(),
        )
        .expect("selection");

        assert_eq!(selection.profile.id, "research.worker");
        assert_eq!(selection.candidate_count, 2);
        assert_eq!(selection.selected_from_top_k, 2);
        assert!(selection
            .reason_codes
            .iter()
            .any(|code| code == "name_match"));
        assert!(selection
            .reason_codes
            .iter()
            .any(|code| code == "term_overlap"));
        assert!(selection
            .reason_codes
            .iter()
            .any(|code| code == "callable_coverage"));
        assert!(selection.callable_coverage_score > 0.5);
        assert_eq!(selection.reason, selection.reason_codes.join(","));
    }

    #[test]
    fn candidate_selection_prefers_preferred_image_worker_for_image_queries() {
        let profiles = vec![
            build_profile(
                "image.helper",
                "Image Helper",
                "Generates images",
                CustomTaskAgentInvocationKind::ImageGeneration,
                &["image"],
                false,
                &[],
            ),
            build_profile(
                "image.preferred",
                "Preferred Image Worker",
                "Generates polished images",
                CustomTaskAgentInvocationKind::ImageGeneration,
                &["image"],
                true,
                &[],
            ),
        ];

        let selection = select_custom_task_agent_candidate(
            "draw an image of a cat",
            &profiles,
            &HashMap::new(),
        )
        .expect("selection");

        assert_eq!(selection.profile.id, "image.preferred");
        assert!(selection
            .reason_codes
            .iter()
            .any(|code| code == "preferred_for_image_generation"));
        assert_eq!(selection.modality_fit_score, 1.0);
    }

    #[test]
    fn candidate_selection_applies_worker_selection_priors_as_bounded_rank_bonus() {
        let profiles = vec![
            build_profile(
                "alpha.worker",
                "Alpha Worker",
                "General delegated helper",
                CustomTaskAgentInvocationKind::Chat,
                &[],
                false,
                &["tool.search", "tool.shell"],
            ),
            build_profile(
                "beta.worker",
                "Beta Worker",
                "General delegated helper",
                CustomTaskAgentInvocationKind::Chat,
                &[],
                false,
                &["tool.search", "tool.shell"],
            ),
        ];
        let prior_scores = HashMap::from([("beta.worker".to_string(), 1.0_f32)]);

        let selection = select_custom_task_agent_candidate_with_priors(
            "help with this delegated task",
            &profiles,
            &HashMap::new(),
            &prior_scores,
        )
        .expect("selection");

        assert_eq!(selection.profile.id, "beta.worker");
        assert!(selection.profile_prior_score > 0.0);
        assert!(selection
            .reason_codes
            .iter()
            .any(|code| code == "worker_selection_prior"));
    }

    #[test]
    fn worker_task_packet_receipt_and_hash_are_stable() {
        let selection = select_custom_task_agent_candidate(
            "analyze the worker route",
            &[build_profile(
                "research.worker",
                "Research Worker",
                "Investigates runtime architecture",
                CustomTaskAgentInvocationKind::Chat,
                &["research", "analysis"],
                false,
                &["tool.search", "tool.shell"],
            )],
            &HashMap::new(),
        )
        .expect("selection");

        let packet = build_worker_task_packet(
            &selection,
            WorkerTaskPacketInput {
                task_id: "exec-1".to_string(),
                route: "worker".to_string(),
                goal: "Analyze the current worker route".to_string(),
                user_query: "Analyze the current worker route".to_string(),
                raw_user_text: Some("Analyze the current worker route".to_string()),
                image_urls: Vec::new(),
                parent_allowed_tool_names: vec!["search_sdk".to_string()],
                prefer_workflow_runtime: true,
                explicit_task_agent_id: None,
                bound_asset_reference: None,
            },
        );

        assert_eq!(packet.schema_version, 1);
        assert!(!packet.packet_hash.is_empty());
        assert_eq!(
            packet.receipt("research.worker").selected_profile_id,
            "research.worker"
        );
        assert_eq!(packet.task_kind, "analysis");
        assert_eq!(packet.deliverable_kind, "structured_findings");
    }

    #[test]
    fn worker_task_packet_includes_bound_asset_reference_context() {
        let selection = select_custom_task_agent_candidate(
            "summarize with the release-notes worker",
            &[build_profile(
                "release.worker",
                "Release Worker",
                "Summarizes updates",
                CustomTaskAgentInvocationKind::Chat,
                &["release", "notes"],
                false,
                &["tool.search"],
            )],
            &HashMap::new(),
        )
        .expect("selection");

        let packet = build_worker_task_packet(
            &selection,
            WorkerTaskPacketInput {
                task_id: "exec-2".to_string(),
                route: "worker".to_string(),
                goal: "Summarize release updates".to_string(),
                user_query: "Summarize release updates".to_string(),
                raw_user_text: Some("Summarize release updates".to_string()),
                image_urls: Vec::new(),
                parent_allowed_tool_names: vec!["search_sdk".to_string()],
                prefer_workflow_runtime: false,
                explicit_task_agent_id: None,
                bound_asset_reference: Some(json!({
                    "asset_id": "release-notes-card",
                    "title": "Release Notes Card",
                    "render_hint": "release-card"
                })),
            },
        );

        assert!(packet.context_summary.contains("reference context"));
        assert!(packet.context_summary.contains("Release Notes Card"));
        assert_eq!(
            packet.relevant_inputs["bound_asset_reference"]["asset_id"],
            json!("release-notes-card")
        );
        assert!(packet
            .allowed_actions
            .iter()
            .any(|item| item.contains("bound_asset_reference")));
    }
}
