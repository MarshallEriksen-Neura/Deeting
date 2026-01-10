# 认证与注册接口说明（面向前端）

> API 前缀均为 `/api/v1`。

## 注册模式
- `REGISTRATION_CONTROL_ENABLED=True`（默认关闭）：所有新用户必须携带邀请码；邮箱注册与 OAuth 首登共用同一准入策略。
- `REGISTRATION_CONTROL_ENABLED=False`：开放注册，无需邀请码，仍支持 OAuth 自动绑定同邮箱用户。

## 邀请码与窗口
- 管理员通过 `/admin/registration/windows` 创建注册窗口（开始/结束时间、名额、是否自动激活）。
- 通过 `/admin/registration/windows/{id}/invites` 生成邀请码；消费时会占用对应窗口名额。

## 常用 Schema
- **TokenPair**
  - `access_token`: `string`
  - `refresh_token`: `string`
  - `token_type`: `string`，固定 `"bearer"`
- **MessageResponse**
  - `message`: `string`

## 认证相关接口
- **POST `/auth/login/code`**  
  请求体 `SendLoginCodeRequest`：`email`，可选 `invite_code`（开启注册控制时必填）。发送 6 位邮箱验证码。  
- **POST `/auth/login`**  
  请求体 `LoginRequest`：`email`、`code`（6 位），可选 `invite_code`、`username`（新用户首登时设置展示名）。  
  成功返回 `TokenPair`。  
  失败：`401`（验证码错误/过期），`403`（被封禁或缺少邀请码），`429`（连续失败达到 `LOGIN_RATE_LIMIT_ATTEMPTS=5`，窗口 `LOGIN_RATE_LIMIT_WINDOW=600s`）。新用户首登自动注册并激活，遵循邀请码策略。

- **POST `/auth/refresh`**  
  请求体 `RefreshRequest`：`refresh_token`。  
  返回新的 `TokenPair`（旧 refresh 会被标记已用，重复使用将触发全量登出）。  
  失败：`401 Invalid/expired token`。

- **POST `/auth/logout`**  
  Header：`Authorization: Bearer <access_token>`，可选 `X-Refresh-Token: <refresh_token>`。  
  返回 `MessageResponse`，内容 `"Successfully logged out"`。后端将 access token 加入黑名单并删除 refresh token（若提供）。

- **GET `/auth/oauth/linuxdo/authorize`**（可选）  
  支持 query `invite_code`，返回 307 重定向到授权页。

- **POST `/auth/oauth/callback`**  
  请求体 `OAuthCallbackRequest`：`code`、`state`。  
  返回 `OAuthCallbackResponse` = `TokenPair` + `user_id` + `expires_in`（秒） + `token_type`。

## 注册与账号恢复接口
- 传统注册/激活/重置密码已下线，统一改用邮箱验证码登录或 OAuth。历史端点 `/users/register`、`/users/activate`、`/users/reset-password*` 将返回 404/410 兼容提示。

## 其他会话接口（常用）
- **GET `/users/me`**：返回当前登录用户信息与 `permission_flags`（0/1）。  
- **POST `/users/me/change-password`**：已下线，返回 410。无需密码即可登录。

## 迁移与表
- `registration_windows`：控制注册窗口与名额。
- `invite_codes`：邀请码存储及窗口关联。
