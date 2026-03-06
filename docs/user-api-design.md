# 用户相关 API 设计草案

> 状态：已被现行认证与用户接口替代，当前仅保留简要说明。
> 更新时间：2026-03-06

## 当前结论
- 本文中的大部分用户体系设计，已经落入现行 `auth` / `users` 路由与对应 API 文档。
- 原始设计稿不再作为当前源文档，后续请直接参考实际路由、schema 与 API 文档。

## 当前实现入口
- 认证路由：`backend/app/api/v1/auth_route.py`
- 用户路由：`backend/app/api/v1/users_route.py`
- 认证 API 文档：`docs/api/authentication.md`
- 用户 API 文档：`docs/api/users.md`

## 维护说明
- 如需继续扩展 MFA、风控、租户隔离等高级能力，请基于当前 `auth` / `users` 实现重新开新方案。
- 本文件仅保留历史归档说明。
