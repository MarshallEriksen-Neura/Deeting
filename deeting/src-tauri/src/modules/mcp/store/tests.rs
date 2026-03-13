use super::helpers::{
    compute_local_knowledge_match_score, extract_local_document_text,
    split_local_document_text_into_chunks, tokenize_local_search_query,
    truncate_local_document_error_message,
};
use super::McpStore;
use crate::modules::mcp::types::LocalGatewayLogQuery;
use sqlx::Row;
use uuid::Uuid;

async fn create_test_store(name: &str) -> McpStore {
    let db_path = std::env::temp_dir().join(format!("deeting-{name}-{}.db", Uuid::new_v4()));
    let database_url = format!("sqlite:{}", db_path.to_string_lossy().replace('\\', "/"));
    McpStore::new(&database_url)
        .await
        .expect("test store should be created")
}

#[test]
fn extract_local_document_text_prefers_raw_text() {
    let meta = serde_json::json!({
        "text": "secondary",
        "raw_text": "primary"
    });
    let extracted = extract_local_document_text(&meta).expect("text should exist");
    assert_eq!(extracted, "primary");
}

#[test]
fn extract_local_document_text_falls_back_to_chunks() {
    let meta = serde_json::json!({
        "chunks": ["first", " ", "second"]
    });
    let extracted = extract_local_document_text(&meta).expect("text should exist");
    assert_eq!(extracted, "first\n\nsecond");
}

#[test]
fn split_local_document_text_into_chunks_splits_long_text() {
    let source = "abc ".repeat(2000);
    let chunks = split_local_document_text_into_chunks(&source);
    assert!(chunks.len() > 1);
    assert!(chunks.iter().all(|chunk| !chunk.trim().is_empty()));
}

#[test]
fn split_local_document_text_into_chunks_keeps_short_text() {
    let chunks = split_local_document_text_into_chunks("short text");
    assert_eq!(chunks, vec!["short text".to_string()]);
}

#[test]
fn truncate_local_document_error_message_limits_length() {
    let source = "x".repeat(500);
    let truncated = truncate_local_document_error_message(&source);
    assert_eq!(truncated.chars().count(), 300);
}

#[test]
fn tokenize_local_search_query_extracts_terms() {
    let tokens = tokenize_local_search_query("How to deploy Rust service?");
    assert!(tokens.contains(&"how".to_string()));
    assert!(tokens.contains(&"deploy".to_string()));
    assert!(tokens.contains(&"rust".to_string()));
    assert!(tokens.contains(&"service".to_string()));
}

#[test]
fn compute_local_knowledge_match_score_prefers_phrase_match() {
    let query = "deploy rust service";
    let tokens = tokenize_local_search_query(query);
    let strong = compute_local_knowledge_match_score(
        query,
        &tokens,
        "how to deploy rust service to production",
    );
    let weak = compute_local_knowledge_match_score(query, &tokens, "rust notes and tricks");
    assert!(strong > weak);
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
