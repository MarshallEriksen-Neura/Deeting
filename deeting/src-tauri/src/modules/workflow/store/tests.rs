use crate::modules::mcp::store::McpStore;
use crate::modules::workflow::store::artifacts::{
    create_workflow_artifact, list_workflow_artifacts_by_run,
};
use crate::modules::workflow::store::checkpoints::{
    create_workflow_checkpoint, get_active_checkpoint_for_run, resolve_checkpoint,
};
use crate::modules::workflow::store::events::{create_workflow_event, list_workflow_events_by_run};
use crate::modules::workflow::store::runs::{
    create_workflow_run, get_workflow_run, update_workflow_run_status,
};
use crate::modules::workflow::store::schema::ensure_schema;
use crate::modules::workflow::store::steps::{
    create_workflow_step_run, list_workflow_step_runs_by_run,
};
use crate::modules::workflow::types::{
    CreateWorkflowArtifactRequest, CreateWorkflowCheckpointRequest, CreateWorkflowEventRequest,
    CreateWorkflowRunRequest, CreateWorkflowStepRunRequest, WorkflowArtifactKind,
    WorkflowRunStatus, WorkflowStepType,
};
use uuid::Uuid;

async fn create_test_store(name: &str) -> McpStore {
    let db_path = std::env::temp_dir().join(format!("deeting-workflow-{name}-{}.db", Uuid::new_v4()));
    let database_url = format!("sqlite:{}", db_path.to_string_lossy().replace('\\', "/"));
    let store = McpStore::new(&database_url)
        .await
        .expect("create test workflow store");
    store.init().await.expect("init workflow test store");
    store
}

#[tokio::test]
async fn create_and_get_workflow_run_round_trips() {
    let store = create_test_store("create-run").await;
    let run = create_workflow_run(
        &store,
        CreateWorkflowRunRequest {
            title: "Test Run".to_string(),
            goal: "Test goal".to_string(),
            proposal_text: Some("# Workflow Proposal".to_string()),
        },
    )
    .await
    .expect("create workflow run");

    assert_eq!(run.title, "Test Run");
    assert_eq!(run.status, WorkflowRunStatus::Draft);
    assert_eq!(run.proposal_version, 0);
    assert!(run.proposal_text.is_some());

    let fetched = get_workflow_run(&store, &run.id)
        .await
        .expect("get workflow run")
        .expect("workflow run exists");
    assert_eq!(fetched.id, run.id);
    assert_eq!(fetched.goal, "Test goal");
}

#[tokio::test]
async fn workflow_run_status_update_persists() {
    let store = create_test_store("update-status").await;
    let run = create_workflow_run(
        &store,
        CreateWorkflowRunRequest {
            title: "Status Test".to_string(),
            goal: "Test status".to_string(),
            proposal_text: None,
        },
    )
    .await
    .expect("create workflow run");

    update_workflow_run_status(&store, &run.id, WorkflowRunStatus::Running)
        .await
        .expect("update workflow status");

    let fetched = get_workflow_run(&store, &run.id)
        .await
        .expect("get workflow run")
        .expect("workflow run exists");
    assert_eq!(fetched.status, WorkflowRunStatus::Running);
}

#[tokio::test]
async fn step_runs_are_ordered_by_phase_index() {
    let store = create_test_store("step-order").await;
    let run = create_workflow_run(
        &store,
        CreateWorkflowRunRequest {
            title: "Step Order".to_string(),
            goal: "Check ordering".to_string(),
            proposal_text: None,
        },
    )
    .await
    .expect("create workflow run");

    create_workflow_step_run(
        &store,
        CreateWorkflowStepRunRequest {
            run_id: run.id.clone(),
            phase_id: "phase-2".to_string(),
            phase_index: 2,
            step_type: WorkflowStepType::WorkerCall,
            title: "Step 2".to_string(),
            worker_ref: None,
            goal: None,
        },
    )
    .await
    .expect("create second step");

    create_workflow_step_run(
        &store,
        CreateWorkflowStepRunRequest {
            run_id: run.id.clone(),
            phase_id: "phase-1".to_string(),
            phase_index: 1,
            step_type: WorkflowStepType::WorkerCall,
            title: "Step 1".to_string(),
            worker_ref: None,
            goal: None,
        },
    )
    .await
    .expect("create first step");

    let steps = list_workflow_step_runs_by_run(&store, &run.id)
        .await
        .expect("list step runs");
    assert_eq!(steps.len(), 2);
    assert_eq!(steps[0].phase_index, 1);
    assert_eq!(steps[1].phase_index, 2);
}

#[tokio::test]
async fn workflow_events_append_and_list_in_order() {
    let store = create_test_store("events").await;
    let run = create_workflow_run(
        &store,
        CreateWorkflowRunRequest {
            title: "Event Test".to_string(),
            goal: "Track events".to_string(),
            proposal_text: None,
        },
    )
    .await
    .expect("create workflow run");

    create_workflow_event(
        &store,
        CreateWorkflowEventRequest {
            run_id: run.id.clone(),
            step_id: None,
            event_type: "run.created".to_string(),
            payload: None,
        },
    )
    .await
    .expect("create created event");

    create_workflow_event(
        &store,
        CreateWorkflowEventRequest {
            run_id: run.id.clone(),
            step_id: None,
            event_type: "run.started".to_string(),
            payload: Some(serde_json::json!({ "snapshot_version": 1 })),
        },
    )
    .await
    .expect("create started event");

    let events = list_workflow_events_by_run(&store, &run.id)
        .await
        .expect("list workflow events");
    assert_eq!(events.len(), 2);
    assert_eq!(events[0].event_type, "run.created");
    assert_eq!(events[1].event_type, "run.started");
}

#[tokio::test]
async fn active_checkpoint_can_be_resolved() {
    let store = create_test_store("checkpoint").await;
    let run = create_workflow_run(
        &store,
        CreateWorkflowRunRequest {
            title: "Checkpoint Test".to_string(),
            goal: "Track checkpoint".to_string(),
            proposal_text: None,
        },
    )
    .await
    .expect("create workflow run");

    let step = create_workflow_step_run(
        &store,
        CreateWorkflowStepRunRequest {
            run_id: run.id.clone(),
            phase_id: "phase-1".to_string(),
            phase_index: 1,
            step_type: WorkflowStepType::ApprovalGate,
            title: "Approval Step".to_string(),
            worker_ref: None,
            goal: None,
        },
    )
    .await
    .expect("create workflow step");

    let checkpoint = create_workflow_checkpoint(
        &store,
        CreateWorkflowCheckpointRequest {
            run_id: run.id.clone(),
            blocked_step_id: Some(step.id.clone()),
            reason: "waiting_approval".to_string(),
            approval_payload: None,
        },
    )
    .await
    .expect("create checkpoint");

    assert!(!checkpoint.resolved);

    let active = get_active_checkpoint_for_run(&store, &run.id)
        .await
        .expect("get active checkpoint");
    assert!(active.is_some());

    resolve_checkpoint(
        &store,
        &checkpoint.id,
        Some(&serde_json::json!({ "action": "approve" })),
    )
        .await
        .expect("resolve checkpoint");

    let active_after = get_active_checkpoint_for_run(&store, &run.id)
        .await
        .expect("get active checkpoint after resolve");
    assert!(active_after.is_none());
}

#[tokio::test]
async fn restart_preserves_workflow_run_rows() {
    let db_path =
        std::env::temp_dir().join(format!("deeting-workflow-restart-{}.db", Uuid::new_v4()));
    let database_url = format!("sqlite:{}", db_path.to_string_lossy().replace('\\', "/"));

    let store = McpStore::new(&database_url)
        .await
        .expect("create test workflow store");
    store.init().await.expect("init workflow test store");

    let run = create_workflow_run(
        &store,
        CreateWorkflowRunRequest {
            title: "Persist Test".to_string(),
            goal: "Survive restart".to_string(),
            proposal_text: None,
        },
    )
    .await
    .expect("create workflow run");

    let restarted = McpStore::new(&database_url)
        .await
        .expect("recreate workflow test store");
    restarted.init().await.expect("reinit workflow test store");
    ensure_schema(&restarted).await.expect("ensure workflow schema");

    let fetched = get_workflow_run(&restarted, &run.id)
        .await
        .expect("get workflow run after restart");
    assert!(fetched.is_some());
    assert_eq!(fetched.expect("workflow run").title, "Persist Test");
}

#[tokio::test]
async fn artifacts_create_and_list_by_run() {
    let store = create_test_store("artifacts").await;
    let run = create_workflow_run(
        &store,
        CreateWorkflowRunRequest {
            title: "Artifact Test".to_string(),
            goal: "Persist artifacts".to_string(),
            proposal_text: None,
        },
    )
    .await
    .expect("create workflow run");

    let artifact = create_workflow_artifact(
        &store,
        CreateWorkflowArtifactRequest {
            run_id: run.id.clone(),
            step_id: None,
            phase_id: Some("phase-1".to_string()),
            artifact_kind: WorkflowArtifactKind::JsonStructured,
            artifact_ref: Some("phase-1/result.json".to_string()),
            content: Some(r#"{"ok":true}"#.to_string()),
            metadata: Some(serde_json::json!({"schema":"test.v1"})),
        },
    )
    .await
    .expect("create workflow artifact");

    assert_eq!(artifact.phase_id.as_deref(), Some("phase-1"));

    let artifacts = list_workflow_artifacts_by_run(&store, &run.id)
        .await
        .expect("list workflow artifacts");
    assert_eq!(artifacts.len(), 1);
    assert_eq!(artifacts[0].artifact_ref.as_deref(), Some("phase-1/result.json"));
}

#[tokio::test]
async fn creating_step_run_for_missing_run_returns_not_found() {
    let store = create_test_store("missing-run-step").await;

    let error = create_workflow_step_run(
        &store,
        CreateWorkflowStepRunRequest {
            run_id: "missing-run".to_string(),
            phase_id: "phase-1".to_string(),
            phase_index: 1,
            step_type: WorkflowStepType::WorkerCall,
            title: "Orphan Step".to_string(),
            worker_ref: None,
            goal: None,
        },
    )
    .await
    .expect_err("missing run should fail");

    match error {
        crate::modules::mcp::error::McpError::NotFound(message) => {
            assert!(message.contains("workflow run"));
        }
        other => panic!("expected not found, got {other:?}"),
    }
}

#[tokio::test]
async fn checkpoint_blocked_step_must_belong_to_run() {
    let store = create_test_store("checkpoint-run-match").await;
    let run_a = create_workflow_run(
        &store,
        CreateWorkflowRunRequest {
            title: "Run A".to_string(),
            goal: "A".to_string(),
            proposal_text: None,
        },
    )
    .await
    .expect("create run a");
    let run_b = create_workflow_run(
        &store,
        CreateWorkflowRunRequest {
            title: "Run B".to_string(),
            goal: "B".to_string(),
            proposal_text: None,
        },
    )
    .await
    .expect("create run b");

    let step = create_workflow_step_run(
        &store,
        CreateWorkflowStepRunRequest {
            run_id: run_a.id.clone(),
            phase_id: "phase-1".to_string(),
            phase_index: 1,
            step_type: WorkflowStepType::ApprovalGate,
            title: "A Step".to_string(),
            worker_ref: None,
            goal: None,
        },
    )
    .await
    .expect("create run a step");

    let error = create_workflow_checkpoint(
        &store,
        CreateWorkflowCheckpointRequest {
            run_id: run_b.id.clone(),
            blocked_step_id: Some(step.id),
            reason: "waiting_approval".to_string(),
            approval_payload: None,
        },
    )
    .await
    .expect_err("mismatched checkpoint should fail");

    match error {
        crate::modules::mcp::error::McpError::NotFound(message) => {
            assert!(message.contains("workflow step"));
        }
        other => panic!("expected not found, got {other:?}"),
    }
}
