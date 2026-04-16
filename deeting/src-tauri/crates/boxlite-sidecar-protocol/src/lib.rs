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
pub struct BoxliteSidecarFilePayload {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoxliteSidecarExecutionRequest {
    pub command: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub files: Vec<BoxliteSidecarFilePayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stdin: Option<String>,
    pub timeout_seconds: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub working_dir: Option<String>,
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
    Execute {
        connection: BoxliteSidecarConnection,
        box_id_or_name: String,
        request: BoxliteSidecarExecutionRequest,
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
    Execute {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn execute_request_serializes_with_generic_payload() {
        let value = serde_json::to_value(BoxliteSidecarRequest::Execute {
            connection: BoxliteSidecarConnection {
                base_url: "http://127.0.0.1:9090".to_string(),
                client_id: None,
                client_secret: None,
                prefix: None,
            },
            box_id_or_name: "box-1".to_string(),
            request: BoxliteSidecarExecutionRequest {
                command: "python".to_string(),
                args: vec!["main.py".to_string()],
                files: vec![BoxliteSidecarFilePayload {
                    path: "main.py".to_string(),
                    content: "print('hi')".to_string(),
                }],
                stdin: None,
                timeout_seconds: 30,
                working_dir: Some("/workspace".to_string()),
            },
        })
        .unwrap();

        assert_eq!(value["method"], serde_json::json!("execute"));
        assert_eq!(value["request"]["command"], serde_json::json!("python"));
        assert_eq!(
            value["request"]["files"][0]["path"],
            serde_json::json!("main.py")
        );
    }
}
