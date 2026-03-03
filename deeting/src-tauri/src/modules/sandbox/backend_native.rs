use std::path::PathBuf;
use std::time::Duration;

use boxlite::{BoxCommand, BoxOptions, BoxliteOptions, BoxliteRuntime, RootfsSpec};
use boxlite::{BoxliteError as BoxliteSdkError, BoxliteResult as BoxliteSdkResult, NetworkSpec};
use futures_util::StreamExt;

use crate::modules::sandbox::error::SandboxError;
use crate::modules::sandbox::types::{SandboxExecutionOutput, SandboxIdentity};

#[derive(Debug, Clone)]
pub struct NativeBackendOptions {
    pub image: String,
    pub cpus: Option<u8>,
    pub memory_mib: Option<u32>,
    pub working_dir: Option<String>,
    pub python_bin: String,
}

#[derive(Clone)]
pub struct NativeBoxliteBackend {
    runtime: BoxliteRuntime,
    options: NativeBackendOptions,
}

impl NativeBoxliteBackend {
    pub fn new(home_dir: PathBuf, options: NativeBackendOptions) -> Result<Self, SandboxError> {
        std::fs::create_dir_all(&home_dir)?;

        let mut runtime_options = BoxliteOptions::default();
        runtime_options.home_dir = home_dir;

        let runtime = BoxliteRuntime::new(runtime_options).map_err(map_boxlite_error)?;
        Ok(Self { runtime, options })
    }

    pub async fn get_or_create_box(&self, box_name: &str) -> Result<SandboxIdentity, SandboxError> {
        let mut options = BoxOptions::default();
        options.rootfs = RootfsSpec::Image(self.options.image.clone());
        options.network = NetworkSpec::Isolated;
        options.auto_remove = false;
        options.detach = false;
        options.cpus = self.options.cpus;
        options.memory_mib = self.options.memory_mib;
        options.working_dir = self.options.working_dir.clone();

        let (litebox, _) = self
            .runtime
            .get_or_create(options, Some(box_name.to_string()))
            .await
            .map_err(map_boxlite_error)?;

        Ok(SandboxIdentity {
            sandbox_id: litebox.id().to_string(),
            sandbox_name: box_name.to_string(),
        })
    }

    pub async fn stop_box(&self, box_id_or_name: &str) -> Result<(), SandboxError> {
        let maybe_box = self
            .runtime
            .get(box_id_or_name)
            .await
            .map_err(map_boxlite_error)?;
        if let Some(litebox) = maybe_box {
            litebox.stop().await.map_err(map_boxlite_error)?;
        }
        Ok(())
    }

    pub async fn run_python(
        &self,
        box_id_or_name: &str,
        code: &str,
        timeout_seconds: u64,
    ) -> Result<SandboxExecutionOutput, SandboxError> {
        let litebox = self
            .runtime
            .get(box_id_or_name)
            .await
            .map_err(map_boxlite_error)?
            .ok_or_else(|| SandboxError::NotFound(format!("sandbox {box_id_or_name} not found")))?;

        let mut command = BoxCommand::new(self.options.python_bin.clone())
            .args(["-c".to_string(), code.to_string()])
            .timeout(Duration::from_secs(timeout_seconds.max(1)));
        if let Some(working_dir) = self.options.working_dir.clone() {
            command = command.working_dir(working_dir);
        }

        let mut execution = litebox.exec(command).await.map_err(map_boxlite_error)?;
        let stdout_stream = execution.stdout();
        let stderr_stream = execution.stderr();

        let stdout_task = tokio::spawn(async move { collect_stdout(stdout_stream).await });
        let stderr_task = tokio::spawn(async move { collect_stderr(stderr_stream).await });

        let status = execution.wait().await.map_err(map_boxlite_error)?;
        let stdout = stdout_task.await.unwrap_or_default();
        let stderr = stderr_task.await.unwrap_or_default();

        Ok(SandboxExecutionOutput {
            stdout,
            stderr,
            exit_code: status.code(),
            error_message: status.error_message,
        })
    }

    pub async fn shutdown(&self) -> Result<(), SandboxError> {
        self.runtime.shutdown(Some(10)).await.map_err(map_boxlite_error)
    }
}

async fn collect_stdout(mut stream: Option<boxlite::ExecStdout>) -> Vec<String> {
    let mut lines = Vec::new();
    if let Some(ref mut s) = stream {
        while let Some(line) = s.next().await {
            lines.push(line);
        }
    }
    lines
}

async fn collect_stderr(mut stream: Option<boxlite::ExecStderr>) -> Vec<String> {
    let mut lines = Vec::new();
    if let Some(ref mut s) = stream {
        while let Some(line) = s.next().await {
            lines.push(line);
        }
    }
    lines
}

fn map_boxlite_error(err: BoxliteSdkError) -> SandboxError {
    match err {
        BoxliteSdkError::NotFound(message) => SandboxError::NotFound(message),
        BoxliteSdkError::InvalidArgument(message) => SandboxError::Validation(message),
        BoxliteSdkError::InvalidState(message) => SandboxError::Busy(message),
        BoxliteSdkError::AlreadyExists(message) => SandboxError::ResourceLimit(message),
        BoxliteSdkError::Config(message) => SandboxError::Unavailable(message),
        BoxliteSdkError::Unsupported(message) => SandboxError::Unavailable(message),
        other => SandboxError::Internal(other.to_string()),
    }
}

#[allow(dead_code)]
fn _assert_result_type(_: BoxliteSdkResult<()>) {}
