use app_lib::modules::providers::store::ProviderStore;
use app_lib::modules::providers::types::CreateInstanceRequest;
use keyring::Entry;
use sqlx::Row;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const PROVIDER_KEYCHAIN_SERVICE: &str = "deeting.provider";

fn build_probe_db_path() -> PathBuf {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    std::env::temp_dir().join(format!("deeting-provider-probe-{ts}.db"))
}

fn to_sqlite_url(path: &Path) -> String {
    let raw = path.to_string_lossy().replace('\\', "/");
    format!("sqlite://{raw}")
}

fn parse_credential_id(credentials_ref: &str) -> Option<String> {
    let trimmed = credentials_ref.trim();
    if trimmed.starts_with("db:") {
        Some(trimmed.trim_start_matches("db:").trim().to_string())
    } else {
        None
    }
}

fn run_direct_keyring_probe() {
    let probe_id = format!("direct-probe-{}", uuid::Uuid::new_v4());
    let probe_value = format!("direct-secret-{}", uuid::Uuid::new_v4());
    println!("[direct] probing keyring backend with id={probe_id}");

    let entry = match Entry::new(PROVIDER_KEYCHAIN_SERVICE, &probe_id) {
        Ok(v) => v,
        Err(err) => {
            println!("[direct] entry.new error: {err}");
            return;
        }
    };

    match entry.set_password(&probe_value) {
        Ok(_) => println!("[direct] set_password ok"),
        Err(err) => {
            println!("[direct] set_password error: {err}");
            return;
        }
    }

    match entry.get_password() {
        Ok(v) => println!("[direct] get_password ok, matches={}", v == probe_value),
        Err(err) => println!("[direct] get_password error: {err}"),
    }

    match entry.delete_credential() {
        Ok(_) => println!("[direct] delete_credential ok"),
        Err(err) => println!("[direct] delete_credential error: {err}"),
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let db_path = build_probe_db_path();
    let database_url = to_sqlite_url(&db_path);
    let probe_secret = format!(
        "probe-secret-{}",
        uuid::Uuid::new_v4().to_string().replace('-', "")
    );

    run_direct_keyring_probe();
    println!("[probe] database: {}", db_path.display());
    println!("[probe] creating ProviderStore...");
    let store = ProviderStore::new(&database_url).await?;
    store.init().await?;

    println!("[probe] creating instance via existing implementation...");
    let instance = store
        .create_instance(CreateInstanceRequest {
            preset_slug: "custom".to_string(),
            name: "keychain-probe".to_string(),
            base_url: "http://localhost".to_string(),
            description: Some("provider keychain probe".to_string()),
            icon: None,
            priority: Some(0),
            protocol: None,
            model_prefix: None,
            auto_append_v1: None,
            resource_name: None,
            deployment_name: None,
            api_version: None,
            project_id: None,
            region: None,
            is_local: Some(true),
            secret_key: Some(probe_secret.clone()),
        })
        .await?;

    let credential_id = parse_credential_id(&instance.credentials_ref)
        .ok_or("credentials_ref is not db:<credential_id>, cannot probe keychain")?;
    println!("[probe] instance_id: {}", instance.id);
    println!("[probe] credential_id: {credential_id}");

    let inspect_pool = sqlx::sqlite::SqlitePool::connect(&database_url).await?;
    let row = sqlx::query("SELECT secret_key FROM provider_credentials WHERE id = ? LIMIT 1")
        .bind(&credential_id)
        .fetch_one(&inspect_pool)
        .await?;
    let secret_in_db: String = row.try_get("secret_key")?;

    let keychain_entry = Entry::new(PROVIDER_KEYCHAIN_SERVICE, &credential_id)?;
    let keychain_secret = keychain_entry.get_password().ok();

    println!("[probe] db.secret_key.empty = {}", secret_in_db.is_empty());
    println!(
        "[probe] db.secret_key.matches_input = {}",
        secret_in_db == probe_secret
    );
    println!(
        "[probe] keychain.readable = {}",
        keychain_secret.as_deref().is_some()
    );
    println!(
        "[probe] keychain.matches_input = {}",
        keychain_secret.as_deref() == Some(probe_secret.as_str())
    );

    if secret_in_db.is_empty() && keychain_secret.as_deref() == Some(probe_secret.as_str()) {
        println!("[probe][result] keychain-write-ok (implementation works on this machine)");
    } else if secret_in_db == probe_secret {
        println!("[probe][result] fallback-local-db (keychain verification failed in this run)");
    } else {
        println!("[probe][result] unexpected-state (possible implementation or env issue)");
    }

    // Same credential id, direct keyring write/read probe.
    let manual_value = format!("manual-{}", uuid::Uuid::new_v4());
    match keychain_entry.set_password(&manual_value) {
        Ok(_) => println!("[probe] manual.set_password(on same credential_id) ok"),
        Err(err) => println!("[probe] manual.set_password(on same credential_id) error: {err}"),
    }
    match keychain_entry.get_password() {
        Ok(v) => println!(
            "[probe] manual.get_password(on same credential_id) ok, matches={}",
            v == manual_value
        ),
        Err(err) => println!("[probe] manual.get_password(on same credential_id) error: {err}"),
    }

    let second_entry = Entry::new(PROVIDER_KEYCHAIN_SERVICE, &credential_id)?;
    match second_entry.get_password() {
        Ok(v) => println!(
            "[probe] second-entry.get_password(after manual set) ok, matches={}",
            v == manual_value
        ),
        Err(err) => println!("[probe] second-entry.get_password(after manual set) error: {err}"),
    }

    // Clean up created secret and db record.
    let _ = store.delete_instance(&instance.id.to_string()).await;
    let _ = keychain_entry.delete_credential();
    drop(inspect_pool);
    let _ = std::fs::remove_file(&db_path);

    Ok(())
}
