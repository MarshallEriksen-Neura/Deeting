use crate::modules::providers::error::ProviderError;
use crate::modules::providers::store::utils::now_rfc3339;
use crate::modules::providers::store::{ProviderStore, LOCAL_DESKTOP_USER_ID};
use crate::modules::providers::types::{
    DesktopObjectStorageConfig, DesktopObjectStorageConfigUpdateRequest,
    DesktopObjectStorageProvider, DesktopObjectStorageReadRequest, DesktopObjectStorageReadTicket,
    DesktopObjectStorageUploadRequest, DesktopObjectStorageUploadTicket,
};
use hmac::{Hmac, Mac};
use reqwest::Url;
use sha2::{Digest, Sha256};
use sqlx::Row;
use std::collections::BTreeMap;
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;

const DEFAULT_UPLOAD_EXPIRES_SECONDS: u32 = 900;
const ALIYUN_V4_SIGNATURE_VERSION: &str = "OSS4-HMAC-SHA256";
const ALIYUN_V4_REQUEST: &str = "aliyun_v4_request";
const ALIYUN_OSS_SERVICE: &str = "oss";

struct PresignedRequest {
    url: String,
    headers: BTreeMap<String, String>,
}

fn format_expires_at(
    expires_seconds: u32,
) -> Result<(time::OffsetDateTime, String), ProviderError> {
    let timestamp = time::OffsetDateTime::now_utc();
    let expires_at = (timestamp + time::Duration::seconds(i64::from(expires_seconds)))
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|err| ProviderError::Database(err.to_string()))?;
    Ok((timestamp, expires_at))
}

fn normalize_required(value: &str, field_name: &str) -> Result<String, ProviderError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(ProviderError::Validation(format!(
            "{field_name} is required"
        )));
    }
    Ok(trimmed.to_string())
}

fn normalize_optional(value: Option<String>) -> Option<String> {
    value.and_then(|item| {
        let trimmed = item.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

fn normalize_https_url(value: &str, field_name: &str) -> Result<String, ProviderError> {
    let normalized = normalize_required(value, field_name)?;
    let parsed = Url::parse(&normalized)
        .map_err(|err| ProviderError::Validation(format!("invalid {field_name}: {err}")))?;
    if parsed.scheme() != "https" {
        return Err(ProviderError::Validation(format!(
            "{field_name} must use https"
        )));
    }
    Ok(parsed.to_string().trim_end_matches('/').to_string())
}

fn normalize_optional_https_url(
    value: Option<String>,
    field_name: &str,
) -> Result<Option<String>, ProviderError> {
    match normalize_optional(value) {
        Some(raw) => Ok(Some(normalize_https_url(&raw, field_name)?)),
        None => Ok(None),
    }
}

fn normalize_bucket(value: &str) -> Result<String, ProviderError> {
    let bucket = normalize_required(value, "bucket")?;
    if !bucket
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return Err(ProviderError::Validation(
            "bucket contains unsupported characters".to_string(),
        ));
    }
    Ok(bucket)
}

fn normalize_path_prefix(value: Option<String>) -> Option<String> {
    normalize_optional(value).map(|item| item.trim_matches('/').to_string())
}

fn encode_uri_component(value: &str, keep_slash: bool) -> String {
    let mut output = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        let ch = *byte as char;
        let is_unreserved = ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | '~');
        if is_unreserved || (keep_slash && ch == '/') {
            output.push(ch);
        } else {
            output.push('%');
            output.push_str(&format!("{byte:02X}"));
        }
    }
    output
}

fn sha256_hex(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    hex::encode(hasher.finalize())
}

fn hmac_sha256(key: &[u8], data: &str) -> Result<Vec<u8>, ProviderError> {
    let mut mac = HmacSha256::new_from_slice(key)
        .map_err(|err| ProviderError::Validation(format!("invalid hmac key: {err}")))?;
    mac.update(data.as_bytes());
    Ok(mac.finalize().into_bytes().to_vec())
}

fn canonicalize_query(query: &BTreeMap<String, String>) -> String {
    query
        .iter()
        .map(|(key, value)| {
            format!(
                "{}={}",
                encode_uri_component(key, false),
                encode_uri_component(value, false)
            )
        })
        .collect::<Vec<_>>()
        .join("&")
}

fn canonicalize_headers(headers: &BTreeMap<String, String>) -> String {
    headers
        .iter()
        .map(|(key, value)| format!("{}:{}\n", key.to_ascii_lowercase(), value.trim()))
        .collect::<String>()
}

fn resolve_upload_target(
    config: &DesktopObjectStorageConfig,
    object_key: &str,
) -> Result<(String, String, String), ProviderError> {
    let endpoint = Url::parse(&config.endpoint)
        .map_err(|err| ProviderError::Validation(format!("invalid endpoint: {err}")))?;
    let scheme = endpoint.scheme().to_string();
    let endpoint_host = endpoint
        .host_str()
        .ok_or_else(|| ProviderError::Validation("endpoint host is required".to_string()))?;
    let path = endpoint.path().trim_end_matches('/').to_string();

    if config.is_path_style {
        let host = endpoint_host.to_string();
        let canonical_uri = format!(
            "{}/{}/{}",
            path,
            encode_uri_component(&config.bucket, true),
            encode_uri_component(object_key.trim_start_matches('/'), true)
        );
        return Ok((
            scheme,
            host,
            if canonical_uri.starts_with('/') {
                canonical_uri
            } else {
                format!("/{canonical_uri}")
            },
        ));
    }

    let host = if endpoint_host.starts_with(&format!("{}.", config.bucket)) {
        endpoint_host.to_string()
    } else {
        format!("{}.{}", config.bucket, endpoint_host)
    };
    let canonical_uri = format!(
        "{}/{}",
        path,
        encode_uri_component(object_key.trim_start_matches('/'), true)
    );
    Ok((
        scheme,
        host,
        if canonical_uri.starts_with('/') {
            canonical_uri
        } else {
            format!("/{canonical_uri}")
        },
    ))
}

fn build_r2_presigned_request(
    config: &DesktopObjectStorageConfig,
    secret_access_key: &str,
    method: &str,
    object_key: &str,
    expires_seconds: u32,
    timestamp: time::OffsetDateTime,
    content_type: Option<&str>,
) -> Result<PresignedRequest, ProviderError> {
    let (scheme, host, canonical_uri) = resolve_upload_target(config, object_key)?;
    let date = timestamp
        .format(&time::macros::format_description!("[year][month][day]"))
        .map_err(|err| ProviderError::Database(err.to_string()))?;
    let amz_date = timestamp
        .format(&time::macros::format_description!(
            "[year][month][day]T[hour][minute][second]Z"
        ))
        .map_err(|err| ProviderError::Database(err.to_string()))?;
    let region = config.region.as_deref().unwrap_or("auto");
    let scope = format!("{date}/{region}/s3/aws4_request");
    let content_type = normalize_optional_str(content_type);

    let mut query = BTreeMap::new();
    query.insert(
        "X-Amz-Algorithm".to_string(),
        "AWS4-HMAC-SHA256".to_string(),
    );
    query.insert(
        "X-Amz-Content-Sha256".to_string(),
        "UNSIGNED-PAYLOAD".to_string(),
    );
    query.insert(
        "X-Amz-Credential".to_string(),
        format!("{}/{}", config.access_key_id, scope),
    );
    query.insert("X-Amz-Date".to_string(), amz_date.clone());
    query.insert("X-Amz-Expires".to_string(), expires_seconds.to_string());
    let mut canonical_headers = BTreeMap::new();
    canonical_headers.insert("host".to_string(), host.clone());
    if let Some(content_type) = content_type.clone() {
        canonical_headers.insert("content-type".to_string(), content_type);
    }
    let signed_headers = canonical_headers
        .keys()
        .map(String::as_str)
        .collect::<Vec<_>>()
        .join(";");
    query.insert("X-Amz-SignedHeaders".to_string(), signed_headers.clone());

    let canonical_query = canonicalize_query(&query);
    let canonical_request = format!(
        "{method}\n{canonical_uri}\n{canonical_query}\n{}\n{signed_headers}\nUNSIGNED-PAYLOAD",
        canonicalize_headers(&canonical_headers)
    );
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{}\n{}\n{}",
        amz_date,
        scope,
        sha256_hex(&canonical_request)
    );
    let k_date = hmac_sha256(format!("AWS4{secret_access_key}").as_bytes(), &date)?;
    let k_region = hmac_sha256(&k_date, region)?;
    let k_service = hmac_sha256(&k_region, "s3")?;
    let k_signing = hmac_sha256(&k_service, "aws4_request")?;
    let signature = hex::encode(hmac_sha256(&k_signing, &string_to_sign)?);

    Ok(PresignedRequest {
        url: format!(
            "{scheme}://{host}{canonical_uri}?{canonical_query}&X-Amz-Signature={signature}"
        ),
        headers: content_type
            .map(|value| BTreeMap::from([(String::from("Content-Type"), value)]))
            .unwrap_or_default(),
    })
}

fn normalize_optional_str(value: Option<&str>) -> Option<String> {
    value.and_then(|item| {
        let trimmed = item.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn resolve_aliyun_region(config: &DesktopObjectStorageConfig) -> Result<String, ProviderError> {
    if let Some(region) = normalize_optional(config.region.clone()) {
        return Ok(region);
    }

    let endpoint = Url::parse(&config.endpoint)
        .map_err(|err| ProviderError::Validation(format!("invalid endpoint: {err}")))?;
    let host = endpoint
        .host_str()
        .ok_or_else(|| ProviderError::Validation("endpoint host is required".to_string()))?;
    let inferred = host
        .split('.')
        .find_map(|segment| segment.strip_prefix("oss-"))
        .map(str::to_string);

    inferred.ok_or_else(|| {
        ProviderError::Validation("region is required for aliyun_oss v4 signing".to_string())
    })
}

fn build_aliyun_canonical_uri(config: &DesktopObjectStorageConfig, object_key: &str) -> String {
    let normalized_key = object_key.trim_start_matches('/');
    if normalized_key.is_empty() {
        format!("/{}", encode_uri_component(&config.bucket, true))
    } else {
        format!(
            "/{}/{}",
            encode_uri_component(&config.bucket, true),
            encode_uri_component(normalized_key, true)
        )
    }
}

fn build_aliyun_presigned_request(
    config: &DesktopObjectStorageConfig,
    secret_access_key: &str,
    method: &str,
    object_key: &str,
    expires_seconds: u32,
    timestamp: time::OffsetDateTime,
    content_type: Option<&str>,
) -> Result<PresignedRequest, ProviderError> {
    let (scheme, host, request_uri) = resolve_upload_target(config, object_key)?;
    let canonical_uri = build_aliyun_canonical_uri(config, object_key);
    let region = resolve_aliyun_region(config)?;
    let date = timestamp
        .format(&time::macros::format_description!("[year][month][day]"))
        .map_err(|err| ProviderError::Database(err.to_string()))?;
    let oss_date = timestamp
        .format(&time::macros::format_description!(
            "[year][month][day]T[hour][minute][second]Z"
        ))
        .map_err(|err| ProviderError::Database(err.to_string()))?;
    let scope = format!("{date}/{region}/{ALIYUN_OSS_SERVICE}/{ALIYUN_V4_REQUEST}");
    let content_type = normalize_optional_str(content_type);

    let mut query = BTreeMap::new();
    query.insert(
        "x-oss-credential".to_string(),
        format!("{}/{}", config.access_key_id, scope),
    );
    query.insert("x-oss-date".to_string(), oss_date.clone());
    query.insert("x-oss-expires".to_string(), expires_seconds.to_string());
    query.insert(
        "x-oss-signature-version".to_string(),
        ALIYUN_V4_SIGNATURE_VERSION.to_string(),
    );

    let mut canonical_headers = BTreeMap::new();
    canonical_headers.insert("host".to_string(), host.clone());
    if let Some(content_type) = content_type.clone() {
        canonical_headers.insert("content-type".to_string(), content_type);
    }
    let signed_headers = canonical_headers
        .keys()
        .map(String::as_str)
        .collect::<Vec<_>>()
        .join(";");
    query.insert(
        "x-oss-additional-headers".to_string(),
        signed_headers.clone(),
    );
    let canonical_query = canonicalize_query(&query);
    let canonical_request = format!(
        "{method}\n{canonical_uri}\n{canonical_query}\n{}\n{signed_headers}\nUNSIGNED-PAYLOAD",
        canonicalize_headers(&canonical_headers)
    );
    let string_to_sign = format!(
        "{ALIYUN_V4_SIGNATURE_VERSION}\n{oss_date}\n{scope}\n{}",
        sha256_hex(&canonical_request)
    );
    let k_date = hmac_sha256(format!("aliyun_v4{secret_access_key}").as_bytes(), &date)?;
    let k_region = hmac_sha256(&k_date, &region)?;
    let k_service = hmac_sha256(&k_region, ALIYUN_OSS_SERVICE)?;
    let k_signing = hmac_sha256(&k_service, ALIYUN_V4_REQUEST)?;
    let signature = hex::encode(hmac_sha256(&k_signing, &string_to_sign)?);

    let mut final_query = query;
    final_query.insert("x-oss-signature".to_string(), signature);

    Ok(PresignedRequest {
        url: format!(
            "{scheme}://{host}{request_uri}?{}",
            canonicalize_query(&final_query)
        ),
        headers: content_type
            .map(|value| BTreeMap::from([(String::from("Content-Type"), value)]))
            .unwrap_or_default(),
    })
}

fn validate_provider_endpoint(
    provider: DesktopObjectStorageProvider,
    endpoint: &str,
) -> Result<(), ProviderError> {
    let lower = endpoint.to_ascii_lowercase();
    match provider {
        DesktopObjectStorageProvider::CloudflareR2S3 => {
            if !lower.contains("cloudflarestorage.com") {
                return Err(ProviderError::Validation(
                    "cloudflare_r2_s3 endpoint should point to cloudflarestorage.com".to_string(),
                ));
            }
        }
        DesktopObjectStorageProvider::AliyunOss => {
            if !lower.contains("aliyuncs.com") {
                return Err(ProviderError::Validation(
                    "aliyun_oss endpoint should point to aliyuncs.com".to_string(),
                ));
            }
        }
    }
    Ok(())
}

fn row_to_desktop_object_storage_config(
    row: &sqlx::sqlite::SqliteRow,
) -> Result<DesktopObjectStorageConfig, ProviderError> {
    let provider_raw: String = row.try_get("provider")?;
    let provider = DesktopObjectStorageProvider::from_str(&provider_raw).ok_or_else(|| {
        ProviderError::Database(format!(
            "invalid desktop object storage provider: {provider_raw}"
        ))
    })?;

    Ok(DesktopObjectStorageConfig {
        id: row.try_get("id")?,
        user_id: row.try_get("user_id")?,
        provider,
        bucket: row.try_get("bucket")?,
        region: row.try_get("region")?,
        endpoint: row.try_get("endpoint")?,
        public_base_url: row.try_get("public_base_url")?,
        path_prefix: row.try_get("path_prefix")?,
        is_path_style: row.try_get::<i64, _>("is_path_style").unwrap_or(0) != 0,
        access_key_id: row.try_get("access_key_id")?,
        has_secret: row
            .try_get::<String, _>("secret_ciphertext")
            .ok()
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false),
        is_enabled: row.try_get::<i64, _>("is_enabled").unwrap_or(1) != 0,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

impl DesktopObjectStorageConfig {
    pub fn build_object_key(&self, object_key: &str) -> String {
        let normalized = object_key.trim().trim_start_matches('/').to_string();
        if normalized.is_empty() {
            return self.path_prefix.clone().unwrap_or_default();
        }
        match self.path_prefix.as_deref() {
            Some(prefix) if !prefix.trim().is_empty() => {
                let normalized_prefix = prefix.trim_matches('/');
                if normalized == normalized_prefix
                    || normalized.starts_with(&format!("{normalized_prefix}/"))
                {
                    normalized
                } else {
                    format!("{normalized_prefix}/{normalized}")
                }
            }
            _ => normalized,
        }
    }

    pub fn build_public_url(&self, object_key: &str) -> Option<String> {
        let base = self
            .public_base_url
            .as_deref()?
            .trim()
            .trim_end_matches('/');
        if base.is_empty() {
            return None;
        }
        let key = self.build_object_key(object_key);
        Some(format!("{base}/{key}"))
    }
}

impl ProviderStore {
    async fn get_local_desktop_object_storage_secret(
        &self,
    ) -> Result<Option<String>, ProviderError> {
        let row = sqlx::query(
            "SELECT id, secret_ciphertext, secret_key_version
             FROM desktop_object_storage_config
             WHERE user_id = ?",
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .fetch_optional(&self.pool)
        .await?;

        let Some(row) = row else {
            return Ok(None);
        };
        let config_id: String = row.try_get("id")?;
        let secret_ciphertext: String = row.try_get("secret_ciphertext")?;
        let secret_key_version: i64 = row.try_get("secret_key_version").unwrap_or(0);
        if secret_ciphertext.trim().is_empty() {
            return Ok(None);
        }
        self.secret_store
            .decrypt_from_db(&config_id, &secret_ciphertext, secret_key_version)
    }

    pub async fn get_local_desktop_object_storage_config(
        &self,
    ) -> Result<Option<DesktopObjectStorageConfig>, ProviderError> {
        let row = sqlx::query("SELECT * FROM desktop_object_storage_config WHERE user_id = ?")
            .bind(LOCAL_DESKTOP_USER_ID)
            .fetch_optional(&self.pool)
            .await?;

        row.map(|item| row_to_desktop_object_storage_config(&item))
            .transpose()
    }

    pub async fn update_local_desktop_object_storage_config(
        &self,
        payload: DesktopObjectStorageConfigUpdateRequest,
    ) -> Result<DesktopObjectStorageConfig, ProviderError> {
        let existing = self.get_local_desktop_object_storage_config().await?;
        let id = existing
            .as_ref()
            .map(|config| config.id.clone())
            .unwrap_or_else(|| Uuid::new_v4().to_string());

        let bucket = normalize_bucket(&payload.bucket)?;
        let endpoint = normalize_https_url(&payload.endpoint, "endpoint")?;
        validate_provider_endpoint(payload.provider, &endpoint)?;
        let public_base_url =
            normalize_optional_https_url(payload.public_base_url, "public_base_url")?;
        let region = normalize_optional(payload.region);
        let path_prefix = normalize_path_prefix(payload.path_prefix);
        let access_key_id = normalize_required(&payload.access_key_id, "access_key_id")?;
        let is_path_style = payload.is_path_style.unwrap_or(false);
        let is_enabled = payload.is_enabled.unwrap_or(true);
        let existing_secret_ciphertext = sqlx::query(
            "SELECT secret_ciphertext FROM desktop_object_storage_config WHERE user_id = ?",
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .fetch_optional(&self.pool)
        .await?
        .and_then(|item| item.try_get::<String, _>("secret_ciphertext").ok())
        .unwrap_or_default();

        let retained_ciphertext = match normalize_optional(payload.secret_access_key) {
            Some(secret) => {
                let (ciphertext, _) = self.secret_store.encrypt_for_db(&id, &secret)?;
                ciphertext
            }
            None => existing_secret_ciphertext,
        };

        if retained_ciphertext.trim().is_empty() {
            return Err(ProviderError::Validation(
                "secret_access_key is required".to_string(),
            ));
        }

        let now = now_rfc3339()?;
        sqlx::query(
            "INSERT INTO desktop_object_storage_config (
                id, user_id, provider, bucket, region, endpoint, public_base_url,
                path_prefix, is_path_style, access_key_id, secret_ciphertext,
                secret_key_version, is_enabled, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                provider = excluded.provider,
                bucket = excluded.bucket,
                region = excluded.region,
                endpoint = excluded.endpoint,
                public_base_url = excluded.public_base_url,
                path_prefix = excluded.path_prefix,
                is_path_style = excluded.is_path_style,
                access_key_id = excluded.access_key_id,
                secret_ciphertext = excluded.secret_ciphertext,
                secret_key_version = excluded.secret_key_version,
                is_enabled = excluded.is_enabled,
                updated_at = excluded.updated_at",
        )
        .bind(&id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(payload.provider.as_str())
        .bind(&bucket)
        .bind(&region)
        .bind(&endpoint)
        .bind(&public_base_url)
        .bind(&path_prefix)
        .bind(if is_path_style { 1_i64 } else { 0_i64 })
        .bind(&access_key_id)
        .bind(&retained_ciphertext)
        .bind(1_i64)
        .bind(if is_enabled { 1_i64 } else { 0_i64 })
        .bind(
            existing
                .as_ref()
                .map(|config| config.created_at.as_str())
                .unwrap_or(&now),
        )
        .bind(&now)
        .execute(&self.pool)
        .await?;

        self.get_local_desktop_object_storage_config()
            .await?
            .ok_or_else(|| {
                ProviderError::NotFound(
                    "desktop object storage config not found after update".to_string(),
                )
            })
    }

    pub async fn clear_local_desktop_object_storage_config(&self) -> Result<bool, ProviderError> {
        let result = sqlx::query("DELETE FROM desktop_object_storage_config WHERE user_id = ?")
            .bind(LOCAL_DESKTOP_USER_ID)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn prepare_local_desktop_object_storage_upload(
        &self,
        payload: DesktopObjectStorageUploadRequest,
    ) -> Result<DesktopObjectStorageUploadTicket, ProviderError> {
        let config = self
            .get_local_desktop_object_storage_config()
            .await?
            .ok_or_else(|| {
                ProviderError::NotFound("desktop object storage config not found".to_string())
            })?;
        if !config.is_enabled {
            return Err(ProviderError::Validation(
                "desktop object storage is disabled".to_string(),
            ));
        }

        let secret = self
            .get_local_desktop_object_storage_secret()
            .await?
            .ok_or_else(|| {
                ProviderError::Validation(
                    "desktop object storage secret_access_key is missing".to_string(),
                )
            })?;
        let object_key = normalize_required(&payload.object_key, "object_key")?;
        let object_key = config.build_object_key(&object_key);
        let expires_seconds = payload
            .expires_seconds
            .unwrap_or(DEFAULT_UPLOAD_EXPIRES_SECONDS)
            .clamp(60, 3600);
        let (timestamp, expires_at) = format_expires_at(expires_seconds)?;
        let presigned = match config.provider {
            DesktopObjectStorageProvider::CloudflareR2S3 => build_r2_presigned_request(
                &config,
                &secret,
                "PUT",
                &object_key,
                expires_seconds,
                timestamp,
                payload.content_type.as_deref(),
            )?,
            DesktopObjectStorageProvider::AliyunOss => build_aliyun_presigned_request(
                &config,
                &secret,
                "PUT",
                &object_key,
                expires_seconds,
                timestamp,
                payload.content_type.as_deref(),
            )?,
        };

        Ok(DesktopObjectStorageUploadTicket {
            provider: config.provider,
            object_key,
            upload_url: presigned.url,
            method: "PUT".to_string(),
            headers: presigned.headers,
            asset_url: config.build_public_url(payload.object_key.trim()),
            expires_at,
        })
    }

    pub async fn prepare_local_desktop_object_storage_read(
        &self,
        payload: DesktopObjectStorageReadRequest,
    ) -> Result<DesktopObjectStorageReadTicket, ProviderError> {
        let config = self
            .get_local_desktop_object_storage_config()
            .await?
            .ok_or_else(|| {
                ProviderError::NotFound("desktop object storage config not found".to_string())
            })?;
        if !config.is_enabled {
            return Err(ProviderError::Validation(
                "desktop object storage is disabled".to_string(),
            ));
        }

        let secret = self
            .get_local_desktop_object_storage_secret()
            .await?
            .ok_or_else(|| {
                ProviderError::Validation(
                    "desktop object storage secret_access_key is missing".to_string(),
                )
            })?;
        let object_key = normalize_required(&payload.object_key, "object_key")?;
        let object_key = config.build_object_key(&object_key);
        let expires_seconds = payload
            .expires_seconds
            .unwrap_or(DEFAULT_UPLOAD_EXPIRES_SECONDS)
            .clamp(60, 3600);
        let (timestamp, expires_at) = format_expires_at(expires_seconds)?;
        let asset_url = match config.provider {
            DesktopObjectStorageProvider::CloudflareR2S3 => {
                build_r2_presigned_request(
                    &config,
                    &secret,
                    "GET",
                    &object_key,
                    expires_seconds,
                    timestamp,
                    None,
                )?
                .url
            }
            DesktopObjectStorageProvider::AliyunOss => {
                build_aliyun_presigned_request(
                    &config,
                    &secret,
                    "GET",
                    &object_key,
                    expires_seconds,
                    timestamp,
                    None,
                )?
                .url
            }
        };

        Ok(DesktopObjectStorageReadTicket {
            provider: config.provider,
            object_key,
            asset_url,
            expires_at,
        })
    }

    pub async fn put_local_desktop_object_storage_bytes(
        &self,
        object_key: &str,
        content_type: &str,
        bytes: &[u8],
    ) -> Result<Option<String>, ProviderError> {
        let config = match self.get_local_desktop_object_storage_config().await? {
            Some(config) if config.is_enabled => config,
            _ => return Ok(None),
        };
        let secret = match self.get_local_desktop_object_storage_secret().await? {
            Some(secret) => secret,
            None => return Ok(None),
        };
        let normalized_key = config.build_object_key(object_key);
        let expires_seconds = DEFAULT_UPLOAD_EXPIRES_SECONDS;
        let timestamp = time::OffsetDateTime::now_utc();
        let presigned = match config.provider {
            DesktopObjectStorageProvider::CloudflareR2S3 => build_r2_presigned_request(
                &config,
                &secret,
                "PUT",
                &normalized_key,
                expires_seconds,
                timestamp,
                Some(content_type),
            )?,
            DesktopObjectStorageProvider::AliyunOss => build_aliyun_presigned_request(
                &config,
                &secret,
                "PUT",
                &normalized_key,
                expires_seconds,
                timestamp,
                Some(content_type),
            )?,
        };

        let client = reqwest::Client::new();
        let mut request = client.put(presigned.url);
        let has_content_type_header = presigned
            .headers
            .keys()
            .any(|key| key.eq_ignore_ascii_case("content-type"));
        for (key, value) in presigned.headers {
            request = request.header(&key, &value);
        }
        if !has_content_type_header {
            let normalized_content_type = content_type.trim();
            if !normalized_content_type.is_empty() {
                request = request.header("content-type", normalized_content_type);
            }
        }
        let response = request
            .body(bytes.to_vec())
            .send()
            .await
            .map_err(|err| ProviderError::Network(err.to_string()))?;
        if !response.status().is_success() {
            return Err(ProviderError::Network(format!(
                "desktop object storage upload failed with status {}",
                response.status()
            )));
        }
        Ok(Some(normalized_key))
    }

    pub async fn read_local_desktop_object_storage_bytes(
        &self,
        object_key: &str,
    ) -> Result<Option<Vec<u8>>, ProviderError> {
        let config = match self.get_local_desktop_object_storage_config().await? {
            Some(config) if config.is_enabled => config,
            _ => return Ok(None),
        };
        let secret = match self.get_local_desktop_object_storage_secret().await? {
            Some(secret) => secret,
            None => return Ok(None),
        };
        let normalized_key = config.build_object_key(object_key);
        let expires_seconds = DEFAULT_UPLOAD_EXPIRES_SECONDS;
        let timestamp = time::OffsetDateTime::now_utc();
        let download_url = match config.provider {
            DesktopObjectStorageProvider::CloudflareR2S3 => {
                build_r2_presigned_request(
                    &config,
                    &secret,
                    "GET",
                    &normalized_key,
                    expires_seconds,
                    timestamp,
                    None,
                )?
                .url
            }
            DesktopObjectStorageProvider::AliyunOss => {
                build_aliyun_presigned_request(
                    &config,
                    &secret,
                    "GET",
                    &normalized_key,
                    expires_seconds,
                    timestamp,
                    None,
                )?
                .url
            }
        };

        let client = reqwest::Client::new();
        let response = client
            .get(download_url)
            .send()
            .await
            .map_err(|err| ProviderError::Network(err.to_string()))?;
        if !response.status().is_success() {
            return Err(ProviderError::Network(format!(
                "desktop object storage read failed with status {}",
                response.status()
            )));
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|err| ProviderError::Network(err.to_string()))?;
        Ok(Some(bytes.to_vec()))
    }

    pub async fn delete_local_desktop_object_storage_object(
        &self,
        object_key: &str,
    ) -> Result<bool, ProviderError> {
        let config = match self.get_local_desktop_object_storage_config().await? {
            Some(config) if config.is_enabled => config,
            _ => return Ok(false),
        };
        let secret = match self.get_local_desktop_object_storage_secret().await? {
            Some(secret) => secret,
            None => return Ok(false),
        };
        let normalized_key = config.build_object_key(object_key);
        let expires_seconds = DEFAULT_UPLOAD_EXPIRES_SECONDS;
        let timestamp = time::OffsetDateTime::now_utc();
        let delete_url = match config.provider {
            DesktopObjectStorageProvider::CloudflareR2S3 => {
                build_r2_presigned_request(
                    &config,
                    &secret,
                    "DELETE",
                    &normalized_key,
                    expires_seconds,
                    timestamp,
                    None,
                )?
                .url
            }
            DesktopObjectStorageProvider::AliyunOss => {
                build_aliyun_presigned_request(
                    &config,
                    &secret,
                    "DELETE",
                    &normalized_key,
                    expires_seconds,
                    timestamp,
                    None,
                )?
                .url
            }
        };
        let client = reqwest::Client::new();
        let response = client
            .delete(delete_url)
            .send()
            .await
            .map_err(|err| ProviderError::Network(err.to_string()))?;
        if !response.status().is_success() {
            return Err(ProviderError::Network(format!(
                "desktop object storage delete failed with status {}",
                response.status()
            )));
        }
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn init_store() -> ProviderStore {
        let store = ProviderStore::new("sqlite::memory:")
            .await
            .expect("failed to create provider store");
        store.init().await.expect("provider init failed");
        store
    }

    fn sample_payload() -> DesktopObjectStorageConfigUpdateRequest {
        DesktopObjectStorageConfigUpdateRequest {
            provider: DesktopObjectStorageProvider::CloudflareR2S3,
            bucket: "demo-bucket".to_string(),
            region: Some("auto".to_string()),
            endpoint: "https://example.r2.cloudflarestorage.com".to_string(),
            public_base_url: Some("https://cdn.example.com/assets".to_string()),
            path_prefix: Some("/desktop/uploads/".to_string()),
            is_path_style: Some(false),
            access_key_id: "AKIA-DEMO".to_string(),
            secret_access_key: Some("super-secret".to_string()),
            is_enabled: Some(true),
        }
    }

    #[tokio::test]
    async fn update_desktop_object_storage_config_upserts_and_normalizes() {
        let store = init_store().await;
        let config = store
            .update_local_desktop_object_storage_config(sample_payload())
            .await
            .expect("update config");

        assert_eq!(
            config.provider,
            DesktopObjectStorageProvider::CloudflareR2S3
        );
        assert_eq!(config.bucket, "demo-bucket");
        assert_eq!(config.endpoint, "https://example.r2.cloudflarestorage.com");
        assert_eq!(
            config.public_base_url.as_deref(),
            Some("https://cdn.example.com/assets")
        );
        assert_eq!(config.path_prefix.as_deref(), Some("desktop/uploads"));
        assert!(config.has_secret);
        assert_eq!(
            config.build_public_url("chat/demo.png").as_deref(),
            Some("https://cdn.example.com/assets/desktop/uploads/chat/demo.png")
        );
    }

    #[tokio::test]
    async fn update_desktop_object_storage_config_keeps_existing_secret() {
        let store = init_store().await;
        store
            .update_local_desktop_object_storage_config(sample_payload())
            .await
            .expect("seed config");

        let updated = store
            .update_local_desktop_object_storage_config(DesktopObjectStorageConfigUpdateRequest {
                provider: DesktopObjectStorageProvider::AliyunOss,
                bucket: "next-bucket".to_string(),
                region: Some("cn-hangzhou".to_string()),
                endpoint: "https://oss-cn-hangzhou.aliyuncs.com".to_string(),
                public_base_url: None,
                path_prefix: Some("knowledge".to_string()),
                is_path_style: Some(true),
                access_key_id: "ALIYUN-ID".to_string(),
                secret_access_key: None,
                is_enabled: Some(false),
            })
            .await
            .expect("update config");

        assert_eq!(updated.provider, DesktopObjectStorageProvider::AliyunOss);
        assert_eq!(updated.bucket, "next-bucket");
        assert!(updated.has_secret);
        assert!(!updated.is_enabled);
    }

    #[tokio::test]
    async fn clear_desktop_object_storage_config_removes_row() {
        let store = init_store().await;
        store
            .update_local_desktop_object_storage_config(sample_payload())
            .await
            .expect("seed config");

        assert!(store
            .clear_local_desktop_object_storage_config()
            .await
            .expect("clear config"));
        assert!(store
            .get_local_desktop_object_storage_config()
            .await
            .expect("read config")
            .is_none());
    }

    #[tokio::test]
    async fn update_desktop_object_storage_config_rejects_non_https_endpoint() {
        let store = init_store().await;
        let error = store
            .update_local_desktop_object_storage_config(DesktopObjectStorageConfigUpdateRequest {
                endpoint: "http://example.com".to_string(),
                ..sample_payload()
            })
            .await
            .expect_err("expected validation error");

        assert!(matches!(error, ProviderError::Validation(_)));
    }

    #[tokio::test]
    async fn prepare_upload_ticket_for_r2_contains_sigv4_params() {
        let store = init_store().await;
        store
            .update_local_desktop_object_storage_config(sample_payload())
            .await
            .expect("seed config");

        let ticket = store
            .prepare_local_desktop_object_storage_upload(DesktopObjectStorageUploadRequest {
                object_key: "chat/demo.png".to_string(),
                content_type: Some("image/png".to_string()),
                expires_seconds: Some(300),
            })
            .await
            .expect("prepare upload");

        assert_eq!(
            ticket.provider,
            DesktopObjectStorageProvider::CloudflareR2S3
        );
        assert_eq!(ticket.object_key, "desktop/uploads/chat/demo.png");
        assert!(ticket
            .upload_url
            .contains("X-Amz-Algorithm=AWS4-HMAC-SHA256"));
        assert!(ticket
            .upload_url
            .contains("X-Amz-SignedHeaders=content-type%3Bhost"));
        assert!(ticket.upload_url.contains("X-Amz-Signature="));
        assert_eq!(
            ticket.headers.get("Content-Type").map(String::as_str),
            Some("image/png")
        );
        assert_eq!(
            ticket.asset_url.as_deref(),
            Some("https://cdn.example.com/assets/desktop/uploads/chat/demo.png")
        );
    }

    #[tokio::test]
    async fn prepare_read_ticket_for_r2_contains_sigv4_params() {
        let store = init_store().await;
        store
            .update_local_desktop_object_storage_config(sample_payload())
            .await
            .expect("seed config");

        let ticket = store
            .prepare_local_desktop_object_storage_read(DesktopObjectStorageReadRequest {
                object_key: "chat/demo.png".to_string(),
                expires_seconds: Some(300),
            })
            .await
            .expect("prepare read");

        assert_eq!(
            ticket.provider,
            DesktopObjectStorageProvider::CloudflareR2S3
        );
        assert_eq!(ticket.object_key, "desktop/uploads/chat/demo.png");
        assert!(ticket
            .asset_url
            .contains("X-Amz-Algorithm=AWS4-HMAC-SHA256"));
        assert!(ticket.asset_url.contains("X-Amz-SignedHeaders=host"));
        assert!(ticket.asset_url.contains("X-Amz-Signature="));
    }

    #[tokio::test]
    async fn prepare_upload_ticket_for_aliyun_contains_oss_v4_query_signature() {
        let store = init_store().await;
        store
            .update_local_desktop_object_storage_config(DesktopObjectStorageConfigUpdateRequest {
                provider: DesktopObjectStorageProvider::AliyunOss,
                bucket: "demo-bucket".to_string(),
                region: Some("cn-hangzhou".to_string()),
                endpoint: "https://oss-cn-hangzhou.aliyuncs.com".to_string(),
                public_base_url: Some("https://assets.example.com".to_string()),
                path_prefix: Some("chat".to_string()),
                is_path_style: Some(false),
                access_key_id: "ALIYUN-ID".to_string(),
                secret_access_key: Some("ALIYUN-SECRET".to_string()),
                is_enabled: Some(true),
            })
            .await
            .expect("seed aliyun config");

        let ticket = store
            .prepare_local_desktop_object_storage_upload(DesktopObjectStorageUploadRequest {
                object_key: "demo.png".to_string(),
                content_type: Some("image/png".to_string()),
                expires_seconds: Some(300),
            })
            .await
            .expect("prepare upload");

        assert_eq!(ticket.provider, DesktopObjectStorageProvider::AliyunOss);
        assert!(ticket
            .upload_url
            .contains("x-oss-signature-version=OSS4-HMAC-SHA256"));
        assert!(ticket.upload_url.contains("x-oss-credential=ALIYUN-ID%2F"));
        assert!(ticket
            .upload_url
            .contains("%2Fcn-hangzhou%2Foss%2Faliyun_v4_request"));
        assert!(ticket.upload_url.contains("x-oss-date="));
        assert!(ticket.upload_url.contains("x-oss-expires=300"));
        assert!(ticket
            .upload_url
            .contains("x-oss-additional-headers=content-type%3Bhost"));
        assert!(ticket.upload_url.contains("x-oss-signature="));
        assert_eq!(
            ticket.headers.get("Content-Type").map(String::as_str),
            Some("image/png")
        );
        assert_eq!(
            ticket.asset_url.as_deref(),
            Some("https://assets.example.com/chat/demo.png")
        );
    }

    #[tokio::test]
    async fn prepare_read_ticket_for_aliyun_contains_oss_v4_query_signature() {
        let store = init_store().await;
        store
            .update_local_desktop_object_storage_config(DesktopObjectStorageConfigUpdateRequest {
                provider: DesktopObjectStorageProvider::AliyunOss,
                bucket: "demo-bucket".to_string(),
                region: Some("cn-hangzhou".to_string()),
                endpoint: "https://oss-cn-hangzhou.aliyuncs.com".to_string(),
                public_base_url: None,
                path_prefix: Some("chat".to_string()),
                is_path_style: Some(false),
                access_key_id: "ALIYUN-ID".to_string(),
                secret_access_key: Some("ALIYUN-SECRET".to_string()),
                is_enabled: Some(true),
            })
            .await
            .expect("seed aliyun config");

        let ticket = store
            .prepare_local_desktop_object_storage_read(DesktopObjectStorageReadRequest {
                object_key: "demo.png".to_string(),
                expires_seconds: Some(300),
            })
            .await
            .expect("prepare read");

        assert_eq!(ticket.provider, DesktopObjectStorageProvider::AliyunOss);
        assert!(ticket
            .asset_url
            .contains("x-oss-signature-version=OSS4-HMAC-SHA256"));
        assert!(ticket.asset_url.contains("x-oss-signature="));
        assert!(ticket.asset_url.contains("x-oss-additional-headers=host"));
    }

    #[test]
    fn build_aliyun_presigned_request_signs_content_type_for_put() {
        let timestamp = time::OffsetDateTime::from_unix_timestamp(1_763_185_208)
            .expect("timestamp should be valid");
        let config = DesktopObjectStorageConfig {
            id: Uuid::new_v4().to_string(),
            user_id: LOCAL_DESKTOP_USER_ID.to_string(),
            provider: DesktopObjectStorageProvider::AliyunOss,
            bucket: "deeting".to_string(),
            region: Some("cn-beijing".to_string()),
            endpoint: "https://oss-cn-beijing.aliyuncs.com".to_string(),
            public_base_url: None,
            path_prefix: Some("desktop/uploads".to_string()),
            is_path_style: false,
            access_key_id: "ALIYUN-ID".to_string(),
            has_secret: true,
            is_enabled: true,
            created_at: "2026-03-10T00:00:00Z".to_string(),
            updated_at: "2026-03-10T00:00:00Z".to_string(),
        };

        let presigned = build_aliyun_presigned_request(
            &config,
            "ALIYUN-SECRET",
            "PUT",
            "desktop/uploads/knowledge/demo.txt",
            300,
            timestamp,
            Some("text/plain"),
        )
        .expect("presign should succeed");

        assert!(presigned.url.starts_with(
            "https://deeting.oss-cn-beijing.aliyuncs.com/desktop/uploads/knowledge/demo.txt?"
        ));
        assert!(presigned
            .url
            .contains("x-oss-signature-version=OSS4-HMAC-SHA256"));
        assert!(presigned.url.contains(
            "x-oss-credential=ALIYUN-ID%2F20251118%2Fcn-beijing%2Foss%2Faliyun_v4_request"
        ));
        assert!(presigned.url.contains("x-oss-date=20251118T121328Z"));
        assert!(presigned
            .url
            .contains("x-oss-additional-headers=content-type%3Bhost"));
        assert_eq!(
            presigned.headers.get("Content-Type").map(String::as_str),
            Some("text/plain")
        );
    }

    #[test]
    fn build_r2_presigned_request_signs_content_type_for_put() {
        let timestamp = time::OffsetDateTime::from_unix_timestamp(1_763_185_208)
            .expect("timestamp should be valid");
        let config = DesktopObjectStorageConfig {
            id: Uuid::new_v4().to_string(),
            user_id: LOCAL_DESKTOP_USER_ID.to_string(),
            provider: DesktopObjectStorageProvider::CloudflareR2S3,
            bucket: "demo-bucket".to_string(),
            region: Some("auto".to_string()),
            endpoint: "https://example.r2.cloudflarestorage.com".to_string(),
            public_base_url: None,
            path_prefix: Some("desktop/uploads".to_string()),
            is_path_style: false,
            access_key_id: "AKIA-DEMO".to_string(),
            has_secret: true,
            is_enabled: true,
            created_at: "2026-03-10T00:00:00Z".to_string(),
            updated_at: "2026-03-10T00:00:00Z".to_string(),
        };

        let presigned = build_r2_presigned_request(
            &config,
            "super-secret",
            "PUT",
            "desktop/uploads/chat/demo.png",
            300,
            timestamp,
            Some("image/png"),
        )
        .expect("presign should succeed");

        assert!(presigned.url.starts_with(
            "https://demo-bucket.example.r2.cloudflarestorage.com/desktop/uploads/chat/demo.png?"
        ));
        assert!(presigned.url.contains("X-Amz-Algorithm=AWS4-HMAC-SHA256"));
        assert!(presigned
            .url
            .contains("X-Amz-SignedHeaders=content-type%3Bhost"));
        assert!(presigned.url.contains("X-Amz-Signature="));
        assert_eq!(
            presigned.headers.get("Content-Type").map(String::as_str),
            Some("image/png")
        );
    }

    #[test]
    fn build_object_key_is_idempotent_for_prefixed_keys() {
        let config = DesktopObjectStorageConfig {
            id: Uuid::new_v4().to_string(),
            user_id: LOCAL_DESKTOP_USER_ID.to_string(),
            provider: DesktopObjectStorageProvider::CloudflareR2S3,
            bucket: "demo".to_string(),
            region: Some("auto".to_string()),
            endpoint: "https://demo.example.com".to_string(),
            public_base_url: Some("https://cdn.example.com".to_string()),
            path_prefix: Some("desktop/uploads".to_string()),
            is_path_style: false,
            access_key_id: "key".to_string(),
            has_secret: true,
            is_enabled: true,
            created_at: "2026-03-10T00:00:00Z".to_string(),
            updated_at: "2026-03-10T00:00:00Z".to_string(),
        };

        assert_eq!(
            config.build_object_key("desktop/uploads/chat/demo.png"),
            "desktop/uploads/chat/demo.png"
        );
    }
}
