use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoxliteSidecarConnection {
    pub base_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_secret: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prefix: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoxliteSidecarCreateBoxOptions {
    pub image: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cpus: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_mib: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub working_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoxliteSidecarIdentity {
    pub sandbox_id: String,
    pub sandbox_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoxliteSidecarExecutionOutput {
    pub stdout: Vec<String>,
    pub stderr: Vec<String>,
    pub exit_code: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "method", rename_all = "snake_case")]
pub enum BoxliteSidecarRequest {
    Probe {
        connection: BoxliteSidecarConnection,
    },
    GetOrCreateBox {
        connection: BoxliteSidecarConnection,
        box_name: String,
        options: BoxliteSidecarCreateBoxOptions,
    },
    StopBox {
        connection: BoxliteSidecarConnection,
        box_id_or_name: String,
    },
    RunPython {
        connection: BoxliteSidecarConnection,
        box_id_or_name: String,
        python_bin: String,
        code: String,
        timeout_seconds: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        working_dir: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoxliteSidecarEnvelope {
    pub id: String,
    #[serde(flatten)]
    pub request: BoxliteSidecarRequest,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BoxliteSidecarErrorKind {
    Validation,
    NotFound,
    Unavailable,
    Busy,
    Timeout,
    Network,
    Internal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum BoxliteSidecarResponsePayload {
    Probe {
        ok: bool,
    },
    GetOrCreateBox {
        data: BoxliteSidecarIdentity,
    },
    StopBox {
        ok: bool,
    },
    RunPython {
        data: BoxliteSidecarExecutionOutput,
    },
    Error {
        error_kind: BoxliteSidecarErrorKind,
        message: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoxliteSidecarResponseEnvelope {
    pub id: String,
    #[serde(flatten)]
    pub payload: BoxliteSidecarResponsePayload,
}
