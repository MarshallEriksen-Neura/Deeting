use crate::modules::providers::connection_cache::CachedModelConnection;
use crate::state::AppState;
use uuid::Uuid;

/// 解析并缓存模型连接信息
///
/// 优先从缓存获取，缓存未命中时查询数据库并更新缓存
pub(crate) async fn resolve_cached_model_connection(
    app_state: &AppState,
    provider_model_id: &str,
) -> Result<CachedModelConnection, String> {
    // 1. 尝试从缓存获取
    if let Some(cached) = app_state
        .providers
        .connection_cache
        .get(provider_model_id)
        .await
    {
        // 快速验证缓存的模型仍然激活
        if cached.model.is_active && cached.instance.is_enabled {
            return Ok(cached);
        } else {
            // 模型已失效，清除缓存
            app_state
                .providers
                .connection_cache
                .invalidate(provider_model_id)
                .await;
        }
    }

    // 2. 缓存未命中，查询数据库
    let provider_model_uuid = Uuid::parse_str(provider_model_id)
        .map_err(|e| format!("invalid provider_model_id: {}", e))?;

    let model = app_state
        .providers
        .store
        .get_model(&provider_model_uuid)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "provider model not found".to_string())?;

    if !model.is_active {
        return Err("provider model is inactive".to_string());
    }

    let instance = app_state
        .providers
        .store
        .get_instance(&model.instance_id.to_string())
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "provider instance not found".to_string())?;

    if !instance.is_enabled {
        return Err(format!("provider instance is disabled: {}", instance.name));
    }

    let connection = app_state
        .providers
        .store
        .get_instance_connection(&model.instance_id.to_string())
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "provider instance connection not found".to_string())?;

    // 检查凭证来源
    if connection
        .credential_source
        .as_deref()
        .map(|source| source.eq_ignore_ascii_case("platform"))
        .unwrap_or(false)
    {
        return Err(
            "platform credits runtime has been disabled; switch this model instance to local credentials"
                .to_string(),
        );
    }

    let preset = app_state
        .providers
        .store
        .get_preset(&instance.preset_slug)
        .await
        .map_err(|e| e.to_string())?;

    // 3. 构建缓存对象
    let cached_connection = CachedModelConnection {
        model: model.clone(),
        instance: instance.clone(),
        secret_key: connection.secret_key.clone(),
        protocol: connection.protocol.clone(),
        preset,
    };

    // 4. 更新缓存
    app_state
        .providers
        .connection_cache
        .put(provider_model_id.to_string(), cached_connection.clone())
        .await;

    Ok(cached_connection)
}

#[cfg(test)]
mod tests {
    use super::*;

    // 注意：这些测试需要完整的 AppState，通常在集成测试中运行
    // 这里只是展示函数签名的正确性
}
