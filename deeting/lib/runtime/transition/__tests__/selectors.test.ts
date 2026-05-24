import {
  buildTransitionTimeline,
  hasTransitionDecisions,
} from "../selectors"

describe("buildTransitionTimeline", () => {
  it("returns empty when debug is missing", () => {
    expect(buildTransitionTimeline(undefined)).toEqual([])
    expect(buildTransitionTimeline({})).toEqual([])
  })

  it("falls back to tool-exec entries from runtime_tool_calls when no transitions are present", () => {
    const entries = buildTransitionTimeline({
      runtime_tool_calls: {
        count: 1,
        calls: [
          {
            index: 0,
            tool_name: "shell_execute",
            status: "success",
            duration_ms: 142,
          },
        ],
      },
    })

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      kind: "tool_exec",
      toolName: "shell_execute",
      status: "success",
      durationMs: 142,
    })
    expect(hasTransitionDecisions(entries)).toBe(false)
  })

  it("decodes decision + correlation pairs from tool_trace_blocks and attaches the correlation to its transition", () => {
    const transitionId = "runtime-transition:call-1"
    const entries = buildTransitionTimeline({
      tool_trace_blocks: [
        {
          type: "runtime_transition_decision",
          payload: {
            event_type: "runtime_transition.decision",
            decision_id: `hook-decision:${transitionId}`,
            transition_id: transitionId,
            trace_id: "trace-1",
            request_id: "request-1",
            session_id: "session-1",
            source: "provider_response",
            from_state: "model_proposal",
            to_state: "tool_execution_pending",
            proposed_action: "execute_tool",
            capability_id: null,
            tool_name: "shell_execute",
            effect_scope: "workspace",
            required_artifact: "diting_think_preflight",
            enforcement: "enforced",
            transition: {},
            decision: {
              require_artifact: {
                artifact: "diting_think_preflight",
                reason: "tool execution crosses runtime boundary",
                enforcement: "enforced",
              },
            },
          },
        },
        {
          type: "runtime_transition_correlation",
          payload: {
            event_type: "runtime_transition.correlation",
            transition_id: transitionId,
            outcome: "matched",
            evidence_refs: ["tool_result:call-1"],
            note: null,
          },
        },
      ],
    })

    expect(hasTransitionDecisions(entries)).toBe(true)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      kind: "decision",
      transitionId,
      fromState: "model_proposal",
      toState: "tool_execution_pending",
      proposedAction: "execute_tool",
      requiredArtifact: "diting_think_preflight",
      enforced: true,
      reason: "tool execution crosses runtime boundary",
      correlation: { outcome: "matched", evidenceRefs: ["tool_result:call-1"] },
    })
  })

  it("deduplicates decisions that arrive via multiple carriers", () => {
    const decisionPayload = {
      event_type: "runtime_transition.decision",
      decision_id: "hook-decision:t-1",
      transition_id: "t-1",
      trace_id: "trace-1",
      request_id: null,
      session_id: "session-1",
      source: "provider_response",
      from_state: "model_proposal",
      to_state: "tool_execution_pending",
      proposed_action: "execute_tool",
      capability_id: null,
      tool_name: "shell_execute",
      effect_scope: "workspace",
      required_artifact: null,
      enforcement: null,
      transition: {},
      decision: { allow: { reason: "ok" } },
    }
    const entries = buildTransitionTimeline({
      runtime_transition_events: [decisionPayload],
      runtime_transition_decisions: [decisionPayload],
      tool_trace_blocks: [
        { type: "runtime_transition_decision", payload: decisionPayload },
      ],
    })
    expect(entries.filter((entry) => entry.kind === "decision")).toHaveLength(1)
  })

  it("keeps the last correlation when multiple correlations arrive for the same transition", () => {
    const transitionId = "t-2"
    const entries = buildTransitionTimeline({
      runtime_transition_events: [
        {
          event_type: "runtime_transition.decision",
          decision_id: `hook-decision:${transitionId}`,
          transition_id: transitionId,
          trace_id: "trace-1",
          session_id: "session-1",
          source: "provider_response",
          from_state: "model_proposal",
          to_state: "tool_execution_pending",
          proposed_action: "execute_tool",
          tool_name: "shell_execute",
          effect_scope: "workspace",
          required_artifact: null,
          enforcement: null,
          transition: {},
          decision: {},
        },
        {
          event_type: "runtime_transition.correlation",
          transition_id: transitionId,
          outcome: "unverified",
          evidence_refs: [],
          note: null,
        },
        {
          event_type: "runtime_transition.correlation",
          transition_id: transitionId,
          outcome: "matched",
          evidence_refs: ["tool_result:later"],
          note: "promoted after observation",
        },
      ],
    })
    const decision = entries.find((entry) => entry.kind === "decision")
    expect(decision?.kind === "decision" && decision.correlation).toMatchObject({
      outcome: "matched",
      evidenceRefs: ["tool_result:later"],
      note: "promoted after observation",
    })
  })

  it("interleaves transition decisions with tool execution entries when both are present", () => {
    const entries = buildTransitionTimeline({
      tool_trace_blocks: [
        {
          type: "runtime_transition_decision",
          payload: {
            event_type: "runtime_transition.decision",
            decision_id: "hook-decision:t-3",
            transition_id: "t-3",
            trace_id: "trace-1",
            session_id: "session-1",
            source: "provider_response",
            from_state: "model_proposal",
            to_state: "tool_execution_pending",
            proposed_action: "execute_tool",
            tool_name: "shell_execute",
            effect_scope: "workspace",
            required_artifact: "diting_think_preflight",
            enforcement: "enforced",
            transition: {},
            decision: {},
          },
        },
      ],
      runtime_tool_calls: {
        calls: [
          {
            index: 0,
            tool_name: "shell_execute",
            status: "success",
            duration_ms: 12,
          },
        ],
      },
    })

    expect(entries.map((entry) => entry.kind)).toEqual([
      "decision",
      "tool_exec",
    ])
  })
})
