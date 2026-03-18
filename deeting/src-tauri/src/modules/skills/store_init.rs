use crate::modules::mcp::error::McpError;
use crate::modules::mcp::store::McpStore;

pub(crate) async fn init_skill_tables(store: &McpStore) -> Result<(), McpError> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS local_skill_install (
          user_id TEXT NOT NULL,
          skill_id TEXT NOT NULL,
          installed_version TEXT NOT NULL,
          is_enabled INTEGER NOT NULL DEFAULT 1,
          runtime TEXT,
          manifest_json TEXT NOT NULL,
          install_path TEXT NOT NULL,
          user_settings_json TEXT,
          installed_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (user_id, skill_id)
        );
        "#,
    )
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_local_skill_install_user_enabled
        ON local_skill_install(user_id, is_enabled);
        "#,
    )
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS local_skill_tool_binding (
          user_id TEXT NOT NULL,
          binding_id TEXT NOT NULL,
          binding_kind TEXT NOT NULL,
          skill_id TEXT NOT NULL,
          callable_name TEXT NOT NULL,
          tool_name TEXT NOT NULL,
          description TEXT NOT NULL,
          input_schema_json TEXT,
          output_schema_json TEXT,
          entry_path TEXT NOT NULL,
          runtime TEXT NOT NULL,
          timeout_seconds INTEGER NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (user_id, binding_id)
        );
        "#,
    )
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE UNIQUE INDEX IF NOT EXISTS idx_local_skill_tool_binding_callable_name
        ON local_skill_tool_binding(user_id, callable_name);
        "#,
    )
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_local_skill_tool_binding_skill_id
        ON local_skill_tool_binding(user_id, skill_id);
        "#,
    )
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS local_capability_registry (
          user_id TEXT NOT NULL,
          capability_id TEXT NOT NULL,
          source_kind TEXT NOT NULL,
          asset_kind TEXT NOT NULL,
          package_id TEXT NOT NULL,
          package_version TEXT,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          tool_name TEXT,
          callable_name TEXT,
          binding_kind TEXT,
          execution_surface TEXT NOT NULL,
          runtime TEXT,
          entry_path TEXT,
          is_direct_callable INTEGER NOT NULL DEFAULT 0,
          activation_state TEXT NOT NULL,
          runtime_state TEXT NOT NULL,
          search_index_state TEXT NOT NULL,
          generation INTEGER NOT NULL DEFAULT 0,
          descriptor_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (user_id, capability_id)
        );
        "#,
    )
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_local_capability_registry_package
        ON local_capability_registry(user_id, package_id);
        "#,
    )
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_local_capability_registry_source_kind
        ON local_capability_registry(user_id, source_kind, asset_kind);
        "#,
    )
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS local_skill_secret (
          user_id TEXT NOT NULL,
          skill_id TEXT NOT NULL,
          env_key TEXT NOT NULL,
          secret_ciphertext TEXT NOT NULL,
          secret_key_version INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (user_id, skill_id, env_key)
        );
        "#,
    )
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    Ok(())
}
