use thiserror::Error;

#[derive(Debug, Error)]
pub enum SandboxError {
    #[error("validation error: {0}")]
    Validation(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("sandbox unavailable: {0}")]
    Unavailable(String),
    #[error("sandbox busy: {0}")]
    Busy(String),
    #[error("sandbox resource limit: {0}")]
    ResourceLimit(String),
    #[error("sandbox timeout: {0}")]
    Timeout(String),
    #[error("sandbox network error: {0}")]
    Network(String),
    #[error("sandbox internal error: {0}")]
    Internal(String),
}

impl SandboxError {
    pub fn code(&self) -> &'static str {
        match self {
            SandboxError::Validation(_) => "SANDBOX_VALIDATION_ERROR",
            SandboxError::NotFound(_) => "SANDBOX_NOT_FOUND",
            SandboxError::Unavailable(_) => "SANDBOX_UNAVAILABLE",
            SandboxError::Busy(_) => "SANDBOX_SESSION_BUSY",
            SandboxError::ResourceLimit(_) => "SANDBOX_RESOURCE_LIMIT",
            SandboxError::Timeout(_) => "SANDBOX_TIMEOUT",
            SandboxError::Network(_) => "SANDBOX_NETWORK_ERROR",
            SandboxError::Internal(_) => "SANDBOX_INTERNAL_ERROR",
        }
    }

    pub fn user_message(&self) -> String {
        match self {
            SandboxError::Validation(message) => message.clone(),
            SandboxError::NotFound(_) => {
                "The desktop sandbox session is no longer available. Deeting will try to rebuild it automatically. If this keeps happening, use Rebuild Sandbox in Settings.".to_string()
            }
            SandboxError::Unavailable(message) => message.clone(),
            SandboxError::Busy(_) => {
                "The desktop sandbox is busy running another task. Please wait a moment and try again.".to_string()
            }
            SandboxError::ResourceLimit(_) => {
                "The desktop sandbox hit a local resource limit. Close other running tasks or rebuild the sandbox and try again.".to_string()
            }
            SandboxError::Timeout(_) => {
                "The desktop sandbox timed out before the command finished. Try reducing the workload or increasing the timeout.".to_string()
            }
            SandboxError::Network(_) => {
                "Deeting could not reach the local BoxLite runtime. Try Prepare, Repair, or Rebuild Sandbox from Settings.".to_string()
            }
            SandboxError::Internal(message) => message.clone(),
        }
    }
}

impl From<reqwest::Error> for SandboxError {
    fn from(err: reqwest::Error) -> Self {
        if err.is_timeout() {
            return SandboxError::Timeout(err.to_string());
        }
        if err.is_connect() || err.is_request() {
            return SandboxError::Network(err.to_string());
        }
        SandboxError::Internal(err.to_string())
    }
}

impl From<std::io::Error> for SandboxError {
    fn from(err: std::io::Error) -> Self {
        SandboxError::Internal(err.to_string())
    }
}
