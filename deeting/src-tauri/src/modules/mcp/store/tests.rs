use super::McpStore;
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
    assert_eq!(generation, 1);

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

    store
        .delete_local_skill_install("skill.alpha")
        .await
        .expect("delete local skill install");

    let remaining = store
        .list_local_capability_registry_entries_for_package("skill.alpha")
        .await
        .expect("list remaining capability registry entries");
    assert!(remaining.is_empty());
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
            None,
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
