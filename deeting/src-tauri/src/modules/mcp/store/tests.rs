use super::McpStore;
use crate::modules::mcp::commands::runtime::capability_catalog::build_capability_registry;
use mcp_registry::types::LocalCapabilityRegistryUpsert;
use mcp_session::admin::LocalGatewayLogQuery;
use serde_json::json;
use sqlx::Row;
use uuid::Uuid;

async fn create_test_store(name: &str) -> McpStore {
    let db_path = std::env::temp_dir().join(format!("deeting-{name}-{}.db", Uuid::new_v4()));
    let database_url = format!("sqlite:{}", db_path.to_string_lossy().replace('\\', "/"));
    McpStore::new(&database_url)
        .await
        .expect("test store should be created")
}

#[tokio::test]
async fn init_repairs_assistant_install_legacy_foreign_key_target() {
    let store = create_test_store("assistant-install-fk-repair").await;

    sqlx::query("PRAGMA foreign_keys=OFF;")
        .execute(&store.pool)
        .await
        .expect("disable foreign keys");
    sqlx::query(
        r#"
        CREATE TABLE assistant (
          id TEXT PRIMARY KEY,
          owner_user_id TEXT,
          visibility TEXT NOT NULL DEFAULT 'private',
          status TEXT NOT NULL DEFAULT 'draft',
          share_slug TEXT UNIQUE,
          summary TEXT,
          icon_id TEXT,
          install_count INTEGER NOT NULL DEFAULT 0,
          rating_avg REAL NOT NULL DEFAULT 0,
          rating_count INTEGER NOT NULL DEFAULT 0,
          current_version_id TEXT,
          published_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE assistant_version (
          id TEXT PRIMARY KEY,
          assistant_id TEXT NOT NULL REFERENCES assistant(id) ON DELETE CASCADE,
          version TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          system_prompt TEXT NOT NULL,
          model_config TEXT,
          tags TEXT,
          changelog TEXT,
          published_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE assistant_install (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          assistant_id TEXT NOT NULL REFERENCES assistant(id) ON DELETE CASCADE,
          alias TEXT,
          icon_override TEXT,
          pinned_version_id TEXT REFERENCES assistant_version_legacy(id) ON DELETE SET NULL,
          follow_latest INTEGER NOT NULL DEFAULT 1,
          is_enabled INTEGER NOT NULL DEFAULT 1,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        "#,
    )
    .execute(&store.pool)
    .await
    .expect("create broken schema");
    sqlx::query("INSERT INTO assistant (id, created_at, updated_at) VALUES (?, ?, ?)")
        .bind("assistant-1")
        .bind("2024-01-01T00:00:00Z")
        .bind("2024-01-01T00:00:00Z")
        .execute(&store.pool)
        .await
        .expect("insert assistant");
    sqlx::query(
        "INSERT INTO assistant_version (id, assistant_id, version, name, system_prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind("version-1")
    .bind("assistant-1")
    .bind("1.0.0")
    .bind("Assistant")
    .bind("Prompt")
    .bind("2024-01-01T00:00:00Z")
    .bind("2024-01-01T00:00:00Z")
    .execute(&store.pool)
    .await
    .expect("insert assistant version");

    store
        .init()
        .await
        .expect("init should repair broken schema");

    let fk_rows = sqlx::query("PRAGMA foreign_key_list(assistant_install)")
        .fetch_all(&store.pool)
        .await
        .expect("read foreign keys");
    assert!(fk_rows.iter().any(|row| {
        row.try_get::<String, _>("table")
            .map(|table| table == "assistant_version")
            .unwrap_or(false)
    }));
}

#[tokio::test]
async fn init_drops_skill_refs_without_retargeting_assistant_install() {
    let store = create_test_store("assistant-version-drop-skill-refs").await;

    sqlx::query("PRAGMA foreign_keys=ON;")
        .execute(&store.pool)
        .await
        .expect("enable foreign keys");
    sqlx::query(
        r#"
        CREATE TABLE assistants (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          avatar TEXT,
          system_prompt TEXT NOT NULL,
          model_config TEXT,
          tags TEXT,
          visibility TEXT NOT NULL,
          source TEXT NOT NULL,
          cloud_id TEXT,
          is_deleted INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE assistant (
          id TEXT PRIMARY KEY,
          owner_user_id TEXT,
          visibility TEXT NOT NULL DEFAULT 'private',
          status TEXT NOT NULL DEFAULT 'draft',
          share_slug TEXT UNIQUE,
          summary TEXT,
          icon_id TEXT,
          install_count INTEGER NOT NULL DEFAULT 0,
          rating_avg REAL NOT NULL DEFAULT 0,
          rating_count INTEGER NOT NULL DEFAULT 0,
          current_version_id TEXT,
          published_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE assistant_version (
          id TEXT PRIMARY KEY,
          assistant_id TEXT NOT NULL REFERENCES assistant(id) ON DELETE CASCADE,
          version TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          system_prompt TEXT NOT NULL,
          model_config TEXT,
          tags TEXT,
          skill_refs TEXT,
          changelog TEXT,
          published_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE assistant_install (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          assistant_id TEXT NOT NULL REFERENCES assistant(id) ON DELETE CASCADE,
          alias TEXT,
          icon_override TEXT,
          pinned_version_id TEXT REFERENCES assistant_version(id) ON DELETE SET NULL,
          follow_latest INTEGER NOT NULL DEFAULT 1,
          is_enabled INTEGER NOT NULL DEFAULT 1,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        "#,
    )
    .execute(&store.pool)
    .await
    .expect("create legacy schema");
    sqlx::query("INSERT INTO assistant (id, created_at, updated_at) VALUES (?, ?, ?)")
        .bind("assistant-1")
        .bind("2024-01-01T00:00:00Z")
        .bind("2024-01-01T00:00:00Z")
        .execute(&store.pool)
        .await
        .expect("insert assistant");
    sqlx::query(
        "INSERT INTO assistant_version (id, assistant_id, version, name, system_prompt, skill_refs, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind("version-1")
    .bind("assistant-1")
    .bind("1.0.0")
    .bind("Assistant")
    .bind("Prompt")
    .bind("[]")
    .bind("2024-01-01T00:00:00Z")
    .bind("2024-01-01T00:00:00Z")
    .execute(&store.pool)
    .await
    .expect("insert legacy assistant version");
    sqlx::query(
        "INSERT INTO assistant_install (id, user_id, assistant_id, pinned_version_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind("install-1")
    .bind("user-1")
    .bind("assistant-1")
    .bind("version-1")
    .bind("2024-01-01T00:00:00Z")
    .bind("2024-01-01T00:00:00Z")
    .execute(&store.pool)
    .await
    .expect("insert assistant install");

    store
        .init()
        .await
        .expect("init should migrate legacy schema");

    let columns = sqlx::query("PRAGMA table_info(assistant_version)")
        .fetch_all(&store.pool)
        .await
        .expect("read columns");
    assert!(!columns.iter().any(|row| {
        row.try_get::<String, _>("name")
            .map(|name| name == "skill_refs")
            .unwrap_or(false)
    }));

    let fk_rows = sqlx::query("PRAGMA foreign_key_list(assistant_install)")
        .fetch_all(&store.pool)
        .await
        .expect("read foreign keys");
    assert!(fk_rows.iter().any(|row| {
        row.try_get::<String, _>("table")
            .map(|table| table == "assistant_version")
            .unwrap_or(false)
    }));

    sqlx::query(
        "INSERT INTO assistant_install (id, user_id, assistant_id, pinned_version_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind("install-2")
    .bind("user-2")
    .bind("assistant-1")
    .bind("version-1")
    .bind("2024-01-01T00:00:00Z")
    .bind("2024-01-01T00:00:00Z")
    .execute(&store.pool)
    .await
    .expect("assistant_install should still reference assistant_version");
}

#[tokio::test]
async fn local_capability_registry_roundtrips_and_cleans_up_with_skill_install() {
    let store = create_test_store("local-capability-registry").await;
    store.init().await.expect("init store");

    store
        .upsert_local_skill_install(
            "skill.alpha",
            Some("1.0.0"),
            Some("local"),
            r#"{"id":"skill.alpha","name":"Skill Alpha"}"#,
            "C:/skills/skill.alpha",
        )
        .await
        .expect("insert local skill install");

    let generation = store
        .next_local_capability_registry_generation()
        .await
        .expect("next generation");
    assert!(generation >= 1);

    store
        .replace_local_capability_registry_entries(
            "skill.alpha",
            &[
                LocalCapabilityRegistryUpsert {
                    capability_id: "skill_bundle::skill.alpha".to_string(),
                    source_kind: "user".to_string(),
                    asset_kind: "skill_bundle".to_string(),
                    package_id: "skill.alpha".to_string(),
                    package_version: Some("1.0.0".to_string()),
                    title: "Skill Alpha".to_string(),
                    description: "Bundle entry".to_string(),
                    tool_name: None,
                    callable_name: None,
                    binding_kind: None,
                    execution_surface: "recipe".to_string(),
                    runtime: Some("local".to_string()),
                    entry_path: None,
                    is_direct_callable: false,
                    activation_state: "enabled".to_string(),
                    runtime_state: "registered".to_string(),
                    search_index_state: "pending".to_string(),
                    generation,
                    descriptor_json: json!({
                        "capability_id": "skill_bundle::skill.alpha",
                        "asset_kind": "skill_bundle"
                    })
                    .to_string(),
                },
                LocalCapabilityRegistryUpsert {
                    capability_id: "skill_tool::skill.alpha::install".to_string(),
                    source_kind: "user".to_string(),
                    asset_kind: "skill_tool".to_string(),
                    package_id: "skill.alpha".to_string(),
                    package_version: Some("1.0.0".to_string()),
                    title: "Skill Alpha / install".to_string(),
                    description: "Install skill alpha".to_string(),
                    tool_name: Some("install".to_string()),
                    callable_name: Some("skill.skill.alpha.install".to_string()),
                    binding_kind: Some("deeting_tool".to_string()),
                    execution_surface: "desktop_capability".to_string(),
                    runtime: Some("python".to_string()),
                    entry_path: Some("C:/skills/skill.alpha/main.py".to_string()),
                    is_direct_callable: true,
                    activation_state: "enabled".to_string(),
                    runtime_state: "registered".to_string(),
                    search_index_state: "pending".to_string(),
                    generation,
                    descriptor_json: json!({
                        "capability_id": "skill_tool::skill.alpha::install",
                        "callable_name": "skill.skill.alpha.install"
                    })
                    .to_string(),
                },
            ],
        )
        .await
        .expect("replace capability registry entries");

    let entries = store
        .list_local_capability_registry_entries_for_package("skill.alpha")
        .await
        .expect("list capability registry entries");
    assert_eq!(entries.len(), 2);
    assert!(entries.iter().any(|entry| {
        entry.asset_kind == "skill_tool"
            && entry.callable_name.as_deref() == Some("skill.skill.alpha.install")
            && entry.is_direct_callable
    }));
    assert!(entries.iter().all(|entry| entry.generation == generation));
    let cached_registry = build_capability_registry(&store).await;
    assert!(cached_registry
        .entries
        .iter()
        .any(|entry| entry.asset["id"] == json!("skill.alpha")));

    store
        .delete_local_skill_install("skill.alpha")
        .await
        .expect("delete local skill install");

    let remaining = store
        .list_local_capability_registry_entries_for_package("skill.alpha")
        .await
        .expect("list remaining capability registry entries");
    assert!(remaining.is_empty());
    let registry_after_delete = build_capability_registry(&store).await;
    assert!(registry_after_delete
        .entries
        .iter()
        .all(|entry| entry.asset["id"] != json!("skill.alpha")));
}

#[tokio::test]
async fn capability_registry_cache_invalidates_after_registry_replace() {
    let store = create_test_store("capability-registry-cache-invalidate").await;
    store.init().await.expect("init store");

    let generation = store
        .next_local_capability_registry_generation()
        .await
        .expect("next generation");
    store
        .replace_local_capability_registry_entries(
            "skill.alpha",
            &[LocalCapabilityRegistryUpsert {
                capability_id: "skill_bundle::skill.alpha".to_string(),
                source_kind: "user".to_string(),
                asset_kind: "skill_bundle".to_string(),
                package_id: "skill.alpha".to_string(),
                package_version: Some("1.0.0".to_string()),
                title: "Skill Alpha".to_string(),
                description: "Alpha bundle".to_string(),
                tool_name: None,
                callable_name: None,
                binding_kind: None,
                execution_surface: "recipe".to_string(),
                runtime: Some("local".to_string()),
                entry_path: None,
                is_direct_callable: false,
                activation_state: "enabled".to_string(),
                runtime_state: "ready".to_string(),
                search_index_state: "ready".to_string(),
                generation,
                descriptor_json: json!({
                    "manifest": {
                        "id": "skill.alpha",
                        "name": "Skill Alpha"
                    },
                    "restricted": false,
                    "allowed_roles": []
                })
                .to_string(),
            }],
        )
        .await
        .expect("insert first registry entry");

    let initial_registry = build_capability_registry(&store).await;
    assert!(initial_registry
        .entries
        .iter()
        .any(|entry| entry.asset["id"] == json!("skill.alpha")));

    let next_generation = store
        .next_local_capability_registry_generation()
        .await
        .expect("next generation after cache warm");
    store
        .replace_local_capability_registry_entries(
            "skill.alpha",
            &[LocalCapabilityRegistryUpsert {
                capability_id: "skill_bundle::skill.alpha".to_string(),
                source_kind: "user".to_string(),
                asset_kind: "skill_bundle".to_string(),
                package_id: "skill.alpha".to_string(),
                package_version: Some("1.0.1".to_string()),
                title: "Skill Alpha Updated".to_string(),
                description: "Updated bundle".to_string(),
                tool_name: None,
                callable_name: None,
                binding_kind: None,
                execution_surface: "recipe".to_string(),
                runtime: Some("local".to_string()),
                entry_path: None,
                is_direct_callable: false,
                activation_state: "enabled".to_string(),
                runtime_state: "ready".to_string(),
                search_index_state: "ready".to_string(),
                generation: next_generation,
                descriptor_json: json!({
                    "manifest": {
                        "id": "skill.alpha",
                        "name": "Skill Alpha Updated"
                    },
                    "restricted": false,
                    "allowed_roles": []
                })
                .to_string(),
            }],
        )
        .await
        .expect("replace cached registry entry");

    let refreshed_registry = build_capability_registry(&store).await;
    let refreshed_asset = refreshed_registry
        .entries
        .iter()
        .find(|entry| entry.asset["id"] == json!("skill.alpha"))
        .expect("refreshed skill asset");
    assert_eq!(refreshed_asset.asset["name"], json!("Skill Alpha Updated"));
    assert_eq!(
        refreshed_asset.asset["description"],
        json!("Updated bundle")
    );
}

#[tokio::test]
async fn get_enabled_local_skill_tool_binding_by_ref_self_heals_missing_entry_path() {
    let store = create_test_store("missing-skill-binding-entry").await;
    store.init().await.expect("init store");

    store
        .upsert_local_skill_install(
            "skill.missing",
            Some("1.0.0"),
            Some("local"),
            r#"{"id":"skill.missing","name":"Missing Skill"}"#,
            "C:/skills/skill.missing",
        )
        .await
        .expect("insert local skill install");
    store
        .replace_local_skill_tool_bindings(
            "skill.missing",
            &[crate::modules::mcp::store::LocalSkillToolBindingUpsert {
                binding_id: "skill_binding::skill.missing::install".to_string(),
                binding_kind: "script_runner".to_string(),
                callable_name: "skill.skill.missing.install".to_string(),
                tool_name: "install".to_string(),
                description: "Install missing skill".to_string(),
                input_schema_json: None,
                output_schema_json: None,
                entry_path: "C:/definitely-missing/skill.missing/main.py".to_string(),
                runtime: "python".to_string(),
                timeout_seconds: 60,
            }],
        )
        .await
        .expect("insert local skill binding");

    let binding = store
        .get_enabled_local_skill_tool_binding_by_ref(None, Some("skill.skill.missing.install"))
        .await
        .expect("query missing binding");
    assert!(binding.is_none());
    assert!(store
        .get_local_skill_install_path("skill.missing")
        .await
        .expect("query local install path")
        .is_none());
    assert!(store
        .list_local_skill_tool_bindings_for_skill("skill.missing")
        .await
        .expect("list remaining bindings")
        .is_empty());
}

#[tokio::test]
async fn gateway_log_queries_filter_by_dimensions_and_stats() {
    let store = create_test_store("gateway-log-dimensions").await;
    store.init().await.expect("init store");

    store
        .create_local_gateway_log(
            Some("trace-1"),
            Some("user-a"),
            Some("cred-a"),
            Some("preset-a"),
            "gpt-4o",
            200,
            120,
            Some(60),
            Some("https://example.com/v1/chat/completions"),
            0,
            10,
            20,
            30,
            0.015,
            0.02,
            true,
            None,
            Some(&json!({
                "usage_normalized": {
                    "usage_source": "provider_reported",
                    "cache_source": "provider_reported",
                    "request_cache_hit": true,
                    "cached_tokens": 12,
                    "cache_read_input_tokens": 12,
                    "cache_write_input_tokens": 0
                },
                "provider_usage_raw": {
                    "prompt_tokens": 10,
                    "completion_tokens": 20,
                    "prompt_tokens_details": {
                        "cached_tokens": 12
                    }
                }
            })),
        )
        .await
        .expect("insert cached success log");

    store
        .create_local_gateway_log(
            Some("trace-2"),
            Some("user-b"),
            Some("cred-b"),
            Some("preset-b"),
            "gpt-4o-mini",
            429,
            240,
            Some(90),
            Some("https://example.com/v1/chat/completions"),
            0,
            4,
            6,
            10,
            0.008,
            0.01,
            false,
            Some("429"),
            None,
        )
        .await
        .expect("insert rate limit log");

    let filtered = store
        .list_local_gateway_logs(LocalGatewayLogQuery {
            api_key_id: Some("cred-a".to_string()),
            preset_id: Some("preset-a".to_string()),
            is_cached: Some(true),
            ..Default::default()
        })
        .await
        .expect("list filtered logs");

    assert_eq!(filtered.total, 1);
    assert_eq!(filtered.items.len(), 1);
    assert_eq!(filtered.items[0].user_id.as_deref(), Some("user-a"));
    assert_eq!(filtered.items[0].api_key_id.as_deref(), Some("cred-a"));
    assert_eq!(filtered.items[0].preset_id.as_deref(), Some("preset-a"));
    assert_eq!(filtered.items[0].total_tokens, 30);
    assert_eq!(filtered.items[0].cost_upstream, 0.015);
    assert_eq!(filtered.items[0].cached_tokens, Some(12));
    assert_eq!(filtered.items[0].cache_read_input_tokens, Some(12));
    assert_eq!(filtered.items[0].cache_write_input_tokens, Some(0));
    assert_eq!(
        filtered.items[0].cache_source.as_deref(),
        Some("provider_reported")
    );
    assert_eq!(
        filtered.items[0].usage_source.as_deref(),
        Some("provider_reported")
    );
    assert!(filtered.items[0].meta.is_some());

    let stats = store
        .get_local_gateway_log_stats(LocalGatewayLogQuery {
            api_key_id: Some("cred-b".to_string()),
            error_code: Some("429".to_string()),
            ..Default::default()
        })
        .await
        .expect("stats for filtered logs");

    assert_eq!(stats.total, 1);
    assert_eq!(stats.success_rate, 0.0);
    assert_eq!(stats.cache_hit_rate, 0.0);
    assert_eq!(stats.avg_duration_ms, 240);
    assert_eq!(stats.total_cost_user, 0.01);
    assert_eq!(stats.error_distribution[0].key, "429");
}

#[tokio::test]
async fn record_tool_execution_persists_successful_events() {
    let store = create_test_store("tool-execution-history").await;
    store.init().await.expect("init store");

    store
        .record_tool_execution(Some("session-1"), "browser_open_tab", true)
        .await
        .expect("record tool execution");

    let rows = sqlx::query(
        "SELECT session_id, tool_name, success FROM tool_execution_history ORDER BY created_at_unix_ms DESC",
    )
    .fetch_all(&store.pool)
    .await
    .expect("read tool execution history");

    assert_eq!(rows.len(), 1);
    assert_eq!(
        rows[0]
            .try_get::<String, _>("session_id")
            .expect("session id"),
        "session-1"
    );
    assert_eq!(
        rows[0]
            .try_get::<String, _>("tool_name")
            .expect("tool name"),
        "browser_open_tab"
    );
    assert_eq!(rows[0].try_get::<i64, _>("success").expect("success"), 1);
}

#[tokio::test]
async fn list_tool_execution_affinity_rows_orders_newer_tool_usage_first() {
    let store = create_test_store("tool-execution-affinity").await;
    store.init().await.expect("init store");

    sqlx::query(
        "INSERT INTO tool_execution_history (id, session_id, tool_name, success, created_at_unix_ms)
         VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)",
    )
    .bind("row-1")
    .bind::<Option<&str>>(Some("session-1"))
    .bind("browser_open_tab")
    .bind(1_i64)
    .bind(1_000_i64)
    .bind("row-2")
    .bind::<Option<&str>>(Some("session-1"))
    .bind("browser_open_tab")
    .bind(1_i64)
    .bind(2_000_i64)
    .bind("row-3")
    .bind::<Option<&str>>(Some("session-2"))
    .bind("browser_wait_for_element")
    .bind(1_i64)
    .bind(5_000_i64)
    .execute(&store.pool)
    .await
    .expect("seed tool execution history");

    let rows = store
        .list_tool_execution_affinity_rows(8)
        .await
        .expect("list affinity rows");

    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].tool_name, "browser_wait_for_element");
    assert_eq!(rows[0].success_count, 1);
    assert_eq!(rows[0].last_used_at_unix_ms, 5_000);
    assert_eq!(rows[1].tool_name, "browser_open_tab");
    assert_eq!(rows[1].success_count, 2);
    assert_eq!(rows[1].last_used_at_unix_ms, 2_000);
}

#[tokio::test]
async fn upsert_tool_approval_rule_tracks_observation_fields() {
    let store = create_test_store("tool-approval-rule-observation").await;
    store.init().await.expect("init store");

    store
        .upsert_tool_approval_rule(
            "rule-1",
            crate::modules::mcp::policy::PersistedApprovalAction::AllowOnce,
            "browser_open_tab",
            "fingerprint-1",
            Some("MEDIUM"),
        )
        .await
        .expect("upsert approval observation");

    let row = store
        .get_tool_approval_rule("rule-1")
        .await
        .expect("read approval rule")
        .expect("approval rule exists");

    assert_eq!(
        row.action,
        crate::modules::mcp::policy::PersistedApprovalAction::AllowOnce
    );
    assert_eq!(row.approve_count, 1);
    assert_eq!(row.reject_count, 0);
    assert_eq!(row.risk_level.as_deref(), Some("MEDIUM"));
    assert!(row.last_approved_at_unix_ms.is_some());
    assert!(!row.auto_promoted);
    assert_eq!(row.half_life_days, 7);
}

#[tokio::test]
async fn promote_tool_approval_rule_to_allow_always_marks_auto_promoted() {
    let store = create_test_store("tool-approval-rule-promote").await;
    store.init().await.expect("init store");

    store
        .upsert_tool_approval_rule(
            "rule-2",
            crate::modules::mcp::policy::PersistedApprovalAction::AllowOnce,
            "browser_open_tab",
            "fingerprint-2",
            Some("MEDIUM"),
        )
        .await
        .expect("seed approval rule");

    store
        .promote_tool_approval_rule_to_allow_always("rule-2", 14)
        .await
        .expect("promote approval rule");

    let row = store
        .get_tool_approval_rule("rule-2")
        .await
        .expect("read approval rule")
        .expect("approval rule exists");

    assert_eq!(
        row.action,
        crate::modules::mcp::policy::PersistedApprovalAction::AllowAlways
    );
    assert!(row.auto_promoted);
    assert!(row.expires_at_unix_ms.is_some());
}

#[tokio::test]
async fn upsert_tool_query_affinity_accumulates_success_count() {
    let store = create_test_store("tool-query-affinity").await;
    store.init().await.expect("init store");

    store
        .upsert_tool_query_affinity("check bug", "eslint_check")
        .await
        .expect("upsert affinity 1");
    store
        .upsert_tool_query_affinity("check bug", "eslint_check")
        .await
        .expect("upsert affinity 2");

    let rows = store
        .list_tool_query_affinity_rows(8)
        .await
        .expect("list query affinity rows");

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].query_text, "check bug");
    assert_eq!(rows[0].tool_name, "eslint_check");
    assert_eq!(rows[0].success_count, 2);
}

#[tokio::test]
async fn list_tool_query_affinity_rows_ignores_stale_rows() {
    let store = create_test_store("tool-query-affinity-stale").await;
    store.init().await.expect("init store");

    sqlx::query(
        "INSERT INTO tool_query_affinity (query_text, tool_name, success_count, last_matched_at_unix_ms)
         VALUES (?, ?, ?, ?), (?, ?, ?, ?)",
    )
    .bind("very old query")
    .bind("shell_execute")
    .bind(4_i64)
    .bind(1_i64)
    .bind("fresh query")
    .bind("shell_execute")
    .bind(2_i64)
    .bind((time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000) as i64)
    .execute(&store.pool)
    .await
    .expect("seed query affinity rows");

    let rows = store
        .list_tool_query_affinity_rows(8)
        .await
        .expect("list query affinity rows");

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].query_text, "fresh query");
}

#[tokio::test]
async fn upsert_tool_query_affinity_clamps_rows_per_tool() {
    let store = create_test_store("tool-query-affinity-cap").await;
    store.init().await.expect("init store");

    for index in 0..20 {
        store
            .upsert_tool_query_affinity(&format!("query-{index}"), "shell_execute")
            .await
            .expect("upsert bounded affinity");
    }

    let rows = sqlx::query(
        "SELECT query_text FROM tool_query_affinity WHERE tool_name = ? ORDER BY last_matched_at_unix_ms DESC",
    )
    .bind("shell_execute")
    .fetch_all(&store.pool)
    .await
    .expect("read stored query affinity rows");

    assert!(rows.len() <= 12, "rows={}", rows.len());
}

#[tokio::test]
async fn apply_task_policy_delta_upserts_and_accumulates_prior_weight() {
    let store = create_test_store("task-policy-priors").await;
    store.init().await.expect("init store");

    store
        .apply_task_policy_delta(
            "fingerprint-a",
            "route",
            "worker",
            0.25,
            "provisional",
            0.6,
            Some("run-1"),
        )
        .await
        .expect("insert prior");
    store
        .apply_task_policy_delta(
            "fingerprint-a",
            "route",
            "worker",
            0.15,
            "confirmed",
            0.8,
            Some("run-2"),
        )
        .await
        .expect("update prior");

    let rows = store
        .list_task_policy_prior_rows("fingerprint-a", "route", 8)
        .await
        .expect("list task policy priors");

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].action_key, "worker");
    assert!(
        (rows[0].weight - 0.4).abs() < 1e-6,
        "weight={}",
        rows[0].weight
    );
    assert_eq!(rows[0].evidence_count, 2);
    assert_eq!(rows[0].maturity, "confirmed");
    assert!((rows[0].confidence - 0.8).abs() < 1e-6);
}

#[tokio::test]
async fn record_asset_execution_persists_session_and_asset_id() {
    let store = create_test_store("asset-execution-history").await;
    store.init().await.expect("init store");

    store
        .record_asset_execution(Some("session-1"), "weather-ios18-card", true)
        .await
        .expect("record asset execution");

    let rows = sqlx::query(
        "SELECT session_id, asset_id, success FROM asset_execution_history ORDER BY created_at_unix_ms DESC",
    )
    .fetch_all(&store.pool)
    .await
    .expect("read asset execution history");

    assert_eq!(rows.len(), 1);
    assert_eq!(
        rows[0]
            .try_get::<String, _>("session_id")
            .expect("session id"),
        "session-1"
    );
    assert_eq!(
        rows[0].try_get::<String, _>("asset_id").expect("asset id"),
        "weather-ios18-card"
    );
    assert_eq!(rows[0].try_get::<i64, _>("success").expect("success"), 1);
}

#[tokio::test]
async fn list_asset_execution_affinity_rows_orders_newer_asset_usage_first() {
    let store = create_test_store("asset-execution-affinity").await;
    store.init().await.expect("init store");

    sqlx::query(
        "INSERT INTO asset_execution_history (id, session_id, asset_id, success, created_at_unix_ms)
         VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)",
    )
    .bind("row-1")
    .bind::<Option<&str>>(Some("session-1"))
    .bind("weather-ios18-card")
    .bind(1_i64)
    .bind(1_000_i64)
    .bind("row-2")
    .bind::<Option<&str>>(Some("session-1"))
    .bind("weather-ios18-card")
    .bind(1_i64)
    .bind(2_000_i64)
    .bind("row-3")
    .bind::<Option<&str>>(Some("session-2"))
    .bind("stocks-market-card")
    .bind(1_i64)
    .bind(5_000_i64)
    .execute(&store.pool)
    .await
    .expect("seed asset execution history");

    let rows = store
        .list_asset_execution_affinity_rows(8)
        .await
        .expect("list asset affinity rows");

    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].asset_id, "stocks-market-card");
    assert_eq!(rows[0].success_count, 1);
    assert_eq!(rows[0].last_used_at_unix_ms, 5_000);
    assert_eq!(rows[1].asset_id, "weather-ios18-card");
    assert_eq!(rows[1].success_count, 2);
    assert_eq!(rows[1].last_used_at_unix_ms, 2_000);
}

#[tokio::test]
async fn list_recent_session_asset_ids_deduplicates_and_orders_by_latest_use() {
    let store = create_test_store("asset-session-recent").await;
    store.init().await.expect("init store");

    sqlx::query(
        "INSERT INTO asset_execution_history (id, session_id, asset_id, success, created_at_unix_ms)
         VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?), (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)",
    )
    .bind("row-1")
    .bind::<Option<&str>>(Some("session-1"))
    .bind("weather-ios18-card")
    .bind(1_i64)
    .bind(1_000_i64)
    .bind("row-2")
    .bind::<Option<&str>>(Some("session-1"))
    .bind("stocks-market-card")
    .bind(1_i64)
    .bind(5_000_i64)
    .bind("row-3")
    .bind::<Option<&str>>(Some("session-1"))
    .bind("weather-ios18-card")
    .bind(1_i64)
    .bind(8_000_i64)
    .bind("row-4")
    .bind::<Option<&str>>(Some("session-2"))
    .bind("ignored-other-session")
    .bind(1_i64)
    .bind(9_000_i64)
    .execute(&store.pool)
    .await
    .expect("seed asset execution history");

    let rows = store
        .list_recent_session_asset_ids("session-1", 8)
        .await
        .expect("list recent session asset ids");

    assert_eq!(
        rows,
        vec![
            "weather-ios18-card".to_string(),
            "stocks-market-card".to_string()
        ]
    );
}

#[tokio::test]
async fn upsert_asset_query_affinity_accumulates_success_count() {
    let store = create_test_store("asset-query-affinity").await;
    store.init().await.expect("init store");

    store
        .upsert_asset_query_affinity("check weather", "weather-ios18-card")
        .await
        .expect("upsert asset affinity 1");
    store
        .upsert_asset_query_affinity("check weather", "weather-ios18-card")
        .await
        .expect("upsert asset affinity 2");

    let rows = store
        .list_asset_query_affinity_rows(8)
        .await
        .expect("list asset query affinity rows");

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].query_text, "check weather");
    assert_eq!(rows[0].asset_id, "weather-ios18-card");
    assert_eq!(rows[0].success_count, 2);
}

#[tokio::test]
async fn list_asset_query_affinity_rows_ignores_stale_rows() {
    let store = create_test_store("asset-query-affinity-stale").await;
    store.init().await.expect("init store");

    sqlx::query(
        "INSERT INTO asset_query_affinity (query_text, asset_id, success_count, last_matched_at_unix_ms)
         VALUES (?, ?, ?, ?), (?, ?, ?, ?)",
    )
    .bind("very old weather")
    .bind("weather-ios18-card")
    .bind(4_i64)
    .bind(1_i64)
    .bind("fresh weather")
    .bind("weather-ios18-card")
    .bind(2_i64)
    .bind((time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000) as i64)
    .execute(&store.pool)
    .await
    .expect("seed asset query affinity rows");

    let rows = store
        .list_asset_query_affinity_rows(8)
        .await
        .expect("list asset query affinity rows");

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].query_text, "fresh weather");
}

#[tokio::test]
async fn upsert_asset_query_affinity_clamps_rows_per_asset() {
    let store = create_test_store("asset-query-affinity-cap").await;
    store.init().await.expect("init store");

    for index in 0..20 {
        store
            .upsert_asset_query_affinity(&format!("query-{index}"), "weather-ios18-card")
            .await
            .expect("upsert bounded asset affinity");
    }

    let rows = sqlx::query(
        "SELECT query_text FROM asset_query_affinity WHERE asset_id = ? ORDER BY last_matched_at_unix_ms DESC",
    )
    .bind("weather-ios18-card")
    .fetch_all(&store.pool)
    .await
    .expect("read stored asset affinity rows");

    assert!(rows.len() <= 12, "rows={}", rows.len());
}
