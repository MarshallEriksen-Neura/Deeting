use super::*;
use serde_json::json;
use sqlx::Row;
use uuid::Uuid;

async fn init_store() -> ProviderStore {
    let store = ProviderStore::new("sqlite::memory:")
        .await
        .expect("failed to create provider store");
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

#[tokio::test]
async fn init_migrates_legacy_provider_models_before_index_creation() {
    let store = ProviderStore::new("sqlite::memory:")
        .await
        .expect("failed to create provider store");

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
async fn quick_add_models_infers_capabilities_and_upstream_paths() {
    let store = init_store().await;
    let instance_id = insert_instance(&store).await;

    store
        .quick_add_models(
            &instance_id,
            vec![
                "gpt-4o-mini".to_string(),
                "text-embedding-3-small".to_string(),
                "grok-imagine-1.0".to_string(),
                "grok-video".to_string(),
            ],
            None,
        )
        .await
        .expect("quick add models");

    let models = store
        .list_models(Some(instance_id.clone()), None)
        .await
        .expect("list models");
    assert_eq!(models.len(), 4);

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

    for model in models {
        assert_eq!(model.source, "manual");
    }
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
