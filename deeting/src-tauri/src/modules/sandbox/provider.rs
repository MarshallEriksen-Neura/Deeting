use async_trait::async_trait;

use crate::modules::sandbox::error::SandboxError;
use crate::modules::sandbox::types::{
    SandboxBoxSpec, SandboxExecutionOutput, SandboxExecutionRequest, SandboxIdentity,
};

/// Abstract sandbox provider interface.
///
/// Deeting depends on this trait, never on a specific sandbox implementation.
/// To swap BoxLite for another sandbox (E2B, Daytona, custom), implement this
/// trait and register it in `SandboxRuntimeManager::build_backend`.
#[async_trait]
pub trait SandboxProvider: Send + Sync {
    /// Human-readable provider name (e.g. "boxlite", "host-python").
    fn provider_name(&self) -> &str;

    /// Get or create a sandbox instance for the given box name.
    async fn get_or_create_box(
        &self,
        box_name: &str,
        spec: &SandboxBoxSpec,
    ) -> Result<SandboxIdentity, SandboxError>;

    /// Stop a running sandbox.
    async fn stop_box(&self, box_id_or_name: &str) -> Result<(), SandboxError>;

    /// Remove a sandbox so the next get-or-create call cannot reuse stale state.
    async fn remove_box(&self, box_id_or_name: &str, _force: bool) -> Result<(), SandboxError> {
        self.stop_box(box_id_or_name).await
    }

    /// Execute a generic command inside the sandbox.
    async fn execute(
        &self,
        box_id_or_name: &str,
        request: SandboxExecutionRequest,
    ) -> Result<SandboxExecutionOutput, SandboxError> {
        let command = request.command.trim().to_ascii_lowercase();
        if request.files.is_empty()
            && request.stdin.is_none()
            && matches!(command.as_str(), "python" | "python3")
            && request.args.len() >= 2
            && request.args[0] == "-c"
        {
            return self
                .run_python(
                    box_id_or_name,
                    request.args[1].as_str(),
                    request.timeout_seconds,
                )
                .await;
        }

        Err(SandboxError::Unavailable(
            "sandbox provider does not support generic execution requests".to_string(),
        ))
    }

    /// Execute Python code inside a sandbox and return the output.
    async fn run_python(
        &self,
        box_id_or_name: &str,
        code: &str,
        timeout_seconds: u64,
    ) -> Result<SandboxExecutionOutput, SandboxError>;

    /// Gracefully shut down the provider and release all resources.
    async fn shutdown(&self) -> Result<(), SandboxError> {
        Ok(())
    }

    /// Health-check / probe. Default returns Ok.
    async fn probe(&self) -> Result<(), SandboxError> {
        Ok(())
    }
}
