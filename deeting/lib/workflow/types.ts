/**
 * TypeScript types mirroring the Rust workflow module types.
 * These are the shapes returned by Tauri invoke commands.
 */

// --- Enums ---

export type WorkflowRunStatus =
  | "draft"
  | "ready"
  | "running"
  | "waiting_approval"
  | "awaiting_plan_edit"
  | "completed"
  | "failed"
  | "cancelled"

export type WorkflowStepStatus =
  | "pending"
  | "ready"
  | "running"
  | "waiting_approval"
  | "succeeded"
  | "failed"
  | "skipped"
  | "obsolete"
  | "invalidated"
  | "cancelled"

export type WorkflowStepType = "worker_call" | "approval_gate" | "finalize"

export type WorkflowArtifactKind =
  | "text_summary"
  | "json_structured"
  | "table"
  | "image"
  | "file_ref"
  | "link"

export type ApprovalAction = "approve" | "reject" | "modify"

export type RevalidationDecision =
  | "continue"
  | "pause_for_edit"
  | "mark_obsolete"
  | "mark_invalidated"
  | "suffix_replan"

// --- Domain Models ---

export interface WorkflowRun {
  id: string
  title: string
  goal: string
  status: WorkflowRunStatus
  proposal_text: string | null
  snapshot_json: ExecutionSnapshot | null
  proposal_version: number
  snapshot_version: number
  run_dir: string | null
  error: string | null
  created_at: string
  updated_at: string
}

export interface WorkflowStepRun {
  id: string
  run_id: string
  phase_id: string
  phase_index: number
  step_type: WorkflowStepType
  title: string
  status: WorkflowStepStatus
  worker_ref: string | null
  goal: string | null
  input_snapshot: Record<string, unknown> | null
  output_artifact_refs: string[]
  worker_trace_summary: string | null
  retry_count: number
  error: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface WorkflowEvent {
  id: string
  run_id: string
  step_id: string | null
  event_type: string
  payload: Record<string, unknown> | null
  created_at: string
}

export interface WorkflowCheckpoint {
  id: string
  run_id: string
  blocked_step_id: string | null
  reason: string
  approval_payload: Record<string, unknown> | null
  resume_payload: Record<string, unknown> | null
  resolved: boolean
  created_at: string
  resolved_at: string | null
}

export interface WorkflowArtifact {
  id: string
  run_id: string
  step_id: string | null
  phase_id: string | null
  artifact_kind: WorkflowArtifactKind
  artifact_ref: string | null
  content: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

export interface WorkflowRunDetail {
  run: WorkflowRun
  steps: WorkflowStepRun[]
  events: WorkflowEvent[]
}

export interface WorkflowPhaseContext {
  run_id: string
  phase_id: string
  phase_title: string
  context_md: string | null
  context_json: Record<string, unknown> | null
}

// --- Snapshot Models ---

export interface ExecutionSnapshot {
  run_id: string
  proposal_version: number
  snapshot_version: number
  compiled_at: string
  goal: string
  phases: CompiledPhase[]
  policy: SnapshotPolicy
}

export interface CompiledPhase {
  phase_id: string
  title: string
  worker_ref: string
  depends_on: string[]
  goal: string
  expected_output: ExpectedOutput | null
}

export interface ExpectedOutput {
  result_kind: string
  result_schema_hint: string | null
}

export interface SnapshotPolicy {
  allow_auto_suffix_replan: boolean
  default_timeout_ms: number
}

// --- Compiler ---

export interface CompilerError {
  phase_id: string | null
  field: string
  message: string
}

export interface CompileResult {
  snapshot: ExecutionSnapshot | null
  errors: CompilerError[]
}

// --- Proposal ---

export interface ProposalPhase {
  phase_id: string
  title: string
  worker_ref: string | null
  goal: string | null
  expected_output: string | null
  depends_on: string[]
  user_notes: string | null
}

export interface ParsedProposal {
  title: string | null
  goal: string | null
  global_constraints: string[]
  phases: ProposalPhase[]
}

// --- Request Types ---

export interface GenerateProposalRequest {
  goal: string
  hints?: string | null
}

export interface UpdateProposalRequest {
  run_id: string
  proposal_text: string
}

export interface RegenerateProposalRequest {
  run_id: string
  feedback?: string | null
}

export interface ApproveWorkflowRequest {
  run_id: string
  action: ApprovalAction
  updated_proposal?: string | null
}

export interface RerunPhaseRequest {
  run_id: string
  phase_id: string
  updated_goal?: string | null
}

export interface EditRemainingPhasesRequest {
  run_id: string
  updated_proposal: string
}

// --- Tauri Event Payloads ---

export interface WorkflowProgress {
  run_id: string
  phase_id: string
  phase_title: string
  phase_index: number
  total_phases: number
  status: string
}

// --- Quick Workflow (Route Convergence) ---

export interface QuickWorkflowRequest {
  goal: string
  worker_ref?: string | null
  inject_into_chat: boolean
}

export interface QuickWorkflowResult {
  run: WorkflowRun
  steps: WorkflowStepRun[]
  content: string | null
  succeeded: boolean
}
