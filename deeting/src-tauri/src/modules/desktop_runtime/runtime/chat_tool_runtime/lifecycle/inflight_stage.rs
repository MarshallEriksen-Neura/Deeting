#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum InFlightExecutionStage {
    ToolRunning,
    WaitingApproval,
    ResumingAfterApproval,
    ResumeFailed,
    DelegatedWorkflowRunning,
    Interrupted,
}
