use super::composition::run_local_runtime_composition;
use super::{LocalExecutionOutcome, LocalExecutionRequest};
use serde_json::Value;

pub(crate) async fn run_local_runtime_composition_entrypoint<F>(
    request: LocalExecutionRequest,
    mut emit_status: F,
) -> Result<LocalExecutionOutcome, String>
where
    F: FnMut(&str, Option<&str>, &str, &str, Option<Value>),
{
    emit_status(
        "evolve",
        Some("runtime_composition"),
        "success",
        "runtime.execution_plane.composition_entry",
        Some(serde_json::json!({
            "entrypoint": "run_local_runtime_composition_entrypoint",
            "composition": "deeting_runtime_phase_composition",
        })),
    );
    run_local_runtime_composition(request, &mut emit_status).await
}
