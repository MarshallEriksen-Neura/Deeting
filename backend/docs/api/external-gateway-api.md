# External Gateway API（已下线）

> 本文档用于说明外部网关下线状态，避免继续接入过期接口。

## 状态

- 下线日期：`2026-03-04`
- 状态：`OFFLINE`
- 影响范围：所有外部网关入口（如 `/external/v1/*`、`/api/v1/external/*`）

## 变更说明

外部网关路由已从应用注册中移除，相关路由处理代码已清理。继续调用上述路径将返回路由不存在（通常为 `404`）。

## 替代方案

- 当前仅保留内部网关：`/internal/v1/*` 与 `/api/v1/internal/*`
- 鉴权方式：JWT（见 `docs/api/internal-gateway-api.md` 与 `docs/api/authentication.md`）

## 对接建议

- 停止使用 `X-API-Key` / `X-Signature` 外部签名接入方式。
- 将调用方改造为内部网关登录态（Bearer Token）模式。
