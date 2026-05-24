use thiserror::Error;

pub type RuntimeCoreResult<T> = Result<T, RuntimeCoreError>;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum RuntimeCoreError {
    #[error("missing world model frame")]
    MissingFrame,
    #[error("missing plan artifact")]
    MissingPlan,
    #[error("phase proposal not found: {0}")]
    ProposalNotFound(String),
    #[error("phase not found: {0}")]
    PhaseNotFound(String),
    #[error("hook blocked boundary: {0}")]
    HookBlocked(String),
    #[error("required artifact missing: {0}")]
    RequiredArtifactMissing(String),
    #[error("phase execution failed: {0}")]
    PhaseExecutionFailed(String),
    #[error("invalid runtime state: {0}")]
    InvalidState(String),
}
