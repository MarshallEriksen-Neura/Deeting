use std::io::Write;
use std::path::Path;
use std::time::Duration;

use boxlite::{BoxCommand, BoxOptions, BoxliteError, BoxliteRestOptions, BoxliteRuntime, RootfsSpec};
use boxlite_sidecar_protocol::{
    BoxliteSidecarConnection, BoxliteSidecarCreateBoxOptions, BoxliteSidecarEnvelope,
    BoxliteSidecarErrorKind, BoxliteSidecarExecutionOutput, BoxliteSidecarExecutionRequest,
    BoxliteSidecarFilePayload, BoxliteSidecarIdentity, BoxliteSidecarRequest,
    BoxliteSidecarResponseEnvelope, BoxliteSidecarResponsePayload,
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
        BoxliteSidecarRequest::RemoveBox {
            connection,
            box_id_or_name,
            force,
        } => {
            let runtime = build_runtime(&connection)?;
            runtime
                .remove(box_id_or_name.as_str(), force)
                .await
                .map_err(map_boxlite_error)?;
            Ok(BoxliteSidecarResponsePayload::RemoveBox { ok: true })
        }
        BoxliteSidecarRequest::Execute {
            connection,
            box_id_or_name,
            request,
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

            let execution_request = validate_execution_request(&request)?;
            let mut execution = litebox
                .exec(build_execution_command(&execution_request)?)
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
            Ok(BoxliteSidecarResponsePayload::Execute {
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

fn validate_execution_request(
    request: &BoxliteSidecarExecutionRequest,
) -> Result<BoxliteSidecarExecutionRequest, (BoxliteSidecarErrorKind, String)> {
    let command = request.command.trim();
    if command.is_empty() {
        return Err((
            BoxliteSidecarErrorKind::Validation,
            "command is required".to_string(),
        ));
    }

    let mut total_bytes = 0usize;
    if request.stdin.is_some() {
        return Err((
            BoxliteSidecarErrorKind::Unavailable,
            "stdin streaming is not supported by the current BoxLite sidecar build".to_string(),
        ));
    }
    for file in &request.files {
        total_bytes = total_bytes.saturating_add(file.content.len());
        if total_bytes > 256 * 1024 {
            return Err((
                BoxliteSidecarErrorKind::Validation,
                "execution payload is too large".to_string(),
            ));
        }
        normalize_staged_file_path(file.path.as_str())?;
    }

    Ok(request.clone())
}

fn build_execution_command(
    request: &BoxliteSidecarExecutionRequest,
) -> Result<BoxCommand, (BoxliteSidecarErrorKind, String)> {
    let timeout = Duration::from_secs(request.timeout_seconds.max(1));
    if request.files.is_empty() {
        let mut command = BoxCommand::new(request.command.trim())
            .timeout(timeout);
        for arg in &request.args {
            command = command.arg(arg.clone());
        }
        if let Some(working_dir) = request
            .working_dir
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            command = command.working_dir(working_dir.to_string());
        }
        return Ok(command);
    }

    let script = build_staged_execution_script(request)?;
    Ok(BoxCommand::new("sh")
        .arg("-lc")
        .arg(script)
        .timeout(timeout))
}

fn build_staged_execution_script(
    request: &BoxliteSidecarExecutionRequest,
) -> Result<String, (BoxliteSidecarErrorKind, String)> {
    let mut lines = vec!["set -eu".to_string()];
    if let Some(working_dir) = request
        .working_dir
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        lines.push(format!("mkdir -p {}", shell_quote(working_dir)));
        lines.push(format!("cd {}", shell_quote(working_dir)));
    }

    for (index, file) in request.files.iter().enumerate() {
        let normalized_path = normalize_staged_file_path(file.path.as_str())?;
        if let Some(parent) = parent_dir_from_relative_path(normalized_path.as_str()) {
            lines.push(format!("mkdir -p {}", shell_quote(parent.as_str())));
        }
        let marker = unique_heredoc_marker(file, index);
        lines.push(format!("cat <<'{marker}' > {}", shell_quote(normalized_path.as_str())));
        lines.push(file.content.clone());
        lines.push(marker);
    }

    let mut command_line = shell_quote(request.command.trim());
    for arg in &request.args {
        command_line.push(' ');
        command_line.push_str(shell_quote(arg).as_str());
    }
    lines.push(format!("exec {command_line}"));
    Ok(lines.join("\n"))
}

fn normalize_staged_file_path(
    raw_path: &str,
) -> Result<String, (BoxliteSidecarErrorKind, String)> {
    let normalized = raw_path.trim().replace('\\', "/");
    if normalized.is_empty() {
        return Err((
            BoxliteSidecarErrorKind::Validation,
            "file path is required".to_string(),
        ));
    }
    if normalized.starts_with('/') {
        return Err((
            BoxliteSidecarErrorKind::Validation,
            format!("absolute file paths are not allowed: {normalized}"),
        ));
    }

    let mut parts = Vec::new();
    for segment in normalized.split('/') {
        let trimmed = segment.trim();
        if trimmed.is_empty() || trimmed == "." {
            continue;
        }
        if trimmed == ".." {
            return Err((
                BoxliteSidecarErrorKind::Validation,
                format!("parent traversal is not allowed in file paths: {normalized}"),
            ));
        }
        parts.push(trimmed);
    }

    if parts.is_empty() {
        return Err((
            BoxliteSidecarErrorKind::Validation,
            format!("invalid file path: {raw_path}"),
        ));
    }

    Ok(parts.join("/"))
}

fn parent_dir_from_relative_path(path: &str) -> Option<String> {
    Path::new(path)
        .parent()
        .map(|parent| parent.to_string_lossy().replace('\\', "/"))
        .map(|parent| parent.trim().trim_matches('/').to_string())
        .filter(|parent| !parent.is_empty())
}

fn unique_heredoc_marker(file: &BoxliteSidecarFilePayload, index: usize) -> String {
    let mut marker = format!("__DEETING_FILE_{index}__");
    while file.content.contains(marker.as_str()) {
        marker.push_str("_X");
    }
    marker
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_staged_execution_script_writes_files_before_exec() {
        let script = build_staged_execution_script(&BoxliteSidecarExecutionRequest {
            command: "python".to_string(),
            args: vec!["main.py".to_string()],
            files: vec![BoxliteSidecarFilePayload {
                path: "src/main.py".to_string(),
                content: "print('hello')".to_string(),
            }],
            stdin: None,
            timeout_seconds: 5,
            working_dir: Some("/workspace".to_string()),
        })
        .expect("script");

        assert!(script.contains("cd '/workspace'"));
        assert!(script.contains("mkdir -p 'src'"));
        assert!(script.contains("cat <<'__DEETING_FILE_0__' > 'src/main.py'"));
        assert!(script.contains("exec 'python' 'main.py'"));
    }

    #[test]
    fn normalize_staged_file_path_rejects_parent_traversal() {
        let error = normalize_staged_file_path("../secret.txt").expect_err("expected rejection");
        assert_eq!(error.0, BoxliteSidecarErrorKind::Validation);
    }
}
