// Mirrors the Rust types in
// src-tauri/src/modules/desktop_runtime/runtime/runtime_transition/{types.rs,projection.rs}
// All payloads here are serde(rename_all = "snake_case") on the Rust side.

export type RuntimeStateKind =
  | "user_input"
  | "model_proposal"
  | "tool_execution_pending"
  | "capability_discovered"
  | "capability_exposed"
  | "capability_executable"
  | "execution_observed"
  | "plan_drafted"
  | "plan_revision_needed"
  | "final_answer_proposed"
  | "finalized"
  | "unknown"

export type ProposedAction =
  | "direct_answer"
  | "draft_plan"
  | "execute_tool"
  | "expose_capability"
  | "admit_executable_capability"
  | "revise_plan"
  | "verify_final_answer"
  | "record_monitor_checkpoint"
  | "noop"

export type TransitionSource =
  | "provider_response"
  | "capability_discovery"
  | "capability_contract"
  | "execution_observation"
  | "monitor_result"
  | "runtime_policy"
  | "user_feedback"
  | "unknown"

export type EffectScope =
  | "read_only"
  | "session"
  | "workspace"
  | "external"
  | "unknown"

export type RequiredArtifact =
  | "diting_think_preflight"
  | "plan_draft"
  | "plan_revision"
  | "verification_plan"
  | "capability_lease"
  | "monitor_checkpoint"
  // The core hook crate also produces these — keep them in the union so
  // payloads coming from desktop-runtime-core hooks parse correctly even
  // though the runtime_transition projector currently only emits the
  // subset above.
  | "world_model_frame_refresh"
  | "world_model_frame_revision"

export type HookEnforcementMode = "enforced"

export type CorrelationOutcome = "matched" | "contradicted" | "unverified"

export interface EvidenceRef {
  kind: string
  source: string
  id: string | null
  metadata_json: unknown
}

export interface RuntimeTransition {
  transition_id: string
  trace_id: string
  request_id: string | null
  session_id: string
  source: TransitionSource
  from_state: RuntimeStateKind
  to_state: RuntimeStateKind
  proposed_action: ProposedAction
  capability_id: string | null
  tool_name: string | null
  effect_scope: EffectScope
  observed_evidence: EvidenceRef[]
  uncertainty_flags: string[]
  metadata_json: Record<string, unknown> | null
}

// runtime_transition.decision event payload — emitted by projection.rs
// `runtime_transition_decision_event_payload`.
export interface TransitionDecisionEvent {
  event_type: "runtime_transition.decision"
  decision_id: string
  transition_id: string
  trace_id: string
  request_id: string | null
  session_id: string
  source: TransitionSource
  from_state: RuntimeStateKind
  to_state: RuntimeStateKind
  proposed_action: ProposedAction
  capability_id: string | null
  tool_name: string | null
  effect_scope: EffectScope
  required_artifact: RequiredArtifact | null
  enforcement: HookEnforcementMode | null
  transition: RuntimeTransition
  decision: unknown // HookDecision (union); not unpacked here
}

// runtime_transition.correlation event payload.
export interface TransitionCorrelationEvent {
  event_type: "runtime_transition.correlation"
  transition_id: string
  outcome: CorrelationOutcome
  evidence_refs: string[]
  note: string | null
}

export type TransitionEvent =
  | TransitionDecisionEvent
  | TransitionCorrelationEvent

// tool_trace_blocks carrier — wraps the same payloads with a discriminator.
export interface TransitionTraceBlock {
  type:
    | "runtime_transition_decision"
    | "runtime_transition_correlation"
  payload: TransitionEvent
}
