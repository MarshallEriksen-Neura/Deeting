pub mod hash;
pub mod store;
pub mod types;

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Serialize;
use thiserror::Error;

pub use store::{ExtractedToolFields, McpStore, NewSource, ToolUpsert};
pub use types::*;

#[derive(Debug, Error)]
pub enum McpError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("time format error: {0}")]
    Time(#[from] time::error::Format),
    #[error("validation error: {0}")]
    Validation(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("process error: {0}")]
    Process(String),
}

impl McpError {
    pub fn validation(message: String) -> Self {
        McpError::Validation(message)
    }
}

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
}

impl IntoResponse for McpError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            McpError::Validation(_) => (StatusCode::BAD_REQUEST, self.to_string()),
            McpError::NotFound(_) => (StatusCode::NOT_FOUND, self.to_string()),
            McpError::Process(_) => (StatusCode::CONFLICT, self.to_string()),
            _ => (StatusCode::INTERNAL_SERVER_ERROR, self.to_string()),
        };

        let body = axum::Json(ErrorResponse { error: message });
        (status, body).into_response()
    }
}
