use crate::hook::{HookDecision, HookEvent};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum RuntimeEvent {
    UserInputReceived {
        session_id: String,
        task_id: String,
    },
    HookEventObserved {
        event: HookEvent,
    },
    FrameBootstrapped {
        frame_version_id: String,
    },
    HookDecisionRecorded {
        boundary: String,
        decision: HookDecision,
    },
    PlanCreated {
        plan_id: String,
    },
    PhaseProposed {
        proposal_id: String,
    },
    PhaseCommitted {
        phase_id: String,
    },
    PhaseObserved {
        phase_id: String,
        observation_ref: String,
    },
    FrameRefreshed {
        frame_version_id: String,
    },
    InterruptionQueued {
        interruption_id: String,
    },
    FinalAnswerReady {
        reason: String,
    },
    RuntimeStopped {
        reason: String,
    },
}
