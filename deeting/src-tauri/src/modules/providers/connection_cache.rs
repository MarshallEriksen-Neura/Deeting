use crate::modules::providers::types::{ProviderInstance, ProviderModel, ProviderPreset};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

/// 缓存的模型连接信息，避免重复查询数据库
#[derive(Debug, Clone)]
pub struct CachedModelConnection {
    pub model: ProviderModel,
    pub instance: ProviderInstance,
    pub secret_key: Option<String>,
    pub protocol: Option<String>,
    pub preset: Option<ProviderPreset>,
}

/// 模型连接缓存管理器
pub struct ConnectionCache {
    // provider_model_id -> CachedModelConnection
    cache: Arc<RwLock<HashMap<String, CachedModelConnection>>>,
}

impl ConnectionCache {
    pub fn new() -> Self {
        Self {
            cache: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// 获取缓存的连接信息
    pub async fn get(&self, provider_model_id: &str) -> Option<CachedModelConnection> {
        let cache = self.cache.read().await;
        cache.get(provider_model_id).cloned()
    }

    /// 存储连接信息到缓存
    pub async fn put(&self, provider_model_id: String, connection: CachedModelConnection) {
        let mut cache = self.cache.write().await;
        cache.insert(provider_model_id, connection);
    }

    /// 使模型缓存失效（当模型配置更新时调用）
    pub async fn invalidate(&self, provider_model_id: &str) {
        let mut cache = self.cache.write().await;
        cache.remove(provider_model_id);
    }

    /// 使实例下所有模型的缓存失效
    pub async fn invalidate_by_instance(&self, instance_id: &str) {
        let mut cache = self.cache.write().await;
        cache.retain(|_, conn| conn.instance.id.to_string() != instance_id);
    }

    /// 清空所有缓存
    pub async fn clear(&self) {
        let mut cache = self.cache.write().await;
        cache.clear();
    }

    /// 获取缓存大小
    pub async fn size(&self) -> usize {
        let cache = self.cache.read().await;
        cache.len()
    }
}

impl Default for ConnectionCache {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn create_test_connection(model_id: &str, instance_id: &str) -> CachedModelConnection {
        CachedModelConnection {
            model: ProviderModel {
                id: Uuid::parse_str(model_id).unwrap(),
                instance_id: Uuid::parse_str(instance_id).unwrap(),
                model_id: "test-model".to_string(),
                display_name: Some("Test Model".to_string()),
                is_active: true,
                upstream_path: "/v1/chat/completions".to_string(),
                unified_model_id: None,
                capabilities: vec![],
                pricing_config: serde_json::json!({}),
                limit_config: serde_json::json!({}),
                tokenizer_config: serde_json::json!({}),
                routing_config: serde_json::json!({}),
                config_override: serde_json::json!({}),
                source: "test".to_string(),
                extra_meta: serde_json::json!({}),
                weight: 0,
                priority: 0,
                synced_at: None,
                created_at: None,
                updated_at: None,
            },
            instance: ProviderInstance {
                id: Uuid::parse_str(instance_id).unwrap(),
                name: "test-instance".to_string(),
                preset_slug: "openai".to_string(),
                base_url: "https://api.openai.com".to_string(),
                description: None,
                icon: None,
                priority: 0,
                meta: serde_json::json!({}),
                is_enabled: true,
                is_local: false,
                credential_source: "local".to_string(),
                credentials_ref: "test-cred".to_string(),
                updated_at: "2024-01-01T00:00:00Z".to_string(),
                created_at: "2024-01-01T00:00:00Z".to_string(),
            },
            secret_key: Some("sk-test".to_string()),
            protocol: Some("openai".to_string()),
            preset: None,
        }
    }

    #[tokio::test]
    async fn test_cache_put_and_get() {
        let cache = ConnectionCache::new();
        let model_id = "00000000-0000-0000-0000-000000000001";
        let instance_id = "00000000-0000-0000-0000-000000000002";

        let connection = create_test_connection(model_id, instance_id);
        cache.put(model_id.to_string(), connection.clone()).await;

        let cached = cache.get(model_id).await;
        assert!(cached.is_some());
        let cached = cached.unwrap();
        assert_eq!(cached.model.id.to_string(), model_id);
    }

    #[tokio::test]
    async fn test_cache_invalidate() {
        let cache = ConnectionCache::new();
        let model_id = "00000000-0000-0000-0000-000000000001";
        let instance_id = "00000000-0000-0000-0000-000000000002";

        let connection = create_test_connection(model_id, instance_id);
        cache.put(model_id.to_string(), connection).await;

        assert!(cache.get(model_id).await.is_some());

        cache.invalidate(model_id).await;
        assert!(cache.get(model_id).await.is_none());
    }

    #[tokio::test]
    async fn test_cache_invalidate_by_instance() {
        let cache = ConnectionCache::new();
        let instance_id = "00000000-0000-0000-0000-000000000002";
        let model_id_1 = "00000000-0000-0000-0000-000000000001";
        let model_id_2 = "00000000-0000-0000-0000-000000000003";

        cache.put(model_id_1.to_string(), create_test_connection(model_id_1, instance_id)).await;
        cache.put(model_id_2.to_string(), create_test_connection(model_id_2, instance_id)).await;

        assert_eq!(cache.size().await, 2);

        cache.invalidate_by_instance(instance_id).await;
        assert_eq!(cache.size().await, 0);
    }

    #[tokio::test]
    async fn test_cache_clear() {
        let cache = ConnectionCache::new();
        let model_id_1 = "00000000-0000-0000-0000-000000000001";
        let model_id_2 = "00000000-0000-0000-0000-000000000003";
        let instance_id_1 = "00000000-0000-0000-0000-000000000002";
        let instance_id_2 = "00000000-0000-0000-0000-000000000004";

        cache.put(model_id_1.to_string(), create_test_connection(model_id_1, instance_id_1)).await;
        cache.put(model_id_2.to_string(), create_test_connection(model_id_2, instance_id_2)).await;

        assert_eq!(cache.size().await, 2);

        cache.clear().await;
        assert_eq!(cache.size().await, 0);
    }
}
