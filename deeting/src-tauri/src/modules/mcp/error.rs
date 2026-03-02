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
