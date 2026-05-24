import type {
  CorrelationOutcome,
  ProposedAction,
  RequiredArtifact,
  RuntimeStateKind,
  TransitionCorrelationEvent,
  TransitionDecisionEvent,
  TransitionEvent,
} from "./types"

export type TransitionTimelineEntry =
  | {
      kind: "decision"
      key: string
      transitionId: string
      fromState: RuntimeStateKind
      toState: RuntimeStateKind
      proposedAction: ProposedAction
      toolName: string | null
      capabilityId: string | null
      requiredArtifact: RequiredArtifact | null
      enforced: boolean
      reason: string | null
      correlation: {
        outcome: CorrelationOutcome
        evidenceRefs: string[]
        note: string | null
      } | null
    }
  | {
      kind: "tool_exec"
      key: string
      callIndex: number
      toolName: string
      status: string
      durationMs: number | null
      error: string | null
      errorCode: string | null
    }

const DECISION_EVENT = "runtime_transition.decision"
const CORRELATION_EVENT = "runtime_transition.correlation"

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null
  return value as Record<string, unknown>
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : null
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function isDecisionEvent(value: unknown): value is TransitionDecisionEvent {
  const record = asRecord(value)
  return record?.event_type === DECISION_EVENT
}

function isCorrelationEvent(
  value: unknown,
): value is TransitionCorrelationEvent {
  const record = asRecord(value)
  return record?.event_type === CORRELATION_EVENT
}

function collectTransitionEvents(debug?: Record<string, unknown>): TransitionEvent[] {
  if (!debug) return []
  const events: TransitionEvent[] = []
  const seen = new Set<string>()

  const push = (event: unknown) => {
    if (!isDecisionEvent(event) && !isCorrelationEvent(event)) return
    const key =
      event.event_type === DECISION_EVENT
        ? `decision:${event.transition_id}:${event.decision_id ?? ""}`
        : `correlation:${event.transition_id}:${event.outcome}`
    if (seen.has(key)) return
    seen.add(key)
    events.push(event)
  }

  // Preferred future shape: dedicated per-block fields.
  const decisions = debug.runtime_transition_decisions
  if (Array.isArray(decisions)) decisions.forEach(push)
  const correlations = debug.runtime_transition_correlations
  if (Array.isArray(correlations)) correlations.forEach(push)

  // Current shape: tool_trace_blocks contains decision/correlation blocks
  // alongside other tool-trace block types.
  const traceBlocks = debug.tool_trace_blocks
  if (Array.isArray(traceBlocks)) {
    for (const block of traceBlocks) {
      const record = asRecord(block)
      if (!record) continue
      const blockType = record.type
      if (
        blockType !== "runtime_transition_decision" &&
        blockType !== "runtime_transition_correlation"
      ) {
        continue
      }
      push(record.payload)
    }
  }

  // Flat top-level events array (set by attach_runtime_transition_blocks_to_response).
  const flatEvents = debug.runtime_transition_events
  if (Array.isArray(flatEvents)) flatEvents.forEach(push)

  return events
}

function describeDecisionReason(event: TransitionDecisionEvent): string | null {
  const decision = asRecord(event.decision)
  if (!decision) return null
  for (const value of Object.values(decision)) {
    const inner = asRecord(value)
    const reason = asString(inner?.reason)
    if (reason) return reason
  }
  return null
}

function buildToolExecutionEntries(
  debug: Record<string, unknown> | undefined,
): TransitionTimelineEntry[] {
  if (!debug) return []
  const runtimeToolCalls = asRecord(debug.runtime_tool_calls)
  if (!runtimeToolCalls) return []
  const rawCalls = runtimeToolCalls.calls
  if (!Array.isArray(rawCalls)) return []

  const entries: TransitionTimelineEntry[] = []
  for (let i = 0; i < rawCalls.length; i += 1) {
    const entry = asRecord(rawCalls[i])
    if (!entry) continue
    const toolName = asString(entry.tool_name)
    if (!toolName) continue
    const index = asNumber(entry.index) ?? i
    const status = asString(entry.status) ?? "unknown"
    entries.push({
      kind: "tool_exec",
      key: `tool:${index}:${toolName}`,
      callIndex: index,
      toolName,
      status,
      durationMs: asNumber(entry.duration_ms),
      error: asString(entry.error),
      errorCode: asString(entry.error_code),
    })
  }
  return entries
}

export function buildTransitionTimeline(
  debug?: Record<string, unknown>,
): TransitionTimelineEntry[] {
  const events = collectTransitionEvents(debug)
  const decisionEntries: TransitionTimelineEntry[] = []
  const correlationsByTransition = new Map<string, TransitionCorrelationEvent>()

  for (const event of events) {
    if (event.event_type === CORRELATION_EVENT) {
      // If multiple correlations land on the same transition, the later
      // one is the most authoritative (e.g. unverified → matched).
      correlationsByTransition.set(event.transition_id, event)
    }
  }

  for (const event of events) {
    if (event.event_type !== DECISION_EVENT) continue
    const correlation = correlationsByTransition.get(event.transition_id) ?? null
    decisionEntries.push({
      kind: "decision",
      key: `decision:${event.transition_id}`,
      transitionId: event.transition_id,
      fromState: event.from_state,
      toState: event.to_state,
      proposedAction: event.proposed_action,
      toolName: event.tool_name,
      capabilityId: event.capability_id,
      requiredArtifact: event.required_artifact,
      enforced: event.enforcement === "enforced",
      reason: describeDecisionReason(event),
      correlation: correlation
        ? {
            outcome: correlation.outcome,
            evidenceRefs: correlation.evidence_refs ?? [],
            note: correlation.note,
          }
        : null,
    })
  }

  return [...decisionEntries, ...buildToolExecutionEntries(debug)]
}

export function hasTransitionDecisions(
  entries: TransitionTimelineEntry[],
): boolean {
  return entries.some((entry) => entry.kind === "decision")
}
