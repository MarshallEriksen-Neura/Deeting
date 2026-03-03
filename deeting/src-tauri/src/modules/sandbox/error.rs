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
