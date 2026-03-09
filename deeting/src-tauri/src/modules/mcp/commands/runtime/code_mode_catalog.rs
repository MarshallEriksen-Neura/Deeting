use super::super::support::*;
use super::search_ranking::lexical_rank_asset_hits;

pub(crate) fn build_local_code_mode_entry_tools() -> serde_json::Value {
    serde_json::json!({
        "tools": [
            {
                "type": "function",
                "function": {
                    "name": "search_sdk",
                    "description": "Search Deeting SDK capabilities by intent and return typed signatures, parameter docs, and python stubs. Use before execute_code_plan. Prefer calling tools by generated stubs or `deeting.call_tool(name, **kwargs)`.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": { "type": "string", "description": "Natural language intent to search tools." },
                            "limit": { "type": "integer", "description": "Max items to return (1-20).", "default": 8 },
                            "include_schema": { "type": "boolean", "description": "Whether to include full JSON schema.", "default": false }
                        },
                        "required": ["query"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "consult_expert_network",
                    "description": "Search expert assistants by intent query and return top candidates. This tool only searches and does not switch persona context by itself.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "intent_query": { "type": "string", "description": "The intent or task description to search for expert assistants." },
                            "k": { "type": "integer", "description": "Number of candidates to return.", "default": 3 },
                            "confidence": { "type": "number", "description": "Model confidence in the routing decision (0-1).", "default": 0 }
                        },
                        "required": ["intent_query", "confidence"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "activate_assistant",
                    "description": "Activate an assistant explicitly for the current request-scoped agent loop. This switches persona context only after an explicit activation call.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "assistant_id": { "type": "string", "description": "Assistant id returned by consult_expert_network." },
                            "reason": { "type": "string", "description": "Optional reason for the activation decision." }
                        },
                        "required": ["assistant_id"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "deactivate_assistant",
                    "description": "Deactivate the current request-scoped assistant and return to the default base assistant context.",
                    "parameters": { "type": "object", "properties": { "reason": { "type": "string", "description": "Optional reason for the deactivation." } } }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "execute_code_plan",
                    "description": "Execute a Python code plan in sandbox. Runtime exposes `deeting.log()`, `deeting.section()`, and `deeting.call_tool()`. SDK tool stubs are auto-injected based on your code: use `from deeting_sdk import <tool_name>` directly without calling search_sdk first (search_sdk is optional for discovery). Important: call tools with keyword args (`deeting.call_tool('tool-name', query='...')`), not positional dict args. Generate one coherent script, and always emit final structured output via `deeting.log(json.dumps(result, ensure_ascii=False))` instead of relying on top-level `return`.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "code": { "type": "string", "description": "Python code to execute." },
                            "session_id": { "type": "string", "description": "Optional explicit session ID." },
                            "language": { "type": "string", "description": "Execution language. Only python is supported.", "default": "python" },
                            "execution_timeout": { "type": "integer", "description": "Execution timeout hint in seconds.", "default": 30 },
                            "dry_run": { "type": "boolean", "description": "Only validate code and return plan metadata without executing.", "default": false }
                        },
                        "required": ["code"]
                    }
                }
            }
        ]
    })
}

pub(crate) async fn build_local_sdk_search_result(
    app_state: &AppState,
    query: &str,
) -> serde_json::Value {
    build_local_sdk_search_result_with_runtime(
        app_state.mcp.store.as_ref(),
        &app_state.providers.embedding,
        app_state.memory.service.as_ref(),
        query,
    )
    .await
}

pub(crate) async fn build_local_sdk_search_result_with_runtime(
    mcp_store: &crate::modules::mcp::store::McpStore,
    embedding_service: &crate::modules::providers::embedding::EmbeddingService,
    memory_store: &crate::modules::memory::service::MemoryService,
    query: &str,
) -> serde_json::Value {
    let normalized = query.trim().to_lowercase();
    let enabled_assistant_ids = mcp_store
        .list_enabled_local_assistant_ids()
        .await
        .unwrap_or_else(|_| HashSet::new());
    let enabled_skill_ids = mcp_store
        .list_enabled_local_skill_ids()
        .await
        .unwrap_or_else(|_| HashSet::new());
    let mut install_hints = Vec::new();
    let mut assistant_install_filtered_count = 0usize;
    let mut skill_install_filtered_count = 0usize;
    let mut catalog = vec![
        serde_json::json!({"name":"execute_code_plan","description":"Execute python code in local sandbox and bridge (auto mode requires dry_run=true for safety)","source":"code_mode_core","parameters":{"code":"string(required)","language":"string(optional, default=python)","execution_timeout":"number(optional)","dry_run":"boolean(optional)"}}),
        serde_json::json!({"name":"search_sdk","description":"Search tool signatures in local desktop runtime","source":"code_mode_core","parameters":{"query":"string(optional)"}}),
        serde_json::json!({"name":"sys_submit_onboarding_request","description":"Deeting platform: install skills or assistants. For skill installation use asset_type='skill' and payload {repo_url, skill_name}. Skills are cloned to $APP_DATA_DIR/skills/<skill_id>/ and must contain deeting.json + llm-tool.yaml + main.py (NOT SKILL.md). Do NOT use opencode, codex, or openclaw paths.","source":"code_mode_core","parameters":{"asset_type":"string(required, oneof=assistant|skill)","payload":"object(required)"}}),
    ];
    if !normalized.is_empty() {
        let mut asset_hits = Vec::new();
        if let Ok(vector) = embedding_service.embed_text(&normalized).await {
            if let Ok(hits) = memory_store.search_assets(vector, 15, None).await {
                asset_hits = hits;
            }
        }
        if asset_hits.is_empty() {
            if let Ok(all_assets) = memory_store.list_assets_catalog().await {
                asset_hits = lexical_rank_asset_hits(&normalized, all_assets, 15);
            }
        }
        for hit in asset_hits {
            let source_type = hit
                .get("source_type")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            let asset_type = hit
                .get("asset_type")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            let name = hit["name"].as_str().unwrap_or("").to_string();
            let desc = hit["description"].as_str().unwrap_or("").to_string();
            let pkg_name = hit.get("pkg_name").and_then(|v| v.as_str());
            let asset_id = hit["id"].as_str().unwrap_or("").trim();
            let is_enabled_installed = if asset_type == "assistant" {
                !asset_id.is_empty() && enabled_assistant_ids.contains(asset_id)
            } else if asset_type == "tool" {
                pkg_name
                    .map(|pkg| enabled_skill_ids.contains(pkg.trim()))
                    .unwrap_or(true)
            } else {
                true
            };
            let item = serde_json::json!({
                "name": name, "description": desc, "source": format!("local_{}", source_type),
                "pkg_name": pkg_name, "score": hit.get("_distance"), "needs_provisioning": source_type == "cloud_mirror",
                "asset_type": hit.get("asset_type"), "callable": source_type != "cloud_mirror" && is_enabled_installed,
                "assistant_id": if asset_type == "assistant" { Some(asset_id) } else { None::<&str> },
            });
            if source_type == "cloud_mirror" {
                install_hints.push(item);
                continue;
            }
            if !is_enabled_installed {
                if asset_type == "assistant" {
                    assistant_install_filtered_count += 1;
                } else if asset_type == "tool" {
                    skill_install_filtered_count += 1;
                }
                continue;
            }
            catalog.push(item);
        }
    }
    catalog.push(serde_json::json!({"name":"list_user_memories","description":"List local memories for current desktop session","source":"code_mode_bridge"}));
    let matches = catalog
        .into_iter()
        .filter(|item| {
            if normalized.is_empty() {
                return true;
            }
            let name_hit = item
                .get("name")
                .and_then(|v| v.as_str())
                .map(|n| n.to_lowercase().contains(&normalized))
                .unwrap_or(false);
            let desc_hit = item
                .get("description")
                .and_then(|v| v.as_str())
                .map(|d| d.to_lowercase().contains(&normalized))
                .unwrap_or(false);
            name_hit || desc_hit || item.get("score").is_some()
        })
        .collect::<Vec<_>>();
    let usage_hint = "先根据参数文档和 python_stub 规划步骤，再调用 execute_code_plan 一次性执行。脚本内优先 `from deeting_sdk import tool_name` 或 `deeting.call_tool(name, **kwargs)`；不要写 `deeting.call_tool(name, { ... })`。最后请用 `deeting.log(json.dumps(result, ensure_ascii=False))` 输出结构化结果。";
    serde_json::json!({
        "format_version": "sdk_toolcard.v2", "runtime_protocol_version": crate::modules::code_mode::contract::RUNTIME_PROTOCOL_VERSION,
        "query": query, "mode": "code_mode", "count": matches.len(), "tools": matches.clone(), "items": matches,
        "usage_hint": usage_hint, "install_hints": install_hints,
        "assistant_install_gate": {"enabled_installed_count": enabled_assistant_ids.len(), "filtered_out_count": assistant_install_filtered_count},
        "skill_install_gate": {"enabled_installed_count": enabled_skill_ids.len(), "filtered_out_count": skill_install_filtered_count}
    })
}
