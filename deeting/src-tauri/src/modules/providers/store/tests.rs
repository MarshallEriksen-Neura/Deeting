use super::*;
use serde_json::json;
use sqlx::Row;
use uuid::Uuid;

fn isolated_provider_market_file_path() -> std::path::PathBuf {
    std::env::temp_dir().join(format!("deeting-provider-market-{}.json", Uuid::new_v4()))
}

async fn init_store() -> ProviderStore {
    let store = ProviderStore::new("sqlite::memory:")
        .await
        .expect("failed to create provider store")
        .with_provider_market_file(isolated_provider_market_file_path());
    store.init().await.expect("provider init failed");
    store
}

async fn insert_instance(store: &ProviderStore) -> String {
    let instance_id = Uuid::new_v4().to_string();
    let now = now_rfc3339().expect("time");
    sqlx::query(
        "INSERT INTO provider_instances (
            id, preset_slug, name, base_url, description, icon, priority, meta,
            is_enabled, is_local, credentials_ref, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&instance_id)
    .bind("openai")
    .bind("Local OpenAI")
    .bind("https://example.com")
    .bind::<Option<&str>>(None)
    .bind::<Option<&str>>(None)
    .bind(0_i64)
    .bind("{}")
    .bind(1_i64)
    .bind(1_i64)
    .bind(format!("db:{instance_id}"))
    .bind(&now)
    .bind(&now)
    .execute(&store.pool)
    .await
    .expect("insert provider instance");
    instance_id
}

async fn insert_instance_with_preset(
    store: &ProviderStore,
    preset_slug: &str,
    name: &str,
    base_url: &str,
) -> String {
    insert_instance_with_preset_and_meta(store, preset_slug, name, base_url, "{}").await
}

async fn insert_instance_with_preset_and_meta(
    store: &ProviderStore,
    preset_slug: &str,
    name: &str,
    base_url: &str,
    meta: &str,
) -> String {
    let instance_id = Uuid::new_v4().to_string();
    let now = now_rfc3339().expect("time");
    sqlx::query(
        "INSERT INTO provider_instances (
            id, preset_slug, name, base_url, description, icon, priority, meta,
            is_enabled, is_local, credentials_ref, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&instance_id)
    .bind(preset_slug)
    .bind(name)
    .bind(base_url)
    .bind::<Option<&str>>(None)
    .bind::<Option<&str>>(None)
    .bind(0_i64)
    .bind(meta)
    .bind(1_i64)
    .bind(1_i64)
    .bind(format!("db:{instance_id}"))
    .bind(&now)
    .bind(&now)
    .execute(&store.pool)
    .await
    .expect("insert provider instance");
    instance_id
}

#[tokio::test]
async fn create_instance_persists_protocol_meta_fields() {
    let store = init_store().await;

    let instance = store
        .create_instance(crate::modules::providers::types::CreateInstanceRequest {
            preset_slug: "openai".to_string(),
            name: "Anthropic Instance".to_string(),
            base_url: "https://api.anthropic.com".to_string(),
            chat_transport_path: None,
            description: None,
            icon: None,
            priority: Some(0),
            protocol: Some("anthropic".to_string()),
            model_prefix: None,
            auto_append_v1: Some(false),
            resource_name: None,
            deployment_name: None,
            api_version: None,
            project_id: None,
            region: None,
            app_id: None,
            is_local: Some(false),
            credential_source: Some("local".to_string()),
            secret_key: None,
        })
        .await
        .expect("create instance");

    assert_eq!(instance.meta["protocol"], json!("anthropic"));
    assert_eq!(instance.meta["auto_append_v1"], json!(false));
}

#[tokio::test]
async fn update_instance_persists_protocol_meta_fields() {
    let store = init_store().await;
    let created = store
        .create_instance(crate::modules::providers::types::CreateInstanceRequest {
            preset_slug: "openai".to_string(),
            name: "Editable Instance".to_string(),
            base_url: "https://api.example.com".to_string(),
            chat_transport_path: None,
            description: None,
            icon: None,
            priority: Some(0),
            protocol: Some("openai".to_string()),
            model_prefix: None,
            auto_append_v1: Some(true),
            resource_name: None,
            deployment_name: None,
            api_version: None,
            project_id: None,
            region: None,
            app_id: None,
            is_local: Some(false),
            credential_source: Some("local".to_string()),
            secret_key: None,
        })
        .await
        .expect("create instance");

    let updated = store
        .update_instance(
            &created.id.to_string(),
            crate::modules::providers::types::UpdateInstanceRequest {
                name: None,
                base_url: None,
                chat_transport_path: None,
                credential_source: None,
                description: None,
                icon: None,
                priority: None,
                protocol: Some("anthropic".to_string()),
                model_prefix: None,
                auto_append_v1: Some(false),
                resource_name: None,
                deployment_name: None,
                api_version: None,
                project_id: None,
                region: None,
                app_id: None,
                is_enabled: None,
                secret_key: None,
            },
        )
        .await
        .expect("update instance");

    assert_eq!(updated.meta["protocol"], json!("anthropic"));
    assert_eq!(updated.meta["auto_append_v1"], json!(false));
}

#[tokio::test]
async fn record_feedback_simple_persists_bandit_state_with_shared_memory_pool() {
    let store = init_store().await;

    let first = store
        .record_feedback_simple("router:prompt", "variant-a", true, Some(120.0))
        .await
        .expect("record first feedback");
    let second = store
        .record_feedback_simple("router:prompt", "variant-a", false, None)
        .await
        .expect("record second feedback");
    let persisted = store
        .get_bandit_arm_state("router:prompt", "variant-a")
        .await
        .expect("load bandit state")
        .expect("bandit state exists");

    assert_eq!(first.total_trials, 1);
    assert_eq!(second.total_trials, 2);
    assert_eq!(persisted.total_trials, 2);
    assert_eq!(persisted.successes, 1);
    assert_eq!(persisted.failures, 1);
}

#[tokio::test]
async fn get_instance_connection_falls_back_to_preset_provider_protocol() {
    let store = init_store().await;
    let now = now_rfc3339().expect("time");
    let instance_id = Uuid::new_v4().to_string();

    store
        .replace_presets(vec![crate::modules::providers::types::ProviderPreset {
            slug: "anthropic".to_string(),
            name: "Anthropic".to_string(),
            provider: "anthropic".to_string(),
            base_url: "https://api.anthropic.com".to_string(),
            icon: None,
            theme_color: None,
            category: Some("cloud".to_string()),
            url_template: None,
            auth_type: "api_key".to_string(),
            auth_config: json!({}),
            protocol_schema_version: None,
            protocol_profiles: json!({}),
            version: 1,
            is_active: true,
        }])
        .await
        .expect("replace presets");

    sqlx::query(
        "INSERT INTO provider_instances (
            id, preset_slug, name, base_url, description, icon, priority, meta,
            is_enabled, is_local, credentials_ref, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&instance_id)
    .bind("anthropic")
    .bind("Claude")
    .bind("https://api.anthropic.com")
    .bind::<Option<&str>>(None)
    .bind::<Option<&str>>(None)
    .bind(0_i64)
    .bind("{}")
    .bind(1_i64)
    .bind(0_i64)
    .bind(format!("db:{instance_id}"))
    .bind(&now)
    .bind(&now)
    .execute(&store.pool)
    .await
    .expect("insert provider instance");

    let connection = store
        .get_instance_connection(&instance_id)
        .await
        .expect("get instance connection")
        .expect("connection should exist");

    assert_eq!(connection.protocol.as_deref(), Some("anthropic"));
}

#[tokio::test]
async fn get_instance_connection_prefers_anthropic_preset_for_official_base_url() {
    let store = init_store().await;
    let now = now_rfc3339().expect("time");
    let instance_id = Uuid::new_v4().to_string();

    store
        .replace_presets(vec![crate::modules::providers::types::ProviderPreset {
            slug: "anthropic".to_string(),
            name: "Anthropic".to_string(),
            provider: "anthropic".to_string(),
            base_url: "https://api.anthropic.com".to_string(),
            icon: None,
            theme_color: None,
            category: Some("cloud".to_string()),
            url_template: None,
            auth_type: "api_key".to_string(),
            auth_config: json!({}),
            protocol_schema_version: None,
            protocol_profiles: json!({}),
            version: 1,
            is_active: true,
        }])
        .await
        .expect("replace presets");

    sqlx::query(
        "INSERT INTO provider_instances (
            id, preset_slug, name, base_url, description, icon, priority, meta,
            is_enabled, is_local, credentials_ref, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&instance_id)
    .bind("anthropic")
    .bind("Claude Official")
    .bind("https://api.anthropic.com")
    .bind::<Option<&str>>(None)
    .bind::<Option<&str>>(None)
    .bind(0_i64)
    .bind(r#"{"protocol":"openai"}"#)
    .bind(1_i64)
    .bind(0_i64)
    .bind(format!("db:{instance_id}"))
    .bind(&now)
    .bind(&now)
    .execute(&store.pool)
    .await
    .expect("insert provider instance");

    let connection = store
        .get_instance_connection(&instance_id)
        .await
        .expect("get instance connection")
        .expect("connection should exist");

    assert_eq!(connection.protocol.as_deref(), Some("anthropic"));
}

#[tokio::test]
async fn update_user_secretary_persists_provider_model_id() {
    let store = init_store().await;

    let created = store
        .get_or_create_user_secretary()
        .await
        .expect("create default secretary");
    assert_eq!(created.provider_model_id, None);

    let updated = store
        .update_user_secretary(
            crate::modules::providers::types::UserSecretaryUpdateRequest {
                model_name: Some(Some("gpt-4o-mini".to_string())),
                provider_model_id: Some(Some("22222222-2222-4222-8222-222222222222".to_string())),
            },
        )
        .await
        .expect("update secretary");

    assert_eq!(updated.model_name.as_deref(), Some("gpt-4o-mini"));
    assert_eq!(
        updated.provider_model_id.as_deref(),
        Some("22222222-2222-4222-8222-222222222222")
    );

    let reloaded = store
        .get_or_create_user_secretary()
        .await
        .expect("reload secretary");
    assert_eq!(
        reloaded.provider_model_id.as_deref(),
        Some("22222222-2222-4222-8222-222222222222")
    );
}

#[tokio::test]
async fn init_migrates_legacy_provider_models_before_index_creation() {
    let store = ProviderStore::new("sqlite::memory:")
        .await
        .expect("failed to create provider store")
        .with_provider_market_file(isolated_provider_market_file_path());

    sqlx::query(
        "CREATE TABLE provider_models (
            id TEXT PRIMARY KEY,
            instance_id TEXT NOT NULL,
            model_id TEXT NOT NULL,
            display_name TEXT,
            is_active BOOLEAN DEFAULT 1
        )",
    )
    .execute(&store.pool)
    .await
    .expect("failed to create legacy provider_models");

    store
        .init()
        .await
        .expect("provider init should migrate legacy schema");

    let columns = sqlx::query("PRAGMA table_info(provider_models)")
        .fetch_all(&store.pool)
        .await
        .expect("failed to inspect provider_models");
    let names: Vec<String> = columns
        .iter()
        .filter_map(|row| row.try_get::<String, _>("name").ok())
        .collect();

    assert!(names.iter().any(|name| name == "upstream_path"));
    assert!(names.iter().any(|name| name == "unified_model_id"));
}

#[tokio::test]
async fn init_drops_provider_presets_table() {
    let store = ProviderStore::new("sqlite::memory:")
        .await
        .expect("failed to create provider store")
        .with_provider_market_file(isolated_provider_market_file_path());

    sqlx::query(
        "CREATE TABLE provider_presets (
            slug TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            provider TEXT NOT NULL,
            base_url TEXT NOT NULL,
            icon TEXT,
            theme_color TEXT,
            category TEXT,
            url_template TEXT,
            template_engine TEXT,
            response_transform TEXT,
            auth_type TEXT NOT NULL DEFAULT 'api_key',
            auth_config TEXT NOT NULL DEFAULT '{}',
            default_headers TEXT NOT NULL DEFAULT '{}',
            default_params TEXT NOT NULL DEFAULT '{}',
            capability_configs TEXT NOT NULL DEFAULT '{}',
            protocol_schema_version TEXT,
            protocol_profiles TEXT NOT NULL DEFAULT '{}',
            version INTEGER NOT NULL DEFAULT 1,
            is_active BOOLEAN DEFAULT 1
        )",
    )
    .execute(&store.pool)
    .await
    .expect("failed to create legacy provider_presets");

    store
        .init()
        .await
        .expect("provider init should drop provider_presets");

    let table = sqlx::query(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'provider_presets'",
    )
    .fetch_optional(&store.pool)
    .await
    .expect("failed to inspect provider_presets");

    assert!(table.is_none());
}

#[tokio::test]
async fn init_backfills_anthropic_protocol_meta_for_official_instances() {
    let store = ProviderStore::new("sqlite::memory:")
        .await
        .expect("failed to create provider store")
        .with_provider_market_file(isolated_provider_market_file_path());

    store
        .replace_presets(vec![crate::modules::providers::types::ProviderPreset {
            slug: "anthropic".to_string(),
            name: "Anthropic".to_string(),
            provider: "anthropic".to_string(),
            base_url: "https://api.anthropic.com".to_string(),
            icon: None,
            theme_color: None,
            category: Some("cloud".to_string()),
            url_template: None,
            auth_type: "api_key".to_string(),
            auth_config: json!({}),
            protocol_schema_version: None,
            protocol_profiles: json!({}),
            version: 1,
            is_active: true,
        }])
        .await
        .expect("replace presets");

    sqlx::query(
        "CREATE TABLE provider_instances (
            id TEXT PRIMARY KEY,
            preset_slug TEXT NOT NULL,
            name TEXT NOT NULL,
            base_url TEXT NOT NULL,
            meta TEXT NOT NULL DEFAULT '{}',
            is_enabled BOOLEAN NOT NULL DEFAULT 1,
            is_local BOOLEAN DEFAULT 0,
            credentials_ref TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
    )
    .execute(&store.pool)
    .await
    .expect("failed to create provider_instances");

    let now = now_rfc3339().expect("time");
    let missing_protocol_id = Uuid::new_v4().to_string();
    let wrong_protocol_id = Uuid::new_v4().to_string();
    let proxy_protocol_id = Uuid::new_v4().to_string();

    for (instance_id, base_url, meta) in [
        (&missing_protocol_id, "https://api.anthropic.com", "{}"),
        (
            &wrong_protocol_id,
            "https://api.anthropic.com/v1",
            r#"{"protocol":"openai"}"#,
        ),
        (
            &proxy_protocol_id,
            "https://anthropic-proxy.example.com/v1",
            r#"{"protocol":"openai"}"#,
        ),
    ] {
        sqlx::query(
            "INSERT INTO provider_instances (
                id, preset_slug, name, base_url, meta, is_enabled, is_local, credentials_ref, created_at, updated_at
            ) VALUES (?, 'anthropic', 'Claude', ?, ?, 1, 0, ?, ?, ?)",
        )
        .bind(instance_id)
        .bind(base_url)
        .bind(meta)
        .bind(format!("db:{instance_id}"))
        .bind(&now)
        .bind(&now)
        .execute(&store.pool)
        .await
        .expect("insert instance");
    }

    store
        .init()
        .await
        .expect("provider init should backfill protocol");

    let missing_protocol = store
        .get_instance(&missing_protocol_id)
        .await
        .expect("fetch missing protocol instance")
        .expect("missing protocol instance should exist");
    let wrong_protocol = store
        .get_instance(&wrong_protocol_id)
        .await
        .expect("fetch wrong protocol instance")
        .expect("wrong protocol instance should exist");
    let proxy_protocol = store
        .get_instance(&proxy_protocol_id)
        .await
        .expect("fetch proxy protocol instance")
        .expect("proxy protocol instance should exist");

    assert_eq!(
        missing_protocol
            .meta
            .get("protocol")
            .and_then(|value| value.as_str()),
        Some("anthropic")
    );
    assert_eq!(
        wrong_protocol
            .meta
            .get("protocol")
            .and_then(|value| value.as_str()),
        Some("anthropic")
    );
    assert_eq!(
        proxy_protocol
            .meta
            .get("protocol")
            .and_then(|value| value.as_str()),
        Some("openai")
    );
}

#[tokio::test]
async fn quick_add_models_infers_capabilities_and_upstream_paths() {
    let store = init_store().await;
    let instance_id = insert_instance(&store).await;

    store
        .quick_add_models(
            &instance_id,
            vec![
                "gpt-4o-mini".to_string(),
                "text-embedding-3-small".to_string(),
                "bge-reranker-v2-m3".to_string(),
                "grok-imagine-1.0".to_string(),
                "grok-video".to_string(),
                "gemini-nano-banana-preview".to_string(),
                "gemini-banana-preview".to_string(),
            ],
            None,
        )
        .await
        .expect("quick add models");

    let models = store
        .list_models(Some(instance_id.clone()), None)
        .await
        .expect("list models");
    assert_eq!(models.len(), 7);

    let chat = models
        .iter()
        .find(|model| model.model_id == "gpt-4o-mini")
        .expect("chat model");
    assert_eq!(chat.capabilities, vec![CHAT_CAPABILITY.to_string()]);
    assert_eq!(chat.upstream_path, CHAT_UPSTREAM_PATH);

    let embedding = models
        .iter()
        .find(|model| model.model_id == "text-embedding-3-small")
        .expect("embedding model");
    assert_eq!(embedding.capabilities, vec!["embedding".to_string()]);
    assert_eq!(embedding.upstream_path, "v1/embeddings");

    let reranker = models
        .iter()
        .find(|model| model.model_id == "bge-reranker-v2-m3")
        .expect("reranker model");
    assert_eq!(reranker.capabilities, vec!["embedding".to_string()]);
    assert_eq!(reranker.upstream_path, "v1/embeddings");

    let image = models
        .iter()
        .find(|model| model.model_id == "grok-imagine-1.0")
        .expect("image model");
    assert_eq!(image.capabilities, vec!["image_generation".to_string()]);
    assert_eq!(image.upstream_path, "v1/images/generations");

    let video = models
        .iter()
        .find(|model| model.model_id == "grok-video")
        .expect("video model");
    assert_eq!(video.capabilities, vec!["video_generation".to_string()]);
    assert_eq!(video.upstream_path, "v1/video/generations");

    let nano_banana = models
        .iter()
        .find(|model| model.model_id == "gemini-nano-banana-preview")
        .expect("nano banana image model");
    assert_eq!(
        nano_banana.capabilities,
        vec!["image_generation".to_string()]
    );
    assert_eq!(nano_banana.upstream_path, "v1/images/generations");

    let banana = models
        .iter()
        .find(|model| model.model_id == "gemini-banana-preview")
        .expect("banana image model");
    assert_eq!(banana.capabilities, vec!["image_generation".to_string()]);
    assert_eq!(banana.upstream_path, "v1/images/generations");

    for model in models {
        assert_eq!(model.source, "manual");
    }
}

#[tokio::test]
async fn reconcile_synced_models_soft_deletes_missing_and_preserves_edited_capabilities() {
    let store = init_store().await;
    let instance_id = insert_instance(&store).await;

    store
        .quick_add_models(
            &instance_id,
            vec!["gpt-4o-mini".to_string(), "legacy-model".to_string()],
            None,
        )
        .await
        .expect("seed models");

    let seeded = store
        .list_models(Some(instance_id.clone()), None)
        .await
        .expect("list seeded models");
    let gpt_row = seeded
        .iter()
        .find(|m| m.model_id == "gpt-4o-mini")
        .expect("gpt row");
    store
        .update_model(
            &gpt_row.id,
            crate::modules::providers::types::ProviderModelUpdateRequest {
                display_name: None,
                is_active: None,
                capabilities: Some(vec!["embedding".to_string()]),
                unified_model_id: None,
                upstream_path: None,
                weight: None,
                priority: None,
                pricing_config: None,
                limit_config: None,
                tokenizer_config: None,
                routing_config: None,
                config_override: None,
                source: None,
                extra_meta: None,
            },
        )
        .await
        .expect("user-edit capabilities");

    store
        .reconcile_synced_models(
            &instance_id,
            vec!["gpt-4o-mini".to_string(), "gpt-4o-new".to_string()],
        )
        .await
        .expect("reconcile");

    let models = store
        .list_models(Some(instance_id), None)
        .await
        .expect("list post-reconcile");

    let gpt = models
        .iter()
        .find(|m| m.model_id == "gpt-4o-mini")
        .expect("gpt preserved");
    assert!(gpt.is_active, "present model should stay active");
    assert_eq!(
        gpt.capabilities,
        vec!["embedding".to_string()],
        "user-edited capabilities must survive reconcile"
    );

    let new_model = models
        .iter()
        .find(|m| m.model_id == "gpt-4o-new")
        .expect("new model inserted");
    assert!(new_model.is_active);
    assert_eq!(new_model.source, "synced");

    let legacy = models
        .iter()
        .find(|m| m.model_id == "legacy-model")
        .expect("legacy row kept for history");
    assert!(
        !legacy.is_active,
        "missing model should be soft-deleted, not hard-deleted"
    );
}

#[tokio::test]
async fn reconcile_synced_models_reactivates_previously_soft_deleted_model() {
    let store = init_store().await;
    let instance_id = insert_instance(&store).await;

    store
        .quick_add_models(&instance_id, vec!["gpt-4o-mini".to_string()], None)
        .await
        .expect("seed");

    store
        .reconcile_synced_models(&instance_id, vec![])
        .await
        .expect("reconcile with empty remote soft-deletes everything");

    let after_clear = store
        .list_models(Some(instance_id.clone()), None)
        .await
        .expect("list after clear");
    assert_eq!(after_clear.len(), 1);
    assert!(!after_clear[0].is_active);

    store
        .reconcile_synced_models(&instance_id, vec!["gpt-4o-mini".to_string()])
        .await
        .expect("reconcile brings it back");

    let after_revive = store
        .list_models(Some(instance_id), None)
        .await
        .expect("list after revive");
    assert_eq!(after_revive.len(), 1, "should reactivate, not duplicate");
    assert!(after_revive[0].is_active);
}

#[tokio::test]
async fn quick_add_models_is_idempotent_for_same_model_and_instance() {
    let store = init_store().await;
    let instance_id = insert_instance(&store).await;

    store
        .quick_add_models(&instance_id, vec!["gpt-4o-mini".to_string()], None)
        .await
        .expect("first quick add");
    store
        .quick_add_models(&instance_id, vec!["gpt-4o-mini".to_string()], None)
        .await
        .expect("second quick add");

    let models = store
        .list_models(Some(instance_id), None)
        .await
        .expect("list models");
    assert_eq!(models.len(), 1);
    assert_eq!(models[0].model_id, "gpt-4o-mini");
}

#[tokio::test]
async fn list_active_models_excludes_disabled_instances() {
    let store = init_store().await;
    let disabled_instance_id = insert_instance_with_preset(
        &store,
        "custom",
        "Disabled Provider",
        "https://disabled.example.com",
    )
    .await;
    let enabled_instance_id = insert_instance_with_preset(
        &store,
        "custom",
        "Enabled Provider",
        "https://enabled.example.com",
    )
    .await;

    store
        .quick_add_models(
            &disabled_instance_id,
            vec!["mimo-v2.5-pro".to_string()],
            None,
        )
        .await
        .expect("quick add disabled provider model");
    store
        .quick_add_models(
            &enabled_instance_id,
            vec!["mimo-v2.5-pro".to_string()],
            None,
        )
        .await
        .expect("quick add enabled provider model");

    sqlx::query("UPDATE provider_instances SET is_enabled = 0 WHERE id = ?")
        .bind(&disabled_instance_id)
        .execute(&store.pool)
        .await
        .expect("disable provider instance");

    let active_models = store
        .list_active_models()
        .await
        .expect("list active models");

    assert_eq!(active_models.len(), 1);
    assert_eq!(
        active_models[0].instance_id.to_string(),
        enabled_instance_id
    );
}

#[tokio::test]
async fn quick_add_models_respects_forced_capability_alias() {
    let store = init_store().await;
    let instance_id = insert_instance(&store).await;

    store
        .quick_add_models(&instance_id, vec!["gpt-4o-mini".to_string()], Some("image"))
        .await
        .expect("quick add models");

    let models = store
        .list_models(Some(instance_id), None)
        .await
        .expect("list models");
    assert_eq!(models.len(), 1);
    assert_eq!(models[0].capabilities, vec!["image_generation".to_string()]);
    assert_eq!(models[0].upstream_path, "v1/images/generations");
}

#[tokio::test]
async fn quick_add_models_prefers_system_preset_chat_transport_path() {
    let store = init_store().await;

    store
        .replace_presets(vec![crate::modules::providers::types::ProviderPreset {
            slug: "anthropic".to_string(),
            name: "Anthropic".to_string(),
            provider: "anthropic".to_string(),
            base_url: "https://api.anthropic.com".to_string(),
            icon: None,
            theme_color: None,
            category: Some("cloud".to_string()),
            url_template: None,
            auth_type: "api_key".to_string(),
            auth_config: json!({}),
            protocol_schema_version: Some("2026-03-07".to_string()),
            protocol_profiles: json!({
                "chat": {
                    "transport": {
                        "path": "v1/messages"
                    }
                }
            }),
            version: 1,
            is_active: true,
        }])
        .await
        .expect("replace presets");

    let instance_id =
        insert_instance_with_preset(&store, "anthropic", "Claude", "https://api.anthropic.com")
            .await;

    store
        .quick_add_models(&instance_id, vec!["claude-sonnet-4-6".to_string()], None)
        .await
        .expect("quick add models");

    let models = store
        .list_models(Some(instance_id), None)
        .await
        .expect("list models");
    assert_eq!(models.len(), 1);
    assert_eq!(models[0].upstream_path, "v1/messages");
}

#[tokio::test]
async fn quick_add_models_keeps_default_chat_path_for_custom_preset() {
    let store = init_store().await;

    store
        .replace_presets(vec![crate::modules::providers::types::ProviderPreset {
            slug: "custom".to_string(),
            name: "Custom".to_string(),
            provider: "custom".to_string(),
            base_url: "https://example.com".to_string(),
            icon: None,
            theme_color: None,
            category: Some("cloud".to_string()),
            url_template: None,
            auth_type: "api_key".to_string(),
            auth_config: json!({}),
            protocol_schema_version: Some("2026-03-07".to_string()),
            protocol_profiles: json!({
                "chat": {
                    "transport": {
                        "path": "v1/messages"
                    }
                }
            }),
            version: 1,
            is_active: true,
        }])
        .await
        .expect("replace presets");

    let instance_id =
        insert_instance_with_preset(&store, "custom", "Custom Claude", "https://example.com").await;

    store
        .quick_add_models(&instance_id, vec!["claude-sonnet-4-6".to_string()], None)
        .await
        .expect("quick add models");

    let models = store
        .list_models(Some(instance_id), None)
        .await
        .expect("list models");
    assert_eq!(models.len(), 1);
    assert_eq!(models[0].upstream_path, "v1/chat/completions");
}

#[tokio::test]
async fn quick_add_models_prefers_custom_instance_chat_transport_path() {
    let store = init_store().await;

    let instance_id = insert_instance_with_preset_and_meta(
        &store,
        "custom",
        "Custom Anthropic",
        "https://api.anthropic.com",
        r#"{"chat_transport_path":"v1/messages"}"#,
    )
    .await;

    store
        .quick_add_models(&instance_id, vec!["claude-sonnet-4-6".to_string()], None)
        .await
        .expect("quick add models");

    let models = store
        .list_models(Some(instance_id), None)
        .await
        .expect("list models");
    assert_eq!(models.len(), 1);
    assert_eq!(models[0].upstream_path, "v1/messages");
}

#[tokio::test]
async fn quick_add_models_deactivates_stale_same_model_with_old_path() {
    let store = init_store().await;

    store
        .replace_presets(vec![crate::modules::providers::types::ProviderPreset {
            slug: "anthropic".to_string(),
            name: "Anthropic".to_string(),
            provider: "anthropic".to_string(),
            base_url: "https://api.anthropic.com".to_string(),
            icon: None,
            theme_color: None,
            category: Some("cloud".to_string()),
            url_template: None,
            auth_type: "api_key".to_string(),
            auth_config: json!({}),
            protocol_schema_version: Some("2026-03-07".to_string()),
            protocol_profiles: json!({
                "chat": {
                    "transport": {
                        "path": "v1/messages"
                    }
                }
            }),
            version: 1,
            is_active: true,
        }])
        .await
        .expect("replace presets");

    let instance_id =
        insert_instance_with_preset(&store, "anthropic", "Claude", "https://api.anthropic.com")
            .await;
    let now = now_rfc3339().expect("time");

    sqlx::query(
        "INSERT INTO provider_models (
            id, instance_id, capabilities, model_id, display_name, upstream_path,
            pricing_config, limit_config, tokenizer_config, routing_config,
            config_override, source, extra_meta, weight, priority,
            is_active, synced_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, '{}', '{}', '{}', '{}', '{}', 'manual', '{}', 100, 0, 1, ?, ?, ?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&instance_id)
    .bind("[\"chat\"]")
    .bind("claude-sonnet-4-6")
    .bind("claude-sonnet-4-6")
    .bind("v1/chat/completions")
    .bind(&now)
    .bind(&now)
    .bind(&now)
    .execute(&store.pool)
    .await
    .expect("insert stale model");

    store
        .quick_add_models(&instance_id, vec!["claude-sonnet-4-6".to_string()], None)
        .await
        .expect("quick add models");

    let rows = sqlx::query(
        "SELECT upstream_path, is_active FROM provider_models
         WHERE instance_id = ? AND model_id = ?
         ORDER BY upstream_path ASC",
    )
    .bind(&instance_id)
    .bind("claude-sonnet-4-6")
    .fetch_all(&store.pool)
    .await
    .expect("fetch rows");

    assert_eq!(rows.len(), 2);
    let states: Vec<(String, i64)> = rows
        .into_iter()
        .map(|row| {
            (
                row.try_get::<String, _>("upstream_path").expect("path"),
                row.try_get::<i64, _>("is_active").expect("active"),
            )
        })
        .collect();
    assert_eq!(
        states,
        vec![
            ("v1/chat/completions".to_string(), 0),
            ("v1/messages".to_string(), 1),
        ]
    );
}

#[tokio::test]
async fn normalize_model_capability_data_backfills_routing_and_upstream_caps() {
    let store = init_store().await;
    let instance_id = insert_instance(&store).await;
    let model_id = Uuid::new_v4().to_string();
    let now = now_rfc3339().expect("time");

    sqlx::query(
        "INSERT INTO provider_models (
            id, instance_id, capabilities, model_id, display_name, upstream_path,
            pricing_config, limit_config, tokenizer_config, routing_config,
            config_override, source, extra_meta, weight, priority,
            is_active, synced_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, '{}', '{}', '{}', ?, '{}', 'manual', ?, 100, 0, 1, ?, ?, ?)",
    )
    .bind(&model_id)
    .bind(&instance_id)
    .bind("[]")
    .bind("wanx-routing-only")
    .bind("Wanx Routing Only")
    .bind("v1/videos/generations")
    .bind(r#"{"capabilities":["video"]}"#)
    .bind(r#"{"upstream_capabilities":["video_generation"]}"#)
    .bind(&now)
    .bind(&now)
    .bind(&now)
    .execute(&store.pool)
    .await
    .expect("insert model");

    store
        .normalize_model_capability_data()
        .await
        .expect("normalize capabilities");

    let models = store
        .list_models(Some(instance_id), None)
        .await
        .expect("list models");
    assert_eq!(models.len(), 1);
    assert_eq!(models[0].capabilities, vec!["video_generation".to_string()]);
}

#[tokio::test]
async fn update_model_mirrors_routing_capabilities_to_capabilities() {
    let store = init_store().await;
    let instance_id = insert_instance(&store).await;

    store
        .quick_add_models(&instance_id, vec!["gpt-4o-mini".to_string()], None)
        .await
        .expect("quick add models");

    let models = store
        .list_models(Some(instance_id), None)
        .await
        .expect("list models");
    let model = models.first().expect("model available");

    let updated = store
        .update_model(
            &model.id,
            crate::modules::providers::types::ProviderModelUpdateRequest {
                display_name: None,
                is_active: None,
                capabilities: None,
                unified_model_id: None,
                upstream_path: None,
                weight: None,
                priority: None,
                pricing_config: None,
                limit_config: None,
                tokenizer_config: None,
                routing_config: Some(json!({ "capabilities": ["video"] })),
                config_override: None,
                source: None,
                extra_meta: None,
            },
        )
        .await
        .expect("update model");

    assert_eq!(updated.capabilities, vec!["video_generation".to_string()]);
    assert_eq!(
        updated.routing_config["capabilities"][0],
        json!("video_generation")
    );
}

#[tokio::test]
async fn persist_secret_for_credential_writes_to_keychain_or_encrypted_db_fallback() {
    let store = init_store().await;

    let now = now_rfc3339().expect("failed to build timestamp");
    let instance_id = Uuid::new_v4().to_string();
    let credential_id = Uuid::new_v4().to_string();
    let secret = format!("test-secret-{}", Uuid::new_v4());

    sqlx::query(
        "INSERT INTO provider_instances (
            id, preset_slug, name, base_url, is_enabled, is_local, credentials_ref, created_at, updated_at
        ) VALUES (?, 'custom', 'test', 'http://localhost', 1, 1, ?, ?, ?)",
    )
    .bind(&instance_id)
    .bind(format!("db:{credential_id}"))
    .bind(&now)
    .bind(&now)
    .execute(&store.pool)
    .await
    .expect("failed to insert provider instance");

    sqlx::query(
        "INSERT INTO provider_credentials (id, instance_id, alias, secret_key, created_at)
         VALUES (?, ?, 'default', '', ?)",
    )
    .bind(&credential_id)
    .bind(&instance_id)
    .bind(&now)
    .execute(&store.pool)
    .await
    .expect("failed to insert provider credential");

    let _ = store.delete_secret_in_keychain(&credential_id);

    let mut tx = store
        .pool
        .begin()
        .await
        .expect("failed to begin transaction");
    store
        .persist_secret_for_credential(&mut tx, &credential_id, &secret)
        .await
        .expect("persist secret should succeed");
    tx.commit().await.expect("failed to commit transaction");

    let row = sqlx::query(
        "SELECT secret_key, secret_ciphertext, secret_key_version
         FROM provider_credentials
         WHERE id = ?",
    )
    .bind(&credential_id)
    .fetch_one(&store.pool)
    .await
    .expect("failed to fetch credential row");

    let stored_secret: String = row.try_get("secret_key").expect("secret_key readable");
    let encrypted_secret: String = row
        .try_get("secret_ciphertext")
        .expect("secret_ciphertext readable");
    let key_version: i64 = row
        .try_get("secret_key_version")
        .expect("secret_key_version readable");

    assert!(stored_secret.is_empty());
    assert!(!encrypted_secret.trim().is_empty());
    assert_eq!(key_version, 1);

    let _ = store.delete_secret_in_keychain(&credential_id);
    let resolved = store
        .resolve_secret_for_credential(
            &credential_id,
            Some(stored_secret.as_str()),
            Some(encrypted_secret.as_str()),
            key_version,
        )
        .expect("fallback decrypt should succeed");
    assert_eq!(resolved.as_deref(), Some(secret.as_str()));

    let _ = store.delete_secret_in_keychain(&credential_id);
}
