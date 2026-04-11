use std::io::Write;
use std::time::Duration;

use boxlite::{BoxCommand, BoxOptions, BoxliteError, BoxliteRestOptions, BoxliteRuntime, RootfsSpec};
use boxlite_sidecar_protocol::{
    BoxliteSidecarConnection, BoxliteSidecarCreateBoxOptions, BoxliteSidecarEnvelope,
    BoxliteSidecarErrorKind, BoxliteSidecarExecutionOutput, BoxliteSidecarIdentity,
    BoxliteSidecarRequest, BoxliteSidecarResponseEnvelope, BoxliteSidecarResponsePayload,
};
use futures_util::StreamExt;
use tokio::io::{AsyncBufReadExt, BufReader};

fn main() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("boxlite sidecar runtime");
    runtime.block_on(async {
        run_stdio_bridge().await;
    });
}

async fn run_stdio_bridge() {
    let stdin = tokio::io::stdin();
    let mut lines = BufReader::new(stdin).lines();
    let stdout = std::io::stdout();
    let mut stdout_lock = stdout.lock();

    while let Ok(Some(line)) = lines.next_line().await {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let response = match serde_json::from_str::<BoxliteSidecarEnvelope>(trimmed) {
            Ok(envelope) => handle_request(envelope).await,
            Err(err) => BoxliteSidecarResponseEnvelope {
                id: "invalid".to_string(),
                payload: BoxliteSidecarResponsePayload::Error {
                    error_kind: BoxliteSidecarErrorKind::Validation,
                    message: err.to_string(),
                },
            },
        };

        if let Ok(serialized) = serde_json::to_string(&response) {
            let _ = writeln!(stdout_lock, "{}", serialized);
            let _ = stdout_lock.flush();
        }
    }
}

async fn handle_request(envelope: BoxliteSidecarEnvelope) -> BoxliteSidecarResponseEnvelope {
    let payload = match dispatch_request(envelope.request).await {
        Ok(payload) => payload,
        Err((error_kind, message)) => BoxliteSidecarResponsePayload::Error {
            error_kind,
            message,
        },
    };

    BoxliteSidecarResponseEnvelope {
        id: envelope.id,
        payload,
    }
}

async fn dispatch_request(
    request: BoxliteSidecarRequest,
) -> Result<BoxliteSidecarResponsePayload, (BoxliteSidecarErrorKind, String)> {
    match request {
        BoxliteSidecarRequest::Probe { connection } => {
            let runtime = build_runtime(&connection)?;
            runtime.list_info().await.map_err(map_boxlite_error)?;
            Ok(BoxliteSidecarResponsePayload::Probe { ok: true })
        }
        BoxliteSidecarRequest::GetOrCreateBox {
            connection,
            box_name,
            options,
        } => {
            let runtime = build_runtime(&connection)?;
            let (litebox, _) = runtime
                .get_or_create(build_box_options(&options), Some(box_name.clone()))
                .await
                .map_err(map_boxlite_error)?;
            Ok(BoxliteSidecarResponsePayload::GetOrCreateBox {
                data: BoxliteSidecarIdentity {
                    sandbox_id: litebox.id().to_string(),
                    sandbox_name: litebox.name().unwrap_or(box_name.as_str()).to_string(),
                },
            })
        }
        BoxliteSidecarRequest::StopBox {
            connection,
            box_id_or_name,
        } => {
            let runtime = build_runtime(&connection)?;
            if let Some(litebox) = runtime
                .get(box_id_or_name.as_str())
                .await
                .map_err(map_boxlite_error)?
            {
                litebox.stop().await.map_err(map_boxlite_error)?;
            }
            Ok(BoxliteSidecarResponsePayload::StopBox { ok: true })
        }
        BoxliteSidecarRequest::RunPython {
            connection,
            box_id_or_name,
            python_bin,
            code,
            timeout_seconds,
            working_dir,
        } => {
            let runtime = build_runtime(&connection)?;
            let litebox = runtime
                .get(box_id_or_name.as_str())
                .await
                .map_err(map_boxlite_error)?
                .ok_or_else(|| {
                    (
                        BoxliteSidecarErrorKind::NotFound,
                        format!("sandbox {box_id_or_name} not found"),
                    )
                })?;

            let mut execution = litebox
                .exec(build_python_command(
                    python_bin.as_str(),
                    code.as_str(),
                    timeout_seconds,
                    working_dir.as_deref(),
                ))
                .await
                .map_err(map_boxlite_error)?;

            let mut stdout = Vec::new();
            let mut stderr = Vec::new();

            if let Some(mut stdout_stream) = execution.stdout() {
                while let Some(chunk) = stdout_stream.next().await {
                    collect_output_lines(&mut stdout, chunk.as_str());
                }
            }
            if let Some(mut stderr_stream) = execution.stderr() {
                while let Some(chunk) = stderr_stream.next().await {
                    collect_output_lines(&mut stderr, chunk.as_str());
                }
            }

            let result = execution.wait().await.map_err(map_boxlite_error)?;
            Ok(BoxliteSidecarResponsePayload::RunPython {
                data: BoxliteSidecarExecutionOutput {
                    stdout,
                    stderr,
                    exit_code: result.exit_code,
                    error_message: result.error_message,
                },
            })
        }
    }
}

fn build_runtime(
    connection: &BoxliteSidecarConnection,
) -> Result<BoxliteRuntime, (BoxliteSidecarErrorKind, String)> {
    let base_url = connection.base_url.trim();
    if base_url.is_empty() {
        return Err((
            BoxliteSidecarErrorKind::Validation,
            "base_url is required".to_string(),
        ));
    }

    let mut options = BoxliteRestOptions::new(base_url.to_string());
    if let Some(prefix) = connection.prefix.as_deref() {
        let trimmed = prefix.trim();
        if !trimmed.is_empty() {
            options = options.with_prefix(trimmed.to_string());
        }
    }

    if let (Some(client_id), Some(client_secret)) = (
        connection.client_id.as_deref(),
        connection.client_secret.as_deref(),
    ) {
        if !client_id.trim().is_empty() && !client_secret.trim().is_empty() {
            options = options.with_credentials(
                client_id.trim().to_string(),
                client_secret.trim().to_string(),
            );
        }
    }

    BoxliteRuntime::rest(options).map_err(map_boxlite_error)
}

fn build_box_options(options: &BoxliteSidecarCreateBoxOptions) -> BoxOptions {
    BoxOptions {
        cpus: options.cpus,
        memory_mib: options.memory_mib,
        working_dir: options.working_dir.clone(),
        rootfs: RootfsSpec::Image(options.image.clone()),
        auto_remove: false,
        detach: false,
        ..Default::default()
    }
}

fn build_python_command(
    python_bin: &str,
    code: &str,
    timeout_seconds: u64,
    working_dir: Option<&str>,
) -> BoxCommand {
    let mut command = BoxCommand::new(python_bin.trim())
        .arg("-c")
        .arg(code.to_string())
        .timeout(Duration::from_secs(timeout_seconds.max(1)));
    if let Some(working_dir) = working_dir {
        let trimmed = working_dir.trim();
        if !trimmed.is_empty() {
            command = command.working_dir(trimmed.to_string());
        }
    }
    command
}

fn collect_output_lines(target: &mut Vec<String>, chunk: &str) {
    if chunk.is_empty() {
        return;
    }
    target.extend(chunk.lines().map(|line| line.to_string()));
}

fn map_boxlite_error(err: BoxliteError) -> (BoxliteSidecarErrorKind, String) {
    let message = err.to_string();
    let lowered = message.to_ascii_lowercase();

    let kind = if lowered.contains("not found")
        || lowered.contains("does not exist")
        || lowered.contains("no such box")
    {
        BoxliteSidecarErrorKind::NotFound
    } else if lowered.contains("busy") {
        BoxliteSidecarErrorKind::Busy
    } else if lowered.contains("timed out") || lowered.contains("timeout") {
        BoxliteSidecarErrorKind::Timeout
    } else if lowered.contains("connection refused")
        || lowered.contains("failed to connect")
        || lowered.contains("dns")
        || lowered.contains("network")
        || lowered.contains("transport")
        || lowered.contains("http request failed")
        || lowered.contains("sse connect failed")
    {
        BoxliteSidecarErrorKind::Network
    } else if lowered.contains("unsupported")
        || lowered.contains("unavailable")
        || lowered.contains("not supported")
    {
        BoxliteSidecarErrorKind::Unavailable
    } else if lowered.contains("validation") || lowered.contains("config") {
        BoxliteSidecarErrorKind::Validation
    } else {
        BoxliteSidecarErrorKind::Internal
    };

    (kind, message)
}
