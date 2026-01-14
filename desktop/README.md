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

## 依赖
- Rust 1.74+（2021 edition）
- Tokio runtime（随依赖安装）
```
