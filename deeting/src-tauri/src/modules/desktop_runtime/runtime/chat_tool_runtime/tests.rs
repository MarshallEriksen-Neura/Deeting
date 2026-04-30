use super::classify_local_tool_execution_error_code;
use super::*;
use crate::modules::desktop_runtime::runtime::LOCAL_TOOL_CALL_NOT_INSTALLED_OR_DISABLED_CODE;
use crate::modules::desktop_runtime::runtime::{
    build_default_local_execution_policy, build_local_tool_call_install_gate_error_meta,
};

#[test]
fn build_execution_contract_from_search_result_requires_capabilities() {
    let err = CapabilityExecutionContract::from_search_result(Some(&serde_json::json!({
        "recipes": [{"name": "Weather Skill"}]
    })))
    .expect_err("should require callable results");
    assert!(err.contains("capabilities"));
}

#[test]
fn last_response_content_or_empty_preserves_existing_assistant_text() {
    let content = last_response_content_or_empty(Some(&serde_json::json!({
        "content": "Existing assistant text."
    })));

    assert_eq!(content, serde_json::json!("Existing assistant text."));
}

#[test]
fn build_execution_contract_from_search_result_extracts_allowed_tools() {
    let contract = CapabilityExecutionContract::from_search_result(Some(&serde_json::json!({
        "capabilities": [
            {"name": "search_web", "invocation_mode": "direct", "status": {"callable": true}},
            {"name": "fetch_page", "invocation_mode": "direct", "status": {"callable": true}},
            {"name": "search_web", "invocation_mode": "direct", "status": {"callable": true}},
            {"name": "disabled_tool", "invocation_mode": "direct", "status": {"callable": false}},
            {"name": "execute_code_plan", "invocation_mode": "direct", "status": {"callable": true}}
        ]
    })))
    .expect("contract");
    assert_eq!(
        contract.allowed_tools,
        vec!["fetch_page".to_string(), "search_web".to_string()]
    );
}

#[test]
fn install_gate_error_meta_uses_stable_not_installed_code() {
    let meta = build_local_tool_call_install_gate_error_meta(
        Some("call-123"),
        "stock_quotes",
        "tool 'stock_quotes' is not installed or enabled in local desktop runtime",
    );
    assert_eq!(
        meta["error_code"],
        serde_json::json!(LOCAL_TOOL_CALL_NOT_INSTALLED_OR_DISABLED_CODE)
    );
    assert_eq!(meta["status"], serde_json::json!("error"));
    assert_eq!(meta["name"], serde_json::json!("stock_quotes"));
}

#[test]
fn classify_local_tool_execution_error_code_detects_mcp_timeout() {
    assert_eq!(
        classify_local_tool_execution_error_code("MCP tool 'firecrawl' timed out after 60s"),
        "MCP_TOOL_TIMEOUT"
    );
    assert_eq!(
        classify_local_tool_execution_error_code("stdio client transport closed"),
        "LOCAL_TOOL_EXECUTION_FAILED"
    );
}

#[test]
fn delegate_task_preflight_blocks_when_selected_agent_has_no_executable_surface() {
    let record = DelegatedExecutionRecord {
        execution_id: "exec-1".to_string(),
        kind: DelegatedExecutionKind::CustomTaskAgent,
        status: DelegatedExecutionStatus::Failed,
        target: DelegatedExecutionTarget {
            id: "agent-1".to_string(),
            name: "Guidance Only".to_string(),
            invocation_kind: Some("chat".to_string()),
            worker_ref: None,
            workflow_run_id: None,
        },
        selection: DelegatedExecutionSelection {
            explicit: false,
            score: Some(91),
            reason_codes: vec!["semantic_rank".to_string()],
            reason_text: Some("semantic_rank".to_string()),
            candidate_count: 3,
            selected_from_top_k: 1,
            callable_coverage_score: Some(0.0),
            modality_fit_score: Some(1.0),
            profile_prior_score: Some(0.0),
        },
        packet_receipt: None,
        available_actions: vec![DelegatedExecutionAction {
            kind: "reconfigure_agent".to_string(),
        }],
        children: vec![DelegatedExecutionChildRecord {
            id: "exec-1:preflight".to_string(),
            phase_id: Some("preflight".to_string()),
            step_type: Some("capability_check".to_string()),
            title: "Validate delegated capability surface".to_string(),
            status: "blocked".to_string(),
            worker_ref: Some("custom_task_agent:agent-1".to_string()),
            summary: Some("Delegation blocked before launch because the selected task agent has no executable tools or skill actions bound.".to_string()),
            error: Some("The selected task agent only has prompt or guidance context. Bind at least one executable MCP tool or callable skill action before using delegate_task.".to_string()),
            available_actions: vec![DelegatedExecutionAction {
                kind: "reconfigure_agent".to_string(),
            }],
        }],
        summary: Some("Delegation blocked before launch".to_string()),
        primary_output: Some(serde_json::json!({
            "status": "blocked",
            "reason": "missing_executable_surface",
            "guidance_skill_ids": ["skill.alpha"],
            "callable_mcp_tool_ids": [],
            "callable_skill_action_refs": []
        })),
        error: Some("delegate_task blocked: selected task agent has no executable surface".to_string()),
        started_at_ms: 1,
        completed_at_ms: Some(2),
    };

    let delegated_result = record.delegated_result();
    assert_eq!(
        delegated_result
            .get("status")
            .and_then(serde_json::Value::as_str),
        Some("blocked")
    );
    assert_eq!(
        delegated_result
            .get("primary_output")
            .and_then(|value| value.get("reason"))
            .and_then(serde_json::Value::as_str),
        Some("missing_executable_surface")
    );
}

#[test]
fn delegate_task_preflight_allows_empty_bound_surface_for_image_agent() {
    let record = DelegatedExecutionRecord {
        execution_id: "exec-image-1".to_string(),
        kind: DelegatedExecutionKind::CustomTaskAgent,
        status: DelegatedExecutionStatus::Succeeded,
        target: DelegatedExecutionTarget {
            id: "agent-image-1".to_string(),
            name: "Image Agent".to_string(),
            invocation_kind: Some("image_generation".to_string()),
            worker_ref: None,
            workflow_run_id: None,
        },
        selection: DelegatedExecutionSelection {
            explicit: true,
            score: Some(10000),
            reason_codes: vec!["explicit_task_agent".to_string()],
            reason_text: Some("explicit_task_agent".to_string()),
            candidate_count: 1,
            selected_from_top_k: 1,
            callable_coverage_score: Some(0.2),
            modality_fit_score: Some(1.0),
            profile_prior_score: Some(0.0),
        },
        packet_receipt: None,
        available_actions: Vec::new(),
        children: vec![DelegatedExecutionChildRecord {
            id: "exec-image-1:execution".to_string(),
            phase_id: Some("execution".to_string()),
            step_type: Some("custom_task_agent".to_string()),
            title: "Run delegated custom task agent".to_string(),
            status: "completed".to_string(),
            worker_ref: Some("custom_task_agent:agent-image-1".to_string()),
            summary: Some("Generated image successfully".to_string()),
            error: None,
            available_actions: Vec::new(),
        }],
        summary: Some("Generated image successfully".to_string()),
        primary_output: Some(serde_json::json!({
            "status": "completed",
            "agent_id": "agent-image-1",
            "agent_name": "Image Agent",
            "invocation_kind": "image_generation",
            "images": ["asset://image-1.png"],
            "callable_mcp_tool_ids": [],
            "guidance_skill_ids": [],
            "callable_skill_action_refs": []
        })),
        error: None,
        started_at_ms: 1,
        completed_at_ms: Some(2),
    };

    let delegated_result = record.delegated_result();
    assert_eq!(
        delegated_result
            .get("status")
            .and_then(serde_json::Value::as_str),
        Some("completed")
    );
    assert_eq!(
        delegated_result
            .get("primary_output")
            .and_then(|value| value.get("invocation_kind"))
            .and_then(serde_json::Value::as_str),
        Some("image_generation")
    );
    assert_eq!(
        delegated_result
            .get("primary_output")
            .and_then(|value| value.get("callable_mcp_tool_ids"))
            .and_then(serde_json::Value::as_array)
            .map(|items| items.len()),
        Some(0)
    );
}
#[test]
fn canonicalize_tool_name_for_allowed_list_accepts_underscore_variant() {
    let canonical = canonicalize_tool_name_for_allowed_list(
        "tavily_search",
        &["search_sdk".to_string(), "tavily-search".to_string()],
    );

    assert_eq!(canonical.as_deref(), Some("tavily-search"));
}

#[test]
fn structured_tool_replay_messages_use_family_gates_for_supported_protocols() {
    let response = serde_json::json!({
        "content": "",
        "tool_calls": [
            {
                "id": "call_123",
                "name": "search_sdk",
                "arguments": { "query": "tool replay" }
            }
        ]
    });
    let meta = vec![serde_json::json!({
        "id": "call_123",
        "name": "search_sdk",
        "status": "success",
        "result": { "ok": true }
    })];

    let openai_replay = build_structured_tool_replay_messages("openai_chat", &response, &meta)
        .expect("openai replay");
    assert_eq!(openai_replay.len(), 2);
    assert_eq!(openai_replay[0].role, "assistant");
    assert_eq!(openai_replay[0].tool_calls.len(), 1);
    assert_eq!(openai_replay[1].role, "tool");
    assert_eq!(openai_replay[1].tool_call_id.as_deref(), Some("call_123"));

    let anthropic_replay =
        build_structured_tool_replay_messages("anthropic_messages", &response, &meta)
            .expect("anthropic replay");
    assert_eq!(anthropic_replay.len(), 2);
    assert_eq!(anthropic_replay[1].role, "tool");

    let gemini_replay = build_structured_tool_replay_messages("google_gemini", &response, &meta)
        .expect("gemini replay");
    assert_eq!(gemini_replay.len(), 2);
    assert_eq!(gemini_replay[1].role, "tool");

    let responses_replay =
        build_structured_tool_replay_messages("openai_responses", &response, &meta)
            .expect("responses replay");
    assert_eq!(responses_replay.len(), 2);
    assert_eq!(responses_replay[0].role, "assistant");
    assert_eq!(
        responses_replay[1].tool_call_id.as_deref(),
        Some("call_123")
    );
}

#[test]
fn structured_tool_replay_messages_require_output_for_every_call() {
    let response = serde_json::json!({
        "content": "",
        "tool_calls": [
            {
                "id": "call_123",
                "name": "search_sdk",
                "arguments": { "query": "tool replay" }
            },
            {
                "id": "call_456",
                "name": "refresh_skill_index",
                "arguments": {}
            }
        ]
    });
    let meta = vec![serde_json::json!({
        "id": "call_123",
        "name": "search_sdk",
        "status": "success",
        "result": { "ok": true }
    })];

    assert!(build_structured_tool_replay_messages("openai_responses", &response, &meta).is_none());
}

#[test]
fn structured_tool_replay_messages_fall_back_to_execution_graph_when_meta_missing() {
    let response = serde_json::json!({
        "content": "",
        "tool_calls": [
            {
                "id": "call_123",
                "name": "search_sdk",
                "arguments": { "query": "tool replay" }
            }
        ],
        "execution_graph": {
            "schema_version": 1,
            "execution_id": "graph-exec-1",
            "session_id": "session-1",
            "route": "direct",
            "plane": "response_only",
            "request_id": null,
            "root_execution_id": null,
            "nodes": [
                {
                    "node_id": "tool_call:call_123",
                    "node_type": "tool_call",
                    "status": "success",
                    "dependency_ids": [],
                    "metadata": {
                        "call_id": "call_123",
                        "tool_name": "search_sdk"
                    },
                    "input_payload": null,
                    "output_payload": {
                        "structuredContent": {
                            "ok": true
                        }
                    }
                }
            ],
            "events": [],
            "metadata": {}
        }
    });

    let replay = build_structured_tool_replay_messages("openai_responses", &response, &[])
        .expect("graph replay");
    assert_eq!(replay.len(), 2);
    assert_eq!(replay[1].role, "tool");
    assert_eq!(replay[1].tool_call_id.as_deref(), Some("call_123"));
    assert!(replay[1].content.contains("\"structuredContent\""));
}

#[test]
fn enrich_response_with_tool_trace_includes_error_result_blocks() {
    let response = serde_json::json!({
        "content": ""
    });
    let meta = vec![
        serde_json::json!({
            "id": "call_search",
            "name": "search_sdk",
            "status": "success",
            "result": { "ok": true }
        }),
        serde_json::json!({
            "id": "call_crawler",
            "name": "skill.official.skills.crawler.fetch_web_content",
            "status": "error",
            "error_code": "LOCAL_TOOL_EXECUTION_FAILED",
            "error": "crawler failed"
        }),
    ];
    let metrics = RuntimeMetricsAccumulator::default();

    let enriched = enrich_response_with_tool_trace(response, &meta, true, &metrics);
    let blocks = enriched
        .get("tool_trace_blocks")
        .and_then(serde_json::Value::as_array)
        .expect("tool trace blocks should be present");

    assert!(blocks.iter().any(|block| {
        block.get("type").and_then(|v| v.as_str()) == Some("tool_result")
            && block.get("status").and_then(|v| v.as_str()) == Some("error")
            && block.get("toolName").and_then(|v| v.as_str())
                == Some("skill.official.skills.crawler.fetch_web_content")
            && block
                .get("result")
                .and_then(|v| v.get("error"))
                .and_then(|v| v.as_str())
                == Some("crawler failed")
    }));
    assert_eq!(
        enriched.get("tool_trace_streamed"),
        Some(&serde_json::json!(true))
    );
}

#[test]
fn enrich_response_with_tool_trace_falls_back_to_execution_graph_blocks() {
    let response = serde_json::json!({
        "content": "",
        "execution_graph": {
            "schema_version": 1,
            "execution_id": "graph-exec-1",
            "session_id": "session-1",
            "route": "direct",
            "plane": "response_only",
            "request_id": null,
            "root_execution_id": null,
            "nodes": [
                {
                    "node_id": "tool_call:call-1",
                    "node_type": "tool_call",
                    "status": "success",
                    "dependency_ids": [],
                    "metadata": {
                        "call_id": "call-1",
                        "tool_name": "search_sdk"
                    },
                    "input_payload": null,
                    "output_payload": {
                        "ok": true
                    }
                }
            ],
            "events": [],
            "metadata": {}
        }
    });
    let metrics = RuntimeMetricsAccumulator::default();

    let enriched = enrich_response_with_tool_trace(response, &[], false, &metrics);
    let blocks = enriched
        .get("tool_trace_blocks")
        .and_then(serde_json::Value::as_array)
        .expect("tool trace blocks should be present");

    assert_eq!(blocks.len(), 2);
    assert_eq!(blocks[0]["type"], serde_json::json!("tool_call"));
    assert_eq!(blocks[1]["type"], serde_json::json!("tool_result"));
    assert_eq!(blocks[1]["result"]["ok"], serde_json::json!(true));
}

#[test]
fn serialize_tool_replay_content_prefers_structured_content_only() {
    let item = serde_json::json!({
        "id": "call_tavily",
        "name": "tavily-search",
        "status": "success",
        "result": {
            "content": [
                { "type": "text", "text": "Detailed Results:" },
                { "type": "text", "text": "1. Example result body" }
            ],
            "structuredContent": {
                "results": [
                    { "title": "Example", "url": "https://example.com" }
                ]
            },
            "isError": false
        }
    });

    let serialized = serialize_tool_replay_content(&item);
    let reparsed: serde_json::Value =
        serde_json::from_str(&serialized).expect("structured tool replay should stay json");

    assert_eq!(reparsed, item["result"]["structuredContent"]);
}

#[test]
fn serialize_tool_replay_content_extracts_standard_mcp_text_content_without_structured_data() {
    let item = serde_json::json!({
        "id": "call_tavily",
        "name": "tavily-search",
        "status": "success",
        "result": {
            "content": [
                { "type": "text", "text": "Detailed Results:" },
                { "type": "text", "text": "1. Example result body" }
            ],
            "isError": false
        }
    });

    assert_eq!(
        serialize_tool_replay_content(&item),
        "Detailed Results:\n1. Example result body"
    );
}

#[test]
fn serialize_tool_replay_content_unwraps_nested_tool_result_envelopes() {
    let item = serde_json::json!({
        "id": "call_firecrawl",
        "name": "firecrawl_scrape",
        "status": "success",
        "result": {
            "type": "tool_result",
            "callId": "call_firecrawl",
            "toolName": "firecrawl_scrape",
            "status": "success",
            "result": {
                "type": "tool_result",
                "callId": "call_firecrawl",
                "toolName": "firecrawl_scrape",
                "status": "success",
                "result": {
                    "structuredContent": {
                        "markdown": "# EvoMap"
                    }
                }
            }
        }
    });

    let serialized = serialize_tool_replay_content(&item);
    let reparsed: serde_json::Value =
        serde_json::from_str(&serialized).expect("nested tool_result replay should stay json");

    assert_eq!(reparsed, serde_json::json!({ "markdown": "# EvoMap" }));
}

#[test]
fn build_tool_call_meta_from_execution_graph_unwraps_nested_tool_result_envelopes() {
    let execution_graph = serde_json::json!({
        "nodes": [
            {
                "node_id": "tool_call:call-firecrawl",
                "node_type": "tool_call",
                "status": "success",
                "metadata": {
                    "call_id": "call-firecrawl",
                    "tool_name": "firecrawl_scrape"
                },
                "output_payload": {
                    "type": "tool_result",
                    "callId": "call-firecrawl",
                    "toolName": "firecrawl_scrape",
                    "status": "success",
                    "result": {
                        "type": "tool_result",
                        "callId": "call-firecrawl",
                        "toolName": "firecrawl_scrape",
                        "status": "success",
                        "result": {
                            "structuredContent": {
                                "markdown": "# EvoMap"
                            }
                        }
                    }
                }
            }
        ]
    });

    let meta = build_tool_call_meta_from_execution_graph(&execution_graph);

    assert_eq!(meta.len(), 1);
    assert_eq!(meta[0]["id"], serde_json::json!("call-firecrawl"));
    assert_eq!(meta[0]["name"], serde_json::json!("firecrawl_scrape"));
    assert_eq!(
        meta[0]["result"],
        serde_json::json!({
            "structuredContent": {
                "markdown": "# EvoMap"
            }
        })
    );
}

#[test]
fn build_persisted_resume_assistant_blocks_keeps_tool_trace_and_final_text() {
    let response = serde_json::json!({
        "content": "Final answer after approval.",
        "tool_trace_blocks": [
            {
                "type": "tool_call",
                "callId": "call_123",
                "toolName": "firecrawl_search",
                "status": "success"
            },
            {
                "type": "tool_result",
                "callId": "call_123",
                "toolName": "firecrawl_search",
                "status": "success",
                "result": {
                    "structuredContent": {
                        "results": [{ "title": "Tianjin Weather" }]
                    }
                }
            }
        ]
    });

    let blocks = build_persisted_resume_assistant_blocks(&response);

    assert_eq!(blocks.len(), 3);
    assert_eq!(blocks[0]["type"], serde_json::json!("tool_call"));
    assert_eq!(blocks[1]["type"], serde_json::json!("tool_result"));
    assert_eq!(blocks[2]["type"], serde_json::json!("text"));
    assert_eq!(
        blocks[2]["content"],
        serde_json::json!("Final answer after approval.")
    );
}

#[test]
fn build_local_chat_resume_continuation_blocks_keeps_non_string_text_with_tool_trace() {
    let response = serde_json::json!({
        "content": [
            {
                "type": "output_text",
                "text": "Final answer after approval."
            }
        ],
        "tool_trace_blocks": [
            {
                "type": "tool_call",
                "callId": "call_123",
                "toolName": "firecrawl_search",
                "status": "success"
            },
            {
                "type": "tool_result",
                "callId": "call_123",
                "toolName": "firecrawl_search",
                "status": "success",
                "result": {
                    "structuredContent": {
                        "results": [{ "title": "Tianjin Weather" }]
                    }
                }
            }
        ]
    });

    let blocks = build_local_chat_resume_continuation_blocks(&response, &[]);

    assert_eq!(blocks.len(), 3);
    assert_eq!(blocks[0]["type"], serde_json::json!("tool_call"));
    assert_eq!(blocks[1]["type"], serde_json::json!("tool_result"));
    assert_eq!(blocks[2]["type"], serde_json::json!("text"));
    assert_eq!(
        blocks[2]["content"],
        serde_json::json!("Final answer after approval.")
    );
}

#[test]
fn build_persisted_resume_assistant_meta_carries_runtime_metadata() {
    let response = serde_json::json!({
        "content": "Resumed after approval.",
        "tool_trace_blocks": [],
        "execution_graph": {
            "execution_id": "graph-exec-1"
        },
        "runtime_metrics": {
            "upstream_latency_ms": 1200,
            "upstream_calls": 2
        }
    });
    let model_connection = LocalModelConnection {
        model_id: "deeting-os".to_string(),
        provider_model_id: "deepseek-v3.1".to_string(),
        logical_model_key: Some("deeting-os".to_string()),
        protocol_family: "openai_chat".to_string(),
    };

    let meta = build_persisted_resume_assistant_meta(&response, &model_connection);

    assert_eq!(meta["model_id"], serde_json::json!("deeting-os"));
    assert_eq!(
        meta["provider_model_id"],
        serde_json::json!("deepseek-v3.1")
    );
    assert_eq!(
        meta["runtime_metrics"]["upstream_latency_ms"],
        serde_json::json!(1200)
    );
    assert_eq!(
        meta["execution_graph"]["execution_id"],
        serde_json::json!("graph-exec-1")
    );
    assert_eq!(
        meta["blocks"][0]["content"],
        serde_json::json!("Resumed after approval.")
    );
}

#[test]
fn build_persisted_resume_assistant_blocks_falls_back_to_execution_graph_blocks() {
    let response = serde_json::json!({
        "content": "",
        "execution_graph": {
            "schema_version": 1,
            "execution_id": "graph-exec-1",
            "session_id": "session-1",
            "route": "direct",
            "plane": "response_only",
            "request_id": null,
            "root_execution_id": null,
            "nodes": [
                {
                    "node_id": "tool_call:call-1",
                    "node_type": "tool_call",
                    "status": "waiting_approval",
                    "dependency_ids": [],
                    "metadata": {
                        "call_id": "call-1",
                        "tool_name": "browser_open_tab"
                    },
                    "input_payload": null,
                    "output_payload": {
                        "status": "REQUIRES_APPROVAL",
                        "approval_token": "approval-1"
                    }
                }
            ],
            "events": [],
            "metadata": {}
        }
    });

    let blocks = build_persisted_resume_assistant_blocks(&response);

    assert_eq!(blocks.len(), 2);
    assert_eq!(blocks[0]["type"], serde_json::json!("tool_call"));
    assert_eq!(blocks[1]["type"], serde_json::json!("tool_result"));
    assert_eq!(
        blocks[1]["result"]["approval_token"],
        serde_json::json!("approval-1")
    );
}

#[test]
fn canonicalize_tool_call_meta_via_graph_assigns_stable_ids_when_missing() {
    let execution_policy = mcp_runtime::policy::build_default_local_execution_policy();
    let response = serde_json::json!({
        "content": "pending approval"
    });
    let tool_call_meta = vec![
        serde_json::json!({
            "name": "search_notes",
            "status": "requires_approval",
            "result": {
                "status": "REQUIRES_APPROVAL",
                "approval_token": "approval-a"
            }
        }),
        serde_json::json!({
            "name": "search_notes",
            "status": "requires_approval",
            "result": {
                "status": "REQUIRES_APPROVAL",
                "approval_token": "approval-b"
            }
        }),
    ];

    let canonical = canonicalize_tool_call_meta_via_graph(
        "session-canonical-missing-id",
        &execution_policy,
        &response,
        &tool_call_meta,
    );

    assert_eq!(canonical.len(), 2);
    assert_eq!(
        canonical[0]["id"],
        serde_json::json!("approval-token:approval-a")
    );
    assert_eq!(
        canonical[1]["id"],
        serde_json::json!("approval-token:approval-b")
    );
    assert_eq!(
        derive_pending_call_id_from_tool_call_meta(&canonical),
        "approval-token:approval-b"
    );
}

#[test]
fn strip_stale_resume_response_metadata_removes_old_graph_and_trace_blocks() {
    let response = serde_json::json!({
        "content": "pending",
        "execution_graph": { "execution_id": "graph-old" },
        "tool_trace_blocks": [{ "type": "text", "content": "old" }],
        "tool_trace_streamed": true,
    });

    let stripped = strip_stale_resume_response_metadata(response);

    assert_eq!(stripped.get("content"), Some(&serde_json::json!("pending")));
    assert!(stripped.get("execution_graph").is_none());
    assert!(stripped.get("tool_trace_blocks").is_none());
    assert!(stripped.get("tool_trace_streamed").is_none());
}

#[test]
fn attach_execution_graph_to_response_force_rebuild_replaces_stale_graph() {
    let execution_policy = mcp_runtime::policy::build_default_local_execution_policy();
    let mut response = serde_json::json!({
        "content": "final answer",
        "execution_graph": {
            "execution_id": "graph-stale",
            "nodes": [
                { "node_id": "approval_gate:call-1", "node_type": "approval_gate", "status": "waiting_approval" }
            ]
        },
        "tool_trace_blocks": [
            { "type": "text", "content": "final answer" }
        ]
    });

    attach_execution_graph_to_response(
        &mut response,
        "session-1",
        &execution_policy,
        Some("root-1"),
        true,
    );

    assert_ne!(
        response
            .get("execution_graph")
            .and_then(|value| value.get("execution_id"))
            .and_then(serde_json::Value::as_str),
        Some("graph-stale")
    );
}

#[test]
fn build_max_rounds_exceeded_response_appends_visible_notice() {
    let state = LocalChatToolRuntimeState {
        max_rounds: 10,
        round: 10,
        trace_id: "trace-max-rounds-1".to_string(),
        request_id: None,
        execution_policy: mcp_runtime::policy::build_default_local_execution_policy(),
        model_connection: LocalModelConnection {
            model_id: "deeting-os".to_string(),
            provider_model_id: "deepseek-v3.1".to_string(),
            logical_model_key: Some("deeting-os".to_string()),
            protocol_family: "openai_chat".to_string(),
        },
        orchestrated_messages: Vec::new(),
        task_query: None,
        session_id: "session-max-rounds-1".to_string(),
        temperature: None,
        max_tokens: None,
        reasoning_enabled: None,
        reasoning_effort: None,
        active_capability: None,
        active_skill_context: None,
        runtime_metrics: RuntimeMetricsAccumulator::default(),
        diting_think_consumed: false,
        captured_reasoning: None,
        last_capability_snapshot: None,
        last_response: Some(serde_json::json!({
            "content": "Shell step finished.",
            "tool_calls": [
                {
                    "id": "call-shell-1",
                    "name": "shell_execute",
                    "arguments": {"command": "pwd"}
                }
            ]
        })),
        realtime_emitter: LocalRealtimeToolTraceEmitter::new(
            None,
            Some("trace-max-rounds-1"),
            None,
        ),
    };

    let response = build_max_rounds_exceeded_response(&state);
    let content = response
        .get("content")
        .and_then(serde_json::Value::as_str)
        .expect("content");

    assert!(content.contains("Shell step finished."));
    assert!(content.contains("10/10"));
    assert_eq!(
        response
            .get("error_code")
            .and_then(serde_json::Value::as_str),
        Some("LOCAL_CHAT_MAX_ROUNDS_EXCEEDED")
    );
    assert_eq!(
        response
            .get("stop_reason")
            .and_then(serde_json::Value::as_str),
        Some("max_agentic_rounds_exceeded")
    );
}

#[test]
fn resolve_child_agent_max_rounds_inherits_and_caps_to_runtime_budget() {
    assert_eq!(
        resolve_child_agent_max_rounds(&serde_json::json!({}), 150),
        150
    );
    assert_eq!(
        resolve_child_agent_max_rounds(&serde_json::json!({ "max_rounds": 50 }), 150),
        50
    );
    assert_eq!(
        resolve_child_agent_max_rounds(&serde_json::json!({ "max_rounds": 500 }), 150),
        150
    );
    assert_eq!(
        resolve_child_agent_max_rounds(&serde_json::json!({ "max_rounds": 0 }), 150),
        1
    );
}

#[test]
fn rewind_round_for_post_approval_continuation_does_not_consume_user_round_budget() {
    let mut state = LocalChatToolRuntimeState {
        max_rounds: 10,
        round: 4,
        trace_id: "trace-approval-round-1".to_string(),
        request_id: None,
        execution_policy: mcp_runtime::policy::build_default_local_execution_policy(),
        model_connection: LocalModelConnection {
            model_id: "deeting-os".to_string(),
            provider_model_id: "deepseek-v3.1".to_string(),
            logical_model_key: Some("deeting-os".to_string()),
            protocol_family: "openai_chat".to_string(),
        },
        orchestrated_messages: Vec::new(),
        task_query: None,
        session_id: "session-approval-round-1".to_string(),
        temperature: None,
        max_tokens: None,
        reasoning_enabled: None,
        reasoning_effort: None,
        active_capability: None,
        active_skill_context: None,
        runtime_metrics: RuntimeMetricsAccumulator::default(),
        diting_think_consumed: false,
        captured_reasoning: None,
        last_capability_snapshot: None,
        last_response: None,
        realtime_emitter: LocalRealtimeToolTraceEmitter::new(
            None,
            Some("trace-approval-round-1"),
            None,
        ),
    };

    rewind_round_for_post_approval_continuation(&mut state);
    assert_eq!(state.round, 3);

    rewind_round_for_post_approval_continuation(&mut state);
    rewind_round_for_post_approval_continuation(&mut state);
    rewind_round_for_post_approval_continuation(&mut state);
    assert_eq!(state.round, 0);
}

#[test]
fn resolve_local_tool_call_id_synthesizes_stable_missing_id() {
    assert_eq!(
        resolve_local_tool_call_id(None, "search_notes", 2, 1),
        "local-missing-call:r2:i1:search_notes"
    );
    assert_eq!(
        resolve_local_tool_call_id(Some(" call-explicit-1 "), "search_notes", 2, 1),
        "call-explicit-1"
    );
}

#[test]
fn apply_rejected_tool_result_updates_graph_without_runtime_shell() {
    let mut execution_graph = serde_json::json!({
        "execution_id": "graph-reject-1",
        "nodes": [
            {
                "node_id": "approval_gate:call-1",
                "node_type": "approval_gate",
                "status": "waiting_approval",
                "dependency_ids": [],
                "metadata": { "approval_token": "approval-1" },
                "input_payload": null,
                "output_payload": null
            },
            {
                "node_id": "tool_call:call-1",
                "node_type": "tool_call",
                "status": "waiting_approval",
                "dependency_ids": [],
                "metadata": { "call_id": "call-1" },
                "input_payload": null,
                "output_payload": null
            },
            {
                "node_id": "finalize:call-1",
                "node_type": "finalize",
                "status": "pending",
                "dependency_ids": [],
                "metadata": {},
                "input_payload": null,
                "output_payload": null
            }
        ],
        "events": []
    });

    apply_rejected_tool_result_to_execution_graph_value(
        &mut execution_graph,
        Some("graph-reject-1"),
        None,
        "User rejected tool execution",
    );

    let nodes = execution_graph
        .get("nodes")
        .and_then(serde_json::Value::as_array)
        .expect("nodes");
    assert_eq!(
        nodes[0].get("status").and_then(serde_json::Value::as_str),
        Some("rejected")
    );
    assert_eq!(
        nodes[1].get("status").and_then(serde_json::Value::as_str),
        Some("cancelled")
    );
    assert_eq!(
        nodes[2].get("status").and_then(serde_json::Value::as_str),
        Some("success")
    );
    let events = execution_graph
        .get("events")
        .and_then(serde_json::Value::as_array)
        .expect("events");
    assert!(events.iter().any(|event| {
        event.get("event_type").and_then(serde_json::Value::as_str)
            == Some("approval_gate.rejected")
    }));
    assert!(events.iter().any(|event| {
        event.get("event_type").and_then(serde_json::Value::as_str) == Some("tool_call.rejected")
    }));
}

#[test]
fn suspended_execution_keeps_remaining_pending_approvals_after_one_is_approved() {
    let mut suspended = SuspendedChatToolExecution {
        max_rounds: 4,
        round: 1,
        trace_id: "trace-pending-approval-sync-1".to_string(),
        request_id: None,
        execution_policy: mcp_runtime::policy::build_default_local_execution_policy(),
        model_connection: LocalModelConnection {
            model_id: "deeting-os".to_string(),
            provider_model_id: "deepseek-v3.1".to_string(),
            logical_model_key: Some("deeting-os".to_string()),
            protocol_family: "openai_chat".to_string(),
        },
        orchestrated_messages: Vec::new(),
        task_query: None,
        session_id: "session-pending-approval-sync-1".to_string(),
        temperature: None,
        max_tokens: None,
        reasoning_enabled: None,
        reasoning_effort: None,
        active_capability: None,
        active_skill_context: None,
        runtime_metrics: RuntimeMetricsAccumulator::default(),
        last_capability_snapshot: None,
        last_response: None,
        pending_approvals: vec![
            PersistedPendingApproval {
                approval_token: "approval-1".to_string(),
                tool_id: Some("tool-1".to_string()),
                tool_name: "shell_execute".to_string(),
                arguments: serde_json::json!({ "command": "echo 1" }),
                call_id: Some("call-1".to_string()),
                execution_token: Some("exec-1".to_string()),
                session_id: Some("session-pending-approval-sync-1".to_string()),
                description: Some("run first command".to_string()),
                risk_level: Some("MEDIUM".to_string()),
                risk_reasons: vec!["writes to stdout".to_string()],
                tool_fingerprint: "fingerprint-1".to_string(),
                policy_rule_key: Some("policy-1".to_string()),
                approval_grant_key: None,
                execution_graph_execution_id: Some("graph-pending-approval-sync-1".to_string()),
                execution_graph_gate_node_id: Some("approval_gate:call-1".to_string()),
                execution_graph_tool_node_id: Some("tool_call:call-1".to_string()),
                approval_status: Some("approved".to_string()),
                created_at_unix_ms: 1,
                expires_at_unix_ms: 2,
            },
            PersistedPendingApproval {
                approval_token: "approval-2".to_string(),
                tool_id: Some("tool-2".to_string()),
                tool_name: "shell_execute".to_string(),
                arguments: serde_json::json!({ "command": "echo 2" }),
                call_id: Some("call-2".to_string()),
                execution_token: Some("exec-2".to_string()),
                session_id: Some("session-pending-approval-sync-1".to_string()),
                description: Some("run second command".to_string()),
                risk_level: Some("MEDIUM".to_string()),
                risk_reasons: vec!["writes to stdout".to_string()],
                tool_fingerprint: "fingerprint-2".to_string(),
                policy_rule_key: Some("policy-2".to_string()),
                approval_grant_key: None,
                execution_graph_execution_id: Some("graph-pending-approval-sync-1".to_string()),
                execution_graph_gate_node_id: Some("approval_gate:call-2".to_string()),
                execution_graph_tool_node_id: Some("tool_call:call-2".to_string()),
                approval_status: Some("waiting_approval".to_string()),
                created_at_unix_ms: 1,
                expires_at_unix_ms: 2,
            },
        ],
        execution_graph: serde_json::json!({
            "execution_id": "graph-pending-approval-sync-1",
            "nodes": [
                {
                    "node_id": "approval_gate:call-1",
                    "node_type": "approval_gate",
                    "status": "success",
                    "dependency_ids": [],
                    "metadata": { "approval_token": "approval-1", "call_id": "call-1" },
                    "input_payload": null,
                    "output_payload": { "ok": true }
                },
                {
                    "node_id": "tool_call:call-1",
                    "node_type": "tool_call",
                    "status": "success",
                    "dependency_ids": [],
                    "metadata": { "call_id": "call-1", "tool_name": "shell_execute" },
                    "input_payload": null,
                    "output_payload": { "ok": true }
                },
                {
                    "node_id": "approval_gate:call-2",
                    "node_type": "approval_gate",
                    "status": "waiting_approval",
                    "dependency_ids": [],
                    "metadata": { "approval_token": "approval-2", "call_id": "call-2" },
                    "input_payload": null,
                    "output_payload": { "status": "REQUIRES_APPROVAL", "approval_token": "approval-2" }
                },
                {
                    "node_id": "tool_call:call-2",
                    "node_type": "tool_call",
                    "status": "waiting_approval",
                    "dependency_ids": [],
                    "metadata": { "call_id": "call-2", "tool_name": "shell_execute" },
                    "input_payload": null,
                    "output_payload": { "status": "REQUIRES_APPROVAL", "approval_token": "approval-2" }
                },
                {
                    "node_id": "finalize:call-2",
                    "node_type": "finalize",
                    "status": "pending",
                    "dependency_ids": [],
                    "metadata": {},
                    "input_payload": null,
                    "output_payload": null
                }
            ],
            "events": []
        }),
    };

    let remaining_call_ids = suspended.sync_remaining_pending_approvals("approval-1");

    assert_eq!(remaining_call_ids, vec!["call-2".to_string()]);
    assert_eq!(suspended.pending_approvals.len(), 1);
    assert_eq!(suspended.pending_approvals[0].approval_token, "approval-2");
    assert_eq!(suspended.pending_call_id(), "call-2");
    assert_eq!(suspended.pending_gate_node_id(), "approval_gate:call-2");
}

#[test]
fn sync_remaining_pending_approvals_prefers_token_bound_graph_identity() {
    let mut suspended = SuspendedChatToolExecution {
        max_rounds: 4,
        round: 1,
        trace_id: "trace-token-bound-1".to_string(),
        request_id: None,
        execution_policy: build_default_local_execution_policy(),
        model_connection: LocalModelConnection {
            model_id: "deeting-os".to_string(),
            provider_model_id: "deeting-os".to_string(),
            logical_model_key: None,
            protocol_family: "openai_chat".to_string(),
        },
        orchestrated_messages: Vec::new(),
        task_query: None,
        session_id: "session-token-bound-1".to_string(),
        temperature: None,
        max_tokens: None,
        reasoning_enabled: None,
        reasoning_effort: None,
        active_capability: None,
        active_skill_context: None,
        runtime_metrics: RuntimeMetricsAccumulator::default(),
        last_capability_snapshot: None,
        last_response: None,
        pending_approvals: vec![
            PersistedPendingApproval {
                approval_token: "approval-1".to_string(),
                tool_id: Some("tool-1".to_string()),
                tool_name: "shell_execute".to_string(),
                arguments: serde_json::json!({ "command": "echo 1" }),
                call_id: Some("call-da3d".to_string()),
                execution_token: Some("exec-1".to_string()),
                session_id: Some("session-token-bound-1".to_string()),
                description: Some("run approved command".to_string()),
                risk_level: Some("MEDIUM".to_string()),
                risk_reasons: vec!["writes to stdout".to_string()],
                tool_fingerprint: "fingerprint-1".to_string(),
                policy_rule_key: Some("policy-1".to_string()),
                approval_grant_key: None,
                execution_graph_execution_id: Some("graph-token-bound-1".to_string()),
                execution_graph_gate_node_id: Some("approval_gate:call-33".to_string()),
                execution_graph_tool_node_id: Some("tool_call:call-33".to_string()),
                approval_status: Some("waiting_approval".to_string()),
                created_at_unix_ms: 1,
                expires_at_unix_ms: 2,
            },
            PersistedPendingApproval {
                approval_token: "approval-2".to_string(),
                tool_id: Some("tool-2".to_string()),
                tool_name: "shell_execute".to_string(),
                arguments: serde_json::json!({ "command": "echo 2" }),
                call_id: Some("call-next".to_string()),
                execution_token: Some("exec-2".to_string()),
                session_id: Some("session-token-bound-1".to_string()),
                description: Some("run next command".to_string()),
                risk_level: Some("MEDIUM".to_string()),
                risk_reasons: vec!["writes to stdout".to_string()],
                tool_fingerprint: "fingerprint-2".to_string(),
                policy_rule_key: Some("policy-2".to_string()),
                approval_grant_key: None,
                execution_graph_execution_id: Some("graph-token-bound-1".to_string()),
                execution_graph_gate_node_id: Some("approval_gate:call-next".to_string()),
                execution_graph_tool_node_id: Some("tool_call:call-next".to_string()),
                approval_status: Some("waiting_approval".to_string()),
                created_at_unix_ms: 1,
                expires_at_unix_ms: 2,
            },
        ],
        execution_graph: serde_json::json!({
            "execution_id": "graph-token-bound-1",
            "nodes": [
                {
                    "node_id": "approval_gate:call-33",
                    "node_type": "approval_gate",
                    "status": "waiting_approval",
                    "dependency_ids": [],
                    "metadata": { "approval_token": "approval-1", "call_id": "call-33" },
                    "input_payload": null,
                    "output_payload": { "status": "REQUIRES_APPROVAL", "approval_token": "approval-1" }
                },
                {
                    "node_id": "tool_call:call-33",
                    "node_type": "tool_call",
                    "status": "waiting_approval",
                    "dependency_ids": [],
                    "metadata": { "call_id": "call-33", "tool_name": "shell_execute" },
                    "input_payload": null,
                    "output_payload": { "status": "REQUIRES_APPROVAL", "approval_token": "approval-1" }
                },
                {
                    "node_id": "approval_gate:call-next",
                    "node_type": "approval_gate",
                    "status": "waiting_approval",
                    "dependency_ids": [],
                    "metadata": { "approval_token": "approval-2", "call_id": "call-next" },
                    "input_payload": null,
                    "output_payload": { "status": "REQUIRES_APPROVAL", "approval_token": "approval-2" }
                },
                {
                    "node_id": "tool_call:call-next",
                    "node_type": "tool_call",
                    "status": "waiting_approval",
                    "dependency_ids": [],
                    "metadata": { "call_id": "call-next", "tool_name": "shell_execute" },
                    "input_payload": null,
                    "output_payload": { "status": "REQUIRES_APPROVAL", "approval_token": "approval-2" }
                },
                {
                    "node_id": "finalize:call-next",
                    "node_type": "finalize",
                    "status": "pending",
                    "dependency_ids": [],
                    "metadata": {},
                    "input_payload": null,
                    "output_payload": null
                }
            ],
            "events": []
        }),
    };

    mark_approval_gate_approving(&mut suspended, Some("approval-1"), Some("call-da3d"));
    apply_approved_tool_result_to_execution_graph(
        &mut suspended,
        Some("approval-1"),
        Some("call-da3d"),
        &serde_json::json!({ "ok": true }),
    );

    let nodes = suspended
        .execution_graph
        .get("nodes")
        .and_then(serde_json::Value::as_array)
        .expect("nodes");

    let approved_gate = nodes
        .iter()
        .find(|node| {
            node.get("node_id").and_then(serde_json::Value::as_str) == Some("approval_gate:call-33")
        })
        .expect("approved gate");
    let next_gate = nodes
        .iter()
        .find(|node| {
            node.get("node_id").and_then(serde_json::Value::as_str)
                == Some("approval_gate:call-next")
        })
        .expect("next gate");

    assert_eq!(
        approved_gate
            .get("status")
            .and_then(serde_json::Value::as_str),
        Some("approved")
    );
    assert_eq!(
        next_gate.get("status").and_then(serde_json::Value::as_str),
        Some("waiting_approval")
    );
}

#[test]
fn serialize_inflight_runtime_context_round_trips_waiting_approval_state() {
    let value = serialize_inflight_runtime_context(
        InFlightExecutionStage::WaitingApproval,
        Some("approval_gate:call-1".to_string()),
        Some("call-1".to_string()),
        None,
        true,
        vec![PersistedPendingApproval {
            approval_token: "approval-1".to_string(),
            tool_id: Some("tool-1".to_string()),
            tool_name: "browser_open_tab".to_string(),
            arguments: serde_json::json!({ "url": "https://example.com" }),
            call_id: Some("call-1".to_string()),
            execution_token: Some("exec-1".to_string()),
            session_id: Some("session-1".to_string()),
            description: Some("open a tab".to_string()),
            risk_level: Some("MEDIUM".to_string()),
            risk_reasons: vec!["navigates public internet".to_string()],
            tool_fingerprint: "fingerprint-1".to_string(),
            policy_rule_key: Some("policy-1".to_string()),
            approval_grant_key: None,
            execution_graph_execution_id: Some("graph-1".to_string()),
            execution_graph_gate_node_id: Some("approval_gate:call-1".to_string()),
            execution_graph_tool_node_id: Some("tool_call:call-1".to_string()),
            approval_status: Some("waiting_approval".to_string()),
            created_at_unix_ms: 1,
            expires_at_unix_ms: 2,
        }],
        None,
        "session-1",
        "trace-1",
        Some("request-1"),
        Some("graph-1"),
        None,
    );

    let parsed = persistable_inflight_context_from_value(&value).expect("parse inflight context");
    assert_eq!(parsed.stage, InFlightExecutionStage::WaitingApproval);
    assert_eq!(
        parsed.execution_graph_execution_id.as_deref(),
        Some("graph-1")
    );
    assert_eq!(parsed.pending_approvals.len(), 1);
    assert_eq!(
        parsed.pending_approvals[0].approval_token.as_str(),
        "approval-1"
    );
    assert!(parsed.last_error.is_none());
}

#[test]
fn serialize_inflight_runtime_context_round_trips_resume_failed_state() {
    let value = serialize_inflight_runtime_context(
        InFlightExecutionStage::ResumeFailed,
        Some("approval_gate:call-2".to_string()),
        Some("call-2".to_string()),
        None,
        true,
        Vec::new(),
        None,
        "session-2",
        "trace-2",
        Some("request-2"),
        Some("graph-2"),
        Some("resume continuation failed"),
    );

    let parsed = persistable_inflight_context_from_value(&value).expect("parse inflight context");
    assert_eq!(parsed.stage, InFlightExecutionStage::ResumeFailed);
    assert_eq!(
        parsed.execution_graph_execution_id.as_deref(),
        Some("graph-2")
    );
    assert_eq!(
        parsed.last_error.as_deref(),
        Some("resume continuation failed")
    );
}
