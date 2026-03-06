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
  优先使用 HttpOnly Cookie `refresh_token`；若 Cookie 缺省则回退读取请求体 `RefreshRequest.refresh_token`。
  当 Cookie 与请求体同时存在且不一致时，以 Cookie 为准。
  返回新的 `TokenPair`（旧 refresh 会被标记已用；短时间并发重试会返回 401 提示重试，超出宽限仍按重放处理）。
  失败：`401 Invalid/expired token`。

- **POST `/auth/logout`**
  Header：`Authorization: Bearer <access_token>`，可选 `X-Refresh-Token: <refresh_token>`。
  返回 `MessageResponse`，内容 `"Successfully logged out"`。后端将 access token 加入黑名单并删除 refresh token（若提供）。

- **GET `/auth/oauth/linuxdo/authorize`**（可选）
  支持 query `invite_code`，返回 307 重定向到授权页。

- **POST `/auth/oauth/callback`**
  请求体 `OAuthCallbackRequest`：`code`、`state`。
  返回 `OAuthCallbackResponse` = `TokenPair` + `user_id` + `expires_in`（秒） + `token_type`。

- **POST `/auth/oauth/desktop/start`**
  请求体 `DesktopOAuthStartRequest`：`provider`（当前支持 `google` / `github`）、可选 `return_scheme`、`platform`。
  返回 `DesktopOAuthStartResponse`：`session_id`、`authorize_url`、`expires_in`。桌面端使用系统浏览器打开 `authorize_url`。

- **GET `/auth/oauth/{provider}/callback`**
  第三方 OAuth provider 的桌面回调入口。后端完成 code 交换后，返回 307 重定向到 `deeting://auth/callback?...`，其中仅包含一次性 `grant`、`session_id`、`state`，不包含长期 token。

- **POST `/auth/oauth/desktop/exchange`**
  请求体 `DesktopOAuthExchangeRequest`：`provider`、`session_id`、`state`、`grant`。
  返回 `DesktopOAuthExchangeResponse` = `TokenPair` + `user`。后端会同时重写 HttpOnly `refresh_token` Cookie。

## 注册与账号恢复接口
- 传统注册/激活/重置密码已下线，统一改用邮箱验证码登录或 OAuth。历史端点 `/users/register`、`/users/activate`、`/users/reset-password*` 将返回 404/410 兼容提示。

## 其他会话接口（常用）
- **GET `/users/me`**：返回当前登录用户信息与 `permission_flags`（0/1）。
- **POST `/users/me/change-password`**：已下线，返回 410。无需密码即可登录。

## 迁移与表
- `registration_windows`：控制注册窗口与名额。
- `invite_codes`：邀请码存储及窗口关联。


## Google / GitHub 实际接入配置


### 环境文件约定
- 后端只保留：`backend/.env` 与 `backend/.env.example`
- 前端 / Tauri 本地开发可使用：`deeting/.env.local`

推荐用法：
- 本地后端：直接维护 `backend/.env`
- 后端示例：查看 `backend/.env.example`
- 前端 / Tauri：维护 `deeting/.env.local`

### 总体原则
- 当前桌面 OAuth 实现是：**桌面端打开系统浏览器 -> provider 回调后端 HTTPS 地址 -> 后端再 deep-link 回桌面**。
- 因此 **Google 应创建 Web application OAuth client**，**GitHub 应创建 OAuth App**。
- provider 控制台里配置的 `redirect_uri/callback URL` 应该指向 **后端 API 地址**，而不是 `deeting://...`。
- `deeting://auth/callback` 仅用于后端在完成 provider code exchange 后，回跳桌面应用。

### Google 配置
1. 打开 Google Cloud Console，配置 OAuth consent screen。
2. 在 `APIs & Services -> Credentials` 创建 **OAuth client ID**。
3. Application type 选择 **Web application**。
4. 在 **Authorized redirect URIs** 中添加：
   - 生产：`https://<your-api-domain>/api/v1/auth/oauth/google/callback`
   - 本地开发：`http://localhost:8000/api/v1/auth/oauth/google/callback`
5. 将生成的 Client ID / Client Secret 写入后端环境变量。

推荐环境变量：

```env
GOOGLE_OAUTH_ENABLED=true
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=https://api.example.com/api/v1/auth/oauth/google/callback
```

注意：
- 若桌面端走生产环境，请确保 `GOOGLE_REDIRECT_URI` 与 Google Console 中登记的 redirect URI **完全一致**。
- 若前后端分域，`GOOGLE_REDIRECT_URI` 也应使用后端公网域名，而不是前端域名。
- Google 官方文档：OAuth 2.0 for Web Server Applications 与 Redirect URI 约束。
  https://developers.google.com/identity/protocols/oauth2/web-server

### GitHub 配置
1. 打开 GitHub Developer Settings。
2. 进入 **OAuth Apps**，创建新的 **OAuth App**。
3. Homepage URL 填前端官网或产品官网地址，例如 `https://deeting.example.com`。
4. Authorization callback URL 填：
   - 生产：`https://<your-api-domain>/api/v1/auth/oauth/github/callback`
   - 本地开发：`http://localhost:8000/api/v1/auth/oauth/github/callback`
5. 创建后拿到 Client ID，并生成 Client Secret。

推荐环境变量：

```env
GITHUB_OAUTH_ENABLED=true
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
GITHUB_REDIRECT_URI=https://api.example.com/api/v1/auth/oauth/github/callback
```

注意：
- 当前实现使用的是 **GitHub OAuth App**，不是 GitHub App。
- `Authorization callback URL` 应与 `GITHUB_REDIRECT_URI` 完全一致。
- GitHub 官方文档：Creating an OAuth app / Redirect URLs。
  https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app
  https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps

### 桌面端相关环境变量

```env
DESKTOP_OAUTH_CALLBACK_SCHEME=deeting
DESKTOP_OAUTH_SESSION_TTL_SECONDS=600
DESKTOP_OAUTH_GRANT_TTL_SECONDS=120
```

说明：
- `DESKTOP_OAUTH_CALLBACK_SCHEME` 必须与 Tauri `deep-link` 插件里注册的 scheme 一致。
- 当前仓库默认使用 `deeting://auth/callback?...`。
- 如果修改 scheme，需要同步更新：
  - `backend/.env.example`
  - `deeting/src-tauri/tauri.conf.json`
  - 前端 `startDesktopOAuthSession()` 默认 `return_scheme`

### 生产环境示例

如果你的部署形态是：
- 前端：`https://app.deeting.ai`
- 后端：`https://api.deeting.ai`

则建议配置为：

```env
GOOGLE_OAUTH_ENABLED=true
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx
GOOGLE_REDIRECT_URI=https://api.deeting.ai/api/v1/auth/oauth/google/callback

GITHUB_OAUTH_ENABLED=true
GITHUB_CLIENT_ID=xxx
GITHUB_CLIENT_SECRET=xxx
GITHUB_REDIRECT_URI=https://api.deeting.ai/api/v1/auth/oauth/github/callback

DESKTOP_OAUTH_CALLBACK_SCHEME=deeting
```

### 本地开发示例

如果本地后端跑在 `http://localhost:8000`，则建议：

```env
GOOGLE_OAUTH_ENABLED=true
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx
GOOGLE_REDIRECT_URI=http://localhost:8000/api/v1/auth/oauth/google/callback

GITHUB_OAUTH_ENABLED=true
GITHUB_CLIENT_ID=xxx
GITHUB_CLIENT_SECRET=xxx
GITHUB_REDIRECT_URI=http://localhost:8000/api/v1/auth/oauth/github/callback
```

前提：你需要在 Google / GitHub 控制台里也登记同样的 localhost callback 地址。
