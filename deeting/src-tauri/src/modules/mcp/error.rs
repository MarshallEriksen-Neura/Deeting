use thiserror::Error;

#[derive(Debug, Error)]
pub enum McpError {
    #[error("validation error: {0}")]
    Validation(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("process error: {0}")]
    Process(String),
    #[error("storage error: {0}")]
    Storage(String),
    #[error("network error: {0}")]
    Network(String),
}

impl McpError {
    pub fn validation(message: impl Into<String>) -> Self {
        McpError::Validation(message.into())
    }
}

impl From<sqlx::Error> for McpError {
    fn from(err: sqlx::Error) -> Self {
        McpError::Storage(err.to_string())
    }
}

impl From<serde_json::Error> for McpError {
    fn from(err: serde_json::Error) -> Self {
        McpError::Storage(err.to_string())
    }
}

impl From<time::error::Format> for McpError {
    fn from(err: time::error::Format) -> Self {
        McpError::Storage(err.to_string())
    }
}
