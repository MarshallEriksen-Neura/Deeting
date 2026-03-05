use super::*;
use uuid::Uuid;

async fn init_store() -> ProviderStore {
    let store = ProviderStore::new("sqlite::memory:")
        .await
        .expect("failed to create provider store");
    store.init().await.expect("provider init failed");
    store
}

async fn insert_instance(store: &ProviderStore) -> Uuid {
    let instance_id = Uuid::new_v4();
    let now = now_rfc3339().expect("time");
    sqlx::query(
        "INSERT INTO provider_instances (
            id, preset_slug, name, base_url, description, icon, priority, meta,
            is_enabled, is_local, credentials_ref, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(instance_id.to_string())
    .bind("openai")
    .bind("Local OpenAI")
    .bind("https://example.com")
    .bind::<Option<&str>>(None)
    .bind::<Option<&str>>(None)
    .bind(0_i64)
    .bind("{}")
    .bind(1_i64)
    .bind(1_i64)
    .bind("db:test")
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

    // Simulate legacy schema that existed before upstream_path/unified_model_id.
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

    assert!(
        names.iter().any(|name| name == "upstream_path"),
        "expected upstream_path to be added"
    );
    assert!(
        names.iter().any(|name| name == "unified_model_id"),
        "expected unified_model_id to be added"
    );
}

#[tokio::test]
async fn quick_add_models_infers_embedding_capability_and_path() {
    let store = init_store().await;
    let instance_id = insert_instance(&store).await;

    let added = store
        .quick_add_models(
            &instance_id,
            vec![
                "text-embedding-3-small".to_string(),
                "gpt-4o-mini".to_string(),
                "text-ada-002".to_string(),
            ],
            None,
        )
        .await
        .expect("quick add models");

    assert_eq!(added.len(), 3);

    let embed = added
        .iter()
        .find(|model| model.model_id == "text-embedding-3-small")
        .expect("embedding model");
    assert_eq!(embed.capabilities, vec![EMBEDDING_CAPABILITY.to_string()]);
    assert_eq!(embed.upstream_path, EMBEDDING_UPSTREAM_PATH);

    let ada = added
        .iter()
        .find(|model| model.model_id == "text-ada-002")
        .expect("ada model");
    assert_eq!(ada.capabilities, vec![EMBEDDING_CAPABILITY.to_string()]);
    assert_eq!(ada.upstream_path, EMBEDDING_UPSTREAM_PATH);

    let chat = added
        .iter()
        .find(|model| model.model_id == "gpt-4o-mini")
        .expect("chat model");
    assert_eq!(chat.capabilities, vec![CHAT_CAPABILITY.to_string()]);
    assert_eq!(chat.upstream_path, CHAT_UPSTREAM_PATH);
}

#[test]
fn infer_model_capability_covers_all_known_capabilities() {
    assert_eq!(
        infer_model_capability("nvidia/llama-3.2-nv-embedqa-1b-v1"),
        EMBEDDING_CAPABILITY
    );
    assert_eq!(
        infer_model_capability("openai/dall-e-3"),
        IMAGE_GENERATION_CAPABILITY
    );
    assert_eq!(
        infer_model_capability("openai/gpt-4o-mini-tts"),
        TEXT_TO_SPEECH_CAPABILITY
    );
    assert_eq!(
        infer_model_capability("openai/whisper-1"),
        SPEECH_TO_TEXT_CAPABILITY
    );
    assert_eq!(
        infer_model_capability("google/veo-2"),
        VIDEO_GENERATION_CAPABILITY
    );
    assert_eq!(infer_model_capability("openai/gpt-4o"), CHAT_CAPABILITY);
}

#[test]
fn default_upstream_path_for_capability_maps_all_known_capabilities() {
    assert_eq!(
        default_upstream_path_for_capability(EMBEDDING_CAPABILITY),
        EMBEDDING_UPSTREAM_PATH
    );
    assert_eq!(
        default_upstream_path_for_capability(IMAGE_GENERATION_CAPABILITY),
        IMAGE_GENERATION_UPSTREAM_PATH
    );
    assert_eq!(
        default_upstream_path_for_capability(TEXT_TO_SPEECH_CAPABILITY),
        TEXT_TO_SPEECH_UPSTREAM_PATH
    );
    assert_eq!(
        default_upstream_path_for_capability(SPEECH_TO_TEXT_CAPABILITY),
        SPEECH_TO_TEXT_UPSTREAM_PATH
    );
    assert_eq!(
        default_upstream_path_for_capability(VIDEO_GENERATION_CAPABILITY),
        VIDEO_GENERATION_UPSTREAM_PATH
    );
    assert_eq!(
        default_upstream_path_for_capability(CHAT_CAPABILITY),
        CHAT_UPSTREAM_PATH
    );
}

#[tokio::test]
async fn quick_add_models_prefers_explicit_capability_over_inference() {
    let store = init_store().await;
    let instance_id = insert_instance(&store).await;

    let added = store
        .quick_add_models(
            &instance_id,
            vec!["text-embedding-3-small".to_string()],
            Some("chat".to_string()),
        )
        .await
        .expect("quick add models");

    assert_eq!(added.len(), 1);
    assert_eq!(added[0].capabilities, vec!["chat".to_string()]);
    assert_eq!(added[0].upstream_path, CHAT_UPSTREAM_PATH);
}

#[tokio::test]
async fn quick_add_models_reconciles_legacy_auto_rows_without_duplicates() {
    let store = init_store().await;
    let instance_id = insert_instance(&store).await;

    let first = store
        .quick_add_models(
            &instance_id,
            vec!["text-embedding-3-small".to_string()],
            Some("chat".to_string()),
        )
        .await
        .expect("first quick add");
    assert_eq!(first.len(), 1);
    assert_eq!(first[0].capabilities, vec![CHAT_CAPABILITY.to_string()]);
    assert_eq!(first[0].upstream_path, CHAT_UPSTREAM_PATH);

    let second = store
        .quick_add_models(
            &instance_id,
            vec!["text-embedding-3-small".to_string()],
            None,
        )
        .await
        .expect("second quick add");
    assert_eq!(second.len(), 1);
    assert_eq!(second[0].capabilities, vec![EMBEDDING_CAPABILITY.to_string()]);
    assert_eq!(second[0].upstream_path, EMBEDDING_UPSTREAM_PATH);

    let all_models = store
        .list_models(&instance_id)
        .await
        .expect("list models after reconcile");
    assert_eq!(all_models.len(), 1);
    assert_eq!(
        all_models[0].capabilities,
        vec![EMBEDDING_CAPABILITY.to_string()]
    );
    assert_eq!(all_models[0].upstream_path, EMBEDDING_UPSTREAM_PATH);
}

#[tokio::test]
async fn persist_secret_for_credential_writes_to_keychain_or_fallback_db() {
    let store = ProviderStore::new("sqlite::memory:")
        .await
        .expect("failed to create provider store");
    store
        .init()
        .await
        .expect("failed to initialize provider store");

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

    // Ensure this test starts from a clean keychain slot.
    let _ = store.delete_secret_in_keychain(&credential_id);

    let mut tx = store.pool.begin().await.expect("failed to begin transaction");
    store
        .persist_secret_for_credential(&mut tx, &credential_id, &secret)
        .await
        .expect("persist secret should succeed");
    tx.commit().await.expect("failed to commit transaction");

    let row = sqlx::query("SELECT secret_key FROM provider_credentials WHERE id = ?")
        .bind(&credential_id)
        .fetch_one(&store.pool)
        .await
        .expect("failed to fetch credential row");
    let stored_secret: String = row
        .try_get("secret_key")
        .expect("secret_key should be readable");

    if stored_secret.is_empty() {
        let keychain_secret = store
            .get_secret_from_keychain(&credential_id)
            .expect("keychain read should succeed when db plaintext is empty");
        assert_eq!(
            keychain_secret.as_deref(),
            Some(secret.as_str()),
            "expected keychain to contain latest secret",
        );
    } else {
        assert_eq!(
            stored_secret, secret,
            "expected fallback mode to keep secret in local db",
        );
    }

    let _ = store.delete_secret_in_keychain(&credential_id);
}
