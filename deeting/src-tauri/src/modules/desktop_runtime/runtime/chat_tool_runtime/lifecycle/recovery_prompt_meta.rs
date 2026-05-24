pub(super) fn recovery_assistant_meta(
    execution_graph: &serde_json::Value,
    execution_id: &str,
    stage: &str,
    available_actions: &[&str],
) -> Option<serde_json::Value> {
    crate::modules::desktop_runtime::runtime::assistant_persistence::with_assistant_persistence_state(
        Some(serde_json::json!({
            "execution_graph": execution_graph,
            "recovery": {
                "execution_id": execution_id,
                "stage": stage,
                "available_actions": available_actions,
            }
        })),
        crate::modules::desktop_runtime::runtime::assistant_persistence::AssistantPersistenceState {
            assistant_message_persisted: true,
            execution_graph_persisted: true,
            postprocess_completed: true,
        },
    )
}
