use std::collections::HashMap;
use std::pin::Pin;
use std::task::{Context, Poll};
use std::time::Duration;

use futures_util::{Stream, StreamExt};
use reqwest::{Client, RequestBuilder, StatusCode};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

pub type BoxliteResult<T> = Result<T, BoxliteError>;

#[derive(Debug, thiserror::Error)]
pub enum BoxliteError {
    #[error("validation error: {0}")]
    Validation(String),
    #[error("config error: {0}")]
    Config(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("unsupported: {0}")]
    Unsupported(String),
    #[error("network error: {0}")]
    Network(String),
    #[error("internal error: {0}")]
    Internal(String),
}

#[derive(Clone, Debug)]
pub struct BoxliteRestOptions {
    pub url: String,
    pub client_id: Option<String>,
    pub client_secret: Option<String>,
    pub prefix: Option<String>,
}

impl BoxliteRestOptions {
    pub fn new(url: impl Into<String>) -> Self {
        Self {
            url: url.into(),
            client_id: None,
            client_secret: None,
            prefix: None,
        }
    }

    pub fn with_credentials(mut self, client_id: String, client_secret: String) -> Self {
        self.client_id = Some(client_id);
        self.client_secret = Some(client_secret);
        self
    }

    pub fn with_prefix(mut self, prefix: String) -> Self {
        self.prefix = Some(prefix);
        self
    }

    fn effective_prefix(&self) -> &str {
        self.prefix.as_deref().unwrap_or("v1")
    }
}

#[derive(Clone, Debug)]
pub struct BoxliteRuntime {
    client: ApiClient,
}

impl BoxliteRuntime {
    pub fn rest(config: BoxliteRestOptions) -> BoxliteResult<Self> {
        Ok(Self {
            client: ApiClient::new(&config)?,
        })
    }

    pub async fn list_info(&self) -> BoxliteResult<Vec<BoxInfo>> {
        let response: ListBoxesResponse = self.client.get("/boxes").await?;
        Ok(response.boxes.into_iter().map(BoxResponse::into_info).collect())
    }

    pub async fn create(&self, options: BoxOptions, name: Option<String>) -> BoxliteResult<LiteBox> {
        let request = CreateBoxRequest::from_options(&options, name);
        let response: BoxResponse = self.client.post("/boxes", &request).await?;
        Ok(LiteBox::from_info(self.client.clone(), response.into_info()))
    }

    pub async fn get_or_create(
        &self,
        options: BoxOptions,
        name: Option<String>,
    ) -> BoxliteResult<(LiteBox, bool)> {
        if let Some(ref box_name) = name {
            if let Some(existing) = self.get(box_name).await? {
                return Ok((existing, false));
            }
        }
        self.create(options, name).await.map(|litebox| (litebox, true))
    }

    pub async fn get(&self, id_or_name: &str) -> BoxliteResult<Option<LiteBox>> {
        let path = format!("/boxes/{id_or_name}");
        match self.client.get::<BoxResponse>(&path).await {
            Ok(response) => Ok(Some(LiteBox::from_info(
                self.client.clone(),
                response.into_info(),
            ))),
            Err(BoxliteError::NotFound(_)) => Ok(None),
            Err(err) => Err(err),
        }
    }
}

#[derive(Clone, Debug)]
pub struct BoxInfo {
    pub id: String,
    pub name: Option<String>,
}

#[derive(Clone, Debug)]
pub struct LiteBox {
    client: ApiClient,
    info: BoxInfo,
}

impl LiteBox {
    fn from_info(client: ApiClient, info: BoxInfo) -> Self {
        Self { client, info }
    }

    pub fn id(&self) -> &String {
        &self.info.id
    }

    pub fn name(&self) -> Option<&str> {
        self.info.name.as_deref()
    }

    pub async fn stop(&self) -> BoxliteResult<()> {
        let path = format!("/boxes/{}/stop", self.info.id);
        let _: BoxResponse = self.client.post_empty(&path).await?;
        Ok(())
    }

    pub async fn exec(&self, command: BoxCommand) -> BoxliteResult<Execution> {
        let path = format!("/boxes/{}/exec", self.info.id);
        let response: ExecResponse = self.client.post(&path, &ExecRequest::from_command(&command)).await?;

        let input_path = format!("/boxes/{}/executions/{}/input", self.info.id, response.execution_id);
        self.client.post_bytes(&input_path, Vec::new(), true).await?;

        let (stdout_tx, stdout_rx) = mpsc::unbounded_channel::<String>();
        let (stderr_tx, stderr_rx) = mpsc::unbounded_channel::<String>();
        let (result_tx, result_rx) = mpsc::unbounded_channel::<ExecResult>();

        let client = self.client.clone();
        let box_id = self.info.id.clone();
        let execution_id = response.execution_id.clone();
        tokio::spawn(async move {
            let _ = read_sse_output(&client, &box_id, &execution_id, stdout_tx, stderr_tx, result_tx).await;
        });

        Ok(Execution::new(
            response.execution_id,
            result_rx,
            Some(ExecStdout::new(stdout_rx)),
            Some(ExecStderr::new(stderr_rx)),
        ))
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct BoxOptions {
    pub cpus: Option<u8>,
    pub memory_mib: Option<u32>,
    pub disk_size_gb: Option<u64>,
    pub working_dir: Option<String>,
    pub env: Vec<(String, String)>,
    pub rootfs: RootfsSpec,
    pub auto_remove: bool,
    pub detach: bool,
    pub entrypoint: Option<Vec<String>>,
    pub cmd: Option<Vec<String>>,
    pub user: Option<String>,
}

impl Default for BoxOptions {
    fn default() -> Self {
        Self {
            cpus: None,
            memory_mib: None,
            disk_size_gb: None,
            working_dir: None,
            env: Vec::new(),
            rootfs: RootfsSpec::Image("alpine:latest".to_string()),
            auto_remove: true,
            detach: false,
            entrypoint: None,
            cmd: None,
            user: None,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum RootfsSpec {
    Image(String),
    RootfsPath(String),
}

#[derive(Clone, Debug)]
pub struct BoxCommand {
    pub(crate) command: String,
    pub(crate) args: Vec<String>,
    pub(crate) env: Option<Vec<(String, String)>>,
    pub(crate) timeout: Option<Duration>,
    pub(crate) working_dir: Option<String>,
    pub(crate) tty: bool,
}

impl BoxCommand {
    pub fn new(command: impl Into<String>) -> Self {
        Self {
            command: command.into(),
            args: Vec::new(),
            env: None,
            timeout: None,
            working_dir: None,
            tty: false,
        }
    }

    pub fn arg(mut self, arg: impl Into<String>) -> Self {
        self.args.push(arg.into());
        self
    }

    pub fn timeout(mut self, timeout: Duration) -> Self {
        self.timeout = Some(timeout);
        self
    }

    pub fn working_dir(mut self, dir: impl Into<String>) -> Self {
        self.working_dir = Some(dir.into());
        self
    }
}

#[derive(Clone)]
pub struct Execution {
    id: String,
    inner: std::sync::Arc<tokio::sync::Mutex<ExecutionInner>>,
}

struct ExecutionInner {
    result_rx: mpsc::UnboundedReceiver<ExecResult>,
    cached_result: Option<ExecResult>,
    stdout: Option<ExecStdout>,
    stderr: Option<ExecStderr>,
}

impl Execution {
    fn new(
        id: String,
        result_rx: mpsc::UnboundedReceiver<ExecResult>,
        stdout: Option<ExecStdout>,
        stderr: Option<ExecStderr>,
    ) -> Self {
        Self {
            id,
            inner: std::sync::Arc::new(tokio::sync::Mutex::new(ExecutionInner {
                result_rx,
                cached_result: None,
                stdout,
                stderr,
            })),
        }
    }

    pub fn id(&self) -> &String {
        &self.id
    }

    pub fn stdout(&mut self) -> Option<ExecStdout> {
        futures::executor::block_on(async {
            let mut inner = self.inner.lock().await;
            inner.stdout.take()
        })
    }

    pub fn stderr(&mut self) -> Option<ExecStderr> {
        futures::executor::block_on(async {
            let mut inner = self.inner.lock().await;
            inner.stderr.take()
        })
    }

    pub async fn wait(&mut self) -> BoxliteResult<ExecResult> {
        let mut inner = self.inner.lock().await;
        if let Some(result) = inner.cached_result.clone() {
            return Ok(result);
        }
        if let Ok(result) = inner.result_rx.try_recv() {
            inner.cached_result = Some(result.clone());
            return Ok(result);
        }
        let result = inner
            .result_rx
            .recv()
            .await
            .ok_or_else(|| BoxliteError::Internal("result channel closed".to_string()))?;
        inner.cached_result = Some(result.clone());
        Ok(result)
    }
}

#[derive(Clone, Debug)]
pub struct ExecResult {
    pub exit_code: i32,
    pub error_message: Option<String>,
}

pub struct ExecStdout {
    receiver: mpsc::UnboundedReceiver<String>,
}

impl ExecStdout {
    fn new(receiver: mpsc::UnboundedReceiver<String>) -> Self {
        Self { receiver }
    }
}

impl Stream for ExecStdout {
    type Item = String;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        self.receiver.poll_recv(cx)
    }
}

pub struct ExecStderr {
    receiver: mpsc::UnboundedReceiver<String>,
}

impl ExecStderr {
    fn new(receiver: mpsc::UnboundedReceiver<String>) -> Self {
        Self { receiver }
    }
}

impl Stream for ExecStderr {
    type Item = String;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        self.receiver.poll_recv(cx)
    }
}

#[derive(Clone, Debug)]
struct ApiClient {
    http: Client,
    base_url: String,
    prefix: String,
    client_id: Option<String>,
    client_secret: Option<String>,
    token_cache: std::sync::Arc<tokio::sync::RwLock<Option<TokenCache>>>,
}

#[derive(Clone, Debug)]
struct TokenCache {
    token: String,
    expires_at: u64,
}

impl ApiClient {
    fn new(config: &BoxliteRestOptions) -> BoxliteResult<Self> {
        let http = Client::builder()
            .timeout(Duration::from_secs(300))
            .build()
            .map_err(|err| BoxliteError::Config(format!("failed to create HTTP client: {err}")))?;
        Ok(Self {
            http,
            base_url: config.url.trim_end_matches('/').to_string(),
            prefix: config.effective_prefix().to_string(),
            client_id: config.client_id.clone(),
            client_secret: config.client_secret.clone(),
            token_cache: std::sync::Arc::new(tokio::sync::RwLock::new(None)),
        })
    }

    fn url(&self, path: &str) -> String {
        format!("{}/{}/default{}", self.base_url, self.prefix, path)
    }

    fn url_root(&self, path: &str) -> String {
        format!("{}/{}{}", self.base_url, self.prefix, path)
    }

    async fn get_token(&self) -> BoxliteResult<Option<String>> {
        let (client_id, client_secret) = match (&self.client_id, &self.client_secret) {
            (Some(client_id), Some(client_secret)) => (client_id.clone(), client_secret.clone()),
            _ => return Ok(None),
        };

        {
            let cache = self.token_cache.read().await;
            if let Some(cached) = cache.as_ref() {
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs();
                if now + 60 < cached.expires_at {
                    return Ok(Some(cached.token.clone()));
                }
            }
        }

        let response = self
            .http
            .post(self.url_root("/oauth/tokens"))
            .form(&TokenRequest {
                grant_type: "client_credentials",
                client_id: &client_id,
                client_secret: &client_secret,
            })
            .send()
            .await
            .map_err(|err| BoxliteError::Config(format!("token request failed: {err}")))?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(BoxliteError::Config(format!(
                "token exchange failed (HTTP {status}): {body}"
            )));
        }

        let token_response: TokenResponse = response
            .json()
            .await
            .map_err(|err| BoxliteError::Config(format!("failed to parse token response: {err}")))?;

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let token = token_response.access_token.clone();
        *self.token_cache.write().await = Some(TokenCache {
            token: token.clone(),
            expires_at: now + token_response.expires_in,
        });
        Ok(Some(token))
    }

    async fn authorize(&self, builder: RequestBuilder) -> BoxliteResult<RequestBuilder> {
        if let Some(token) = self.get_token().await? {
            Ok(builder.bearer_auth(token))
        } else {
            Ok(builder)
        }
    }

    async fn get<T: for<'de> Deserialize<'de>>(&self, path: &str) -> BoxliteResult<T> {
        self.send_json(self.http.get(self.url(path))).await
    }

    async fn post<B: Serialize, T: for<'de> Deserialize<'de>>(
        &self,
        path: &str,
        body: &B,
    ) -> BoxliteResult<T> {
        self.send_json(self.http.post(self.url(path)).json(body)).await
    }

    async fn post_empty<T: for<'de> Deserialize<'de>>(&self, path: &str) -> BoxliteResult<T> {
        self.send_json(self.http.post(self.url(path))).await
    }

    async fn post_bytes(&self, path: &str, body: Vec<u8>, close_stdin: bool) -> BoxliteResult<()> {
        let mut builder = self
            .http
            .post(self.url(path))
            .header("Content-Type", "application/octet-stream")
            .body(body);
        if close_stdin {
            builder = builder.header("X-Close-Stdin", "true");
        }
        self.send_no_content(builder).await
    }

    async fn authorized_get(&self, path: &str) -> BoxliteResult<RequestBuilder> {
        self.authorize(self.http.get(self.url(path))).await
    }

    async fn send_json<T: for<'de> Deserialize<'de>>(&self, builder: RequestBuilder) -> BoxliteResult<T> {
        let response = self
            .authorize(builder)
            .await?
            .send()
            .await
            .map_err(map_transport_error)?;
        self.parse_json_response(response).await
    }

    async fn send_no_content(&self, builder: RequestBuilder) -> BoxliteResult<()> {
        let response = self
            .authorize(builder)
            .await?
            .send()
            .await
            .map_err(map_transport_error)?;
        if response.status().is_success() {
            Ok(())
        } else {
            Err(map_status_error(
                response.status(),
                response.text().await.unwrap_or_default().as_str(),
            ))
        }
    }

    async fn parse_json_response<T: for<'de> Deserialize<'de>>(
        &self,
        response: reqwest::Response,
    ) -> BoxliteResult<T> {
        let status = response.status();
        if status.is_success() {
            response
                .json::<T>()
                .await
                .map_err(|err| BoxliteError::Internal(format!("failed to parse response: {err}")))
        } else {
            let body = response.text().await.unwrap_or_default();
            if let Ok(parsed) = serde_json::from_str::<ErrorResponse>(&body) {
                Err(map_status_error(status, parsed.error.message.as_str()))
            } else {
                Err(map_status_error(status, body.as_str()))
            }
        }
    }
}

fn map_transport_error(err: reqwest::Error) -> BoxliteError {
    if err.is_timeout() {
        return BoxliteError::Network(format!("request timed out: {err}"));
    }
    if err.is_connect() || err.is_request() {
        return BoxliteError::Network(format!("request failed: {err}"));
    }
    BoxliteError::Internal(err.to_string())
}

fn map_status_error(status: StatusCode, body: &str) -> BoxliteError {
    let detail = if body.trim().is_empty() {
        format!("HTTP {status}")
    } else {
        format!("HTTP {status}: {}", body.trim())
    };
    match status.as_u16() {
        400 => BoxliteError::Validation(detail),
        401 | 403 => BoxliteError::Config(detail),
        404 => BoxliteError::NotFound(detail),
        408 | 504 => BoxliteError::Network(detail),
        409 => BoxliteError::Internal(detail),
        422 => BoxliteError::Validation(detail),
        _ => BoxliteError::Internal(detail),
    }
}

async fn read_sse_output(
    client: &ApiClient,
    box_id: &str,
    execution_id: &str,
    stdout_tx: mpsc::UnboundedSender<String>,
    stderr_tx: mpsc::UnboundedSender<String>,
    result_tx: mpsc::UnboundedSender<ExecResult>,
) -> BoxliteResult<()> {
    let path = format!("/boxes/{box_id}/executions/{execution_id}/output");
    let response = client
        .authorized_get(&path)
        .await?
        .header("Accept", "text/event-stream")
        .send()
        .await
        .map_err(map_transport_error)?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(map_status_error(status, body.as_str()));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut current_event = String::new();
    let mut current_data = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(map_transport_error)?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(newline) = buffer.find('\n') {
            let line = buffer[..newline].trim_end_matches('\r').to_string();
            buffer = buffer[newline + 1..].to_string();

            if line.is_empty() {
                dispatch_sse_event(&current_event, &current_data, &stdout_tx, &stderr_tx, &result_tx);
                current_event.clear();
                current_data.clear();
            } else if let Some(value) = line.strip_prefix("event: ") {
                current_event = value.to_string();
            } else if let Some(value) = line.strip_prefix("data: ") {
                if !current_data.is_empty() {
                    current_data.push('\n');
                }
                current_data.push_str(value);
            }
        }
    }

    if !current_event.is_empty() || !current_data.is_empty() {
        dispatch_sse_event(&current_event, &current_data, &stdout_tx, &stderr_tx, &result_tx);
    }
    Ok(())
}

fn dispatch_sse_event(
    event: &str,
    data: &str,
    stdout_tx: &mpsc::UnboundedSender<String>,
    stderr_tx: &mpsc::UnboundedSender<String>,
    result_tx: &mpsc::UnboundedSender<ExecResult>,
) {
    if data.is_empty() {
        return;
    }

    match event {
        "stdout" => {
            if let Some(decoded) = decode_b64_payload(data) {
                let _ = stdout_tx.send(decoded);
            }
        }
        "stderr" => {
            if let Some(decoded) = decode_b64_payload(data) {
                let _ = stderr_tx.send(decoded);
            }
        }
        "exit" => {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) {
                let _ = result_tx.send(ExecResult {
                    exit_code: parsed
                        .get("exit_code")
                        .and_then(|value| value.as_i64())
                        .unwrap_or(-1) as i32,
                    error_message: parsed
                        .get("error")
                        .and_then(|value| value.as_str())
                        .map(ToOwned::to_owned),
                });
            }
        }
        "error" => {
            let _ = result_tx.send(ExecResult {
                exit_code: -1,
                error_message: Some(data.to_string()),
            });
        }
        _ => {}
    }
}

fn decode_b64_payload(data: &str) -> Option<String> {
    let parsed = serde_json::from_str::<serde_json::Value>(data).ok()?;
    let encoded = parsed.get("data")?.as_str()?;
    let bytes = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        encoded.trim(),
    )
    .ok()?;
    String::from_utf8(bytes).ok()
}

#[derive(Debug, Serialize)]
struct TokenRequest<'a> {
    grant_type: &'a str,
    client_id: &'a str,
    client_secret: &'a str,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: u64,
}

#[derive(Debug, Deserialize)]
struct ErrorResponse {
    error: ErrorModel,
}

#[derive(Debug, Deserialize)]
struct ErrorModel {
    message: String,
}

#[derive(Debug, Deserialize)]
struct ListBoxesResponse {
    boxes: Vec<BoxResponse>,
}

#[derive(Debug, Deserialize)]
struct BoxResponse {
    box_id: String,
    name: Option<String>,
}

impl BoxResponse {
    fn into_info(self) -> BoxInfo {
        BoxInfo {
            id: self.box_id,
            name: self.name,
        }
    }
}

#[derive(Debug, Serialize)]
struct CreateBoxRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    image: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    rootfs_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cpus: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    memory_mib: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    disk_size_gb: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    working_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    env: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    entrypoint: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cmd: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    user: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    auto_remove: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    detach: Option<bool>,
}

impl CreateBoxRequest {
    fn from_options(options: &BoxOptions, name: Option<String>) -> Self {
        let (image, rootfs_path) = match &options.rootfs {
            RootfsSpec::Image(image) => (Some(image.clone()), None),
            RootfsSpec::RootfsPath(path) => (None, Some(path.clone())),
        };

        Self {
            name,
            image,
            rootfs_path,
            cpus: options.cpus,
            memory_mib: options.memory_mib,
            disk_size_gb: options.disk_size_gb,
            working_dir: options.working_dir.clone(),
            env: if options.env.is_empty() {
                None
            } else {
                Some(options.env.iter().cloned().collect())
            },
            entrypoint: options.entrypoint.clone(),
            cmd: options.cmd.clone(),
            user: options.user.clone(),
            auto_remove: Some(options.auto_remove),
            detach: Some(options.detach),
        }
    }
}

#[derive(Debug, Serialize)]
struct ExecRequest {
    command: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    args: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    env: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    timeout_seconds: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    working_dir: Option<String>,
    #[serde(default)]
    tty: bool,
}

impl ExecRequest {
    fn from_command(command: &BoxCommand) -> Self {
        Self {
            command: command.command.clone(),
            args: command.args.clone(),
            env: command
                .env
                .as_ref()
                .map(|pairs| pairs.iter().cloned().collect::<HashMap<String, String>>()),
            timeout_seconds: command.timeout.map(|timeout| timeout.as_secs_f64()),
            working_dir: command.working_dir.clone(),
            tty: command.tty,
        }
    }
}

#[derive(Debug, Deserialize)]
struct ExecResponse {
    execution_id: String,
}
