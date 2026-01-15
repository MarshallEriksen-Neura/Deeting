# Desktop Backend (Axum)

Minimal Axum skeleton for the desktop Rust backend. Starts an HTTP server with health/version endpoints and graceful shutdown.

## 运行
```bash
cd desktop/backend
cargo run
# 可选：PORT=4000 cargo run
```

访问：
- `GET /` 简单存活检查
- `GET /healthz` 健康检查（待接入真实依赖检测）
- `GET /version` 版本信息

## MCP Registry API（本地）

### 环境变量
- `DESKTOP_DB_PATH`：SQLite 数据库路径（默认 `~/.config/deeting/mcp.db`）。可传 `:memory:` 使用内存库。

### Source
- `GET /mcp/sources`：列出同步源
- `POST /mcp/sources`：创建同步源
- `POST /mcp/sources/{id}/sync`：同步源（可选 Bearer token）

请求示例（创建 Source）：
```json
{
  "name": "ModelScope Hub",
  "source_type": "modelscope",
  "path_or_url": "https://example.com/mcp.json",
  "trust_level": "community",
  "is_read_only": true
}
```

同步示例（可选认证）：
```json
{
  "auth_token": "YOUR_TOKEN"
}
```

### Tools
- `GET /mcp/tools`：列出工具
- `POST /mcp/tools/import`：导入 MCP JSON（支持 mcpServers 结构）
- `POST /mcp/tools/{id}/start`：启动工具进程
- `POST /mcp/tools/{id}/stop`：停止工具进程
- `PATCH /mcp/tools/{id}/config`：应用 pending 更新
- `GET /mcp/tools/{id}/logs`：读取最近日志（RingBuffer）
- `GET /mcp/tools/{id}/logs/stream`：SSE 日志流

导入示例（JSON Mode）：
```json
{
  "config": {
    "mcpServers": {
      "filesystem": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/Desktop"]
      }
    }
  }
}
```

应用更新示例：
```json
{
  "apply_pending": true
}
```

## 依赖
- Rust 1.74+（2021 edition）
- Tokio runtime（随依赖安装）
```
