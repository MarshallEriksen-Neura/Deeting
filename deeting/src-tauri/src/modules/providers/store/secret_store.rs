use std::fs;
use std::path::{Path, PathBuf};

use aes_gcm::aead::{Aead, Payload};
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use base64::Engine;
use rand::RngCore;

use crate::modules::providers::error::ProviderError;
use crate::modules::providers::store::utils::normalize_secret;

const DB_SECRET_VERSION: i64 = 1;
const CIPHERTEXT_PREFIX_V1: &str = "v1:";
const MASTER_KEY_BYTES: usize = 32;
const NONCE_BYTES: usize = 12;
const MASTER_KEY_FILE_NAME: &str = ".deeting.provider.master.key";
const SECRET_KEY_PATH_ENV: &str = "DEETING_PROVIDER_SECRET_KEY_PATH";

#[derive(Clone)]
pub struct SecretStore {
    master_key: [u8; MASTER_KEY_BYTES],
}

impl SecretStore {
    pub fn new(database_url: &str) -> Result<Self, ProviderError> {
        let master_key = if is_memory_database_url(database_url) {
            random_bytes()
        } else {
            let key_path = resolve_master_key_path(database_url)?;
            load_or_init_master_key(&key_path)?
        };

        Ok(Self { master_key })
    }

    pub fn encrypt_for_db(
        &self,
        credential_id: &str,
        secret: &str,
    ) -> Result<(String, i64), ProviderError> {
        let normalized = normalize_secret(secret)
            .ok_or_else(|| ProviderError::Validation("secret key cannot be empty".to_string()))?;
        let cipher = self.build_cipher()?;
        let mut nonce = [0_u8; NONCE_BYTES];
        rand::thread_rng().fill_bytes(&mut nonce);
        let payload = cipher
            .encrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: normalized.as_bytes(),
                    aad: aad_for_credential(credential_id).as_bytes(),
                },
            )
            .map_err(|err| ProviderError::Database(format!("db secret encrypt failed: {err}")))?;
        let mut envelope = Vec::with_capacity(NONCE_BYTES + payload.len());
        envelope.extend_from_slice(&nonce);
        envelope.extend_from_slice(&payload);
        let encoded = base64::engine::general_purpose::STANDARD_NO_PAD.encode(envelope);
        Ok((
            format!("{CIPHERTEXT_PREFIX_V1}{encoded}"),
            DB_SECRET_VERSION,
        ))
    }

    pub fn decrypt_from_db(
        &self,
        credential_id: &str,
        encrypted: &str,
        key_version: i64,
    ) -> Result<Option<String>, ProviderError> {
        let trimmed = encrypted.trim();
        if trimmed.is_empty() {
            return Ok(None);
        }
        if key_version != DB_SECRET_VERSION || !trimmed.starts_with(CIPHERTEXT_PREFIX_V1) {
            return Ok(None);
        }

        let encoded = &trimmed[CIPHERTEXT_PREFIX_V1.len()..];
        let raw = base64::engine::general_purpose::STANDARD_NO_PAD
            .decode(encoded)
            .map_err(|err| ProviderError::Database(format!("db secret decode failed: {err}")))?;

        if raw.len() <= NONCE_BYTES {
            return Err(ProviderError::Database(
                "db secret payload is malformed".to_string(),
            ));
        }

        let (nonce, ciphertext) = raw.split_at(NONCE_BYTES);
        let cipher = self.build_cipher()?;
        let plaintext = cipher
            .decrypt(
                Nonce::from_slice(nonce),
                Payload {
                    msg: ciphertext,
                    aad: aad_for_credential(credential_id).as_bytes(),
                },
            )
            .map_err(|err| ProviderError::Database(format!("db secret decrypt failed: {err}")))?;
        let value = String::from_utf8(plaintext).map_err(|err| {
            ProviderError::Database(format!("db secret utf8 decode failed: {err}"))
        })?;
        Ok(normalize_secret(&value))
    }

    fn build_cipher(&self) -> Result<Aes256Gcm, ProviderError> {
        Aes256Gcm::new_from_slice(&self.master_key)
            .map_err(|err| ProviderError::Database(format!("db secret cipher init failed: {err}")))
    }
}

fn aad_for_credential(credential_id: &str) -> String {
    format!("provider-credential:{credential_id}")
}

fn random_bytes() -> [u8; MASTER_KEY_BYTES] {
    let mut key = [0_u8; MASTER_KEY_BYTES];
    rand::thread_rng().fill_bytes(&mut key);
    key
}

fn is_memory_database_url(database_url: &str) -> bool {
    let normalized = database_url.trim().to_ascii_lowercase();
    normalized == "sqlite::memory:" || normalized == ":memory:"
}

fn resolve_master_key_path(database_url: &str) -> Result<PathBuf, ProviderError> {
    if let Ok(raw) = std::env::var(SECRET_KEY_PATH_ENV) {
        let path = PathBuf::from(raw.trim());
        if !path.as_os_str().is_empty() {
            return Ok(path);
        }
    }

    let db_path = parse_database_path(database_url)?;
    let parent = db_path.parent().unwrap_or_else(|| Path::new("."));
    Ok(parent.join(MASTER_KEY_FILE_NAME))
}

fn parse_database_path(database_url: &str) -> Result<PathBuf, ProviderError> {
    let raw = database_url.trim();
    let without_prefix = raw.strip_prefix("sqlite:").unwrap_or(raw);
    if without_prefix.is_empty() || without_prefix.starts_with(':') {
        return Err(ProviderError::Database(format!(
            "unsupported sqlite database url for secret store: {database_url}"
        )));
    }

    let without_query = without_prefix.split('?').next().unwrap_or(without_prefix);
    Ok(PathBuf::from(without_query))
}

fn load_or_init_master_key(path: &Path) -> Result<[u8; MASTER_KEY_BYTES], ProviderError> {
    if path.exists() {
        let raw = fs::read_to_string(path)
            .map_err(|err| ProviderError::Database(format!("read master key failed: {err}")))?;
        let decoded = base64::engine::general_purpose::STANDARD_NO_PAD
            .decode(raw.trim())
            .map_err(|err| ProviderError::Database(format!("decode master key failed: {err}")))?;
        if decoded.len() != MASTER_KEY_BYTES {
            return Err(ProviderError::Database(format!(
                "master key length invalid: expected {MASTER_KEY_BYTES}, got {}",
                decoded.len()
            )));
        }
        let mut key = [0_u8; MASTER_KEY_BYTES];
        key.copy_from_slice(&decoded);
        return Ok(key);
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| ProviderError::Database(format!("create key dir failed: {err}")))?;
    }
    let key = random_bytes();
    let encoded = base64::engine::general_purpose::STANDARD_NO_PAD.encode(key);
    fs::write(path, encoded.as_bytes())
        .map_err(|err| ProviderError::Database(format!("write master key failed: {err}")))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = fs::Permissions::from_mode(0o600);
        fs::set_permissions(path, perms).map_err(|err| {
            ProviderError::Database(format!("set master key permissions failed: {err}"))
        })?;
    }

    Ok(key)
}
