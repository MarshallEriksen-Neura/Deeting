use std::path::PathBuf;
use std::time::Duration;

use boxlite::{BoxCommand, BoxOptions, BoxliteOptions as BoxrunOptions, BoxliteRuntime as BoxrunRuntime, RootfsSpec};
use boxlite::{BoxliteError as BoxrunSdkError, BoxliteResult as BoxrunSdkResult, NetworkSpec};
use futures_util::StreamExt;

use crate::modules::sandbox::error::SandboxError;
use crate::modules::sandbox::types::{SandboxBoxSpec, SandboxExecutionOutput, SandboxIdentity};

#[derive(Debug, Clone)]
pub struct NativeBackendOptions {
    pub image: String,
    pub cpus: Option<u8>,
    pub memory_mib: Option<u32>,
    pub working_dir: Option<String>,
    pub python_bin: String,
}

#[derive(Clone)]
pub struct NativeBoxrunBackend {
    runtime: BoxrunRuntime,
    options: NativeBackendOptions,
}

impl NativeBoxrunBackend {
    pub fn new(home_dir: PathBuf, options: NativeBackendOptions) -> Result<Self, SandboxError> {
        std::fs::create_dir_all(&home_dir)?;

        let mut runtime_options = BoxrunOptions::default();
        runtime_options.home_dir = home_dir;

        let runtime = BoxrunRuntime::new(runtime_options).map_err(map_boxrun_error)?;
        Ok(Self { runtime, options })
    }

    pub async fn get_or_create_box(
        &self,
        box_name: &str,
        spec: &SandboxBoxSpec,
    ) -> Result<SandboxIdentity, SandboxError> {
        let mut options = BoxOptions::default();
        options.rootfs = RootfsSpec::Image(spec.image.clone());
        options.network = NetworkSpec::Isolated;
        options.auto_remove = false;
        options.detach = false;
        options.cpus = spec.cpus.or(self.options.cpus);
        options.memory_mib = spec.memory_mib.or(self.options.memory_mib);
        options.working_dir = spec
            .working_dir
            .clone()
            .or_else(|| self.options.working_dir.clone());

        let (boxrun_box, _) = self
            .runtime
            .get_or_create(options, Some(box_name.to_string()))
            .await
            .map_err(map_boxrun_error)?;

        Ok(SandboxIdentity {
            sandbox_id: boxrun_box.id().to_string(),
            sandbox_name: box_name.to_string(),
        })
    }

    pub async fn stop_box(&self, box_id_or_name: &str) -> Result<(), SandboxError> {
        let maybe_boxrun_box = self
            .runtime
            .get(box_id_or_name)
            .await
            .map_err(map_boxrun_error)?;
        if let Some(boxrun_box) = maybe_boxrun_box {
            boxrun_box.stop().await.map_err(map_boxrun_error)?;
        }
        Ok(())
    }

    pub async fn remove_box(&self, box_id_or_name: &str, force: bool) -> Result<(), SandboxError> {
        self.runtime
            .remove(box_id_or_name, force)
            .await
            .map_err(map_boxrun_error)
    }

    pub async fn run_python(
        &self,
        box_id_or_name: &str,
        code: &str,
        timeout_seconds: u64,
    ) -> Result<SandboxExecutionOutput, SandboxError> {
        let boxrun_box = self
            .runtime
            .get(box_id_or_name)
            .await
            .map_err(map_boxrun_error)?
            .ok_or_else(|| SandboxError::NotFound(format!("sandbox {box_id_or_name} not found")))?;

        let mut command = BoxCommand::new(self.options.python_bin.clone())
            .args(["-c".to_string(), code.to_string()])
            .timeout(Duration::from_secs(timeout_seconds.max(1)));
        if let Some(working_dir) = self.options.working_dir.clone() {
            command = command.working_dir(working_dir);
        }

        let mut execution = boxrun_box.exec(command).await.map_err(map_boxrun_error)?;
        let stdout_stream = execution.stdout();
        let stderr_stream = execution.stderr();

        let stdout_task = tokio::spawn(async move { collect_stdout(stdout_stream).await });
        let stderr_task = tokio::spawn(async move { collect_stderr(stderr_stream).await });

        let status = execution.wait().await.map_err(map_boxrun_error)?;
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
        self.runtime.shutdown(Some(10)).await.map_err(map_boxrun_error)
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

fn map_boxrun_error(err: BoxrunSdkError) -> SandboxError {
    match err {
        BoxrunSdkError::NotFound(message) => SandboxError::NotFound(message),
        BoxrunSdkError::InvalidArgument(message) => SandboxError::Validation(message),
        BoxrunSdkError::InvalidState(message) => SandboxError::Busy(message),
        BoxrunSdkError::AlreadyExists(message) => SandboxError::ResourceLimit(message),
        BoxrunSdkError::Config(message) => SandboxError::Unavailable(message),
        BoxrunSdkError::Unsupported(message) => SandboxError::Unavailable(message),
        other => SandboxError::Internal(other.to_string()),
    }
}

#[allow(dead_code)]
fn _assert_result_type(_: BoxrunSdkResult<()>) {}
