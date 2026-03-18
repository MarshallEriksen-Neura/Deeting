# 桌面端 OAuth 流程详解

## 流程图

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 桌面端 OAuth 完整流程                                                    │
└─────────────────────────────────────────────────────────────────────────┘

用户操作                    桌面应用                    后端服务              OAuth 提供商
   │                          │                          │                     │
   │  1. 点击登录              │                          │                     │
   ├─────────────────────────>│                          │                     │
   │                          │                          │                     │
   │                          │  POST /oauth/desktop/start                    │
   │                          ├─────────────────────────>│                     │
   │                          │                          │                     │
   │                          │  { authorize_url, session_id }                │
   │                          │<─────────────────────────┤                     │
   │                          │                          │                     │
   │  2. 打开浏览器            │                          │                     │
   │<─────────────────────────┤                          │                     │
   │                          │                          │                     │
   │  3. 用户授权              │                          │                     │
   ├─────────────────────────────────────────────────────────────────────────>│
   │                          │                          │                     │
   │                          │                          │  GET /callback?code=xxx&state=yyy
   │                          │                          │<────────────────────┤
   │                          │                          │                     │
   │                          │                          │  4. 验证授权码       │
   │                          │                          │  生成 grant         │
   │                          │                          │                     │
   │                          │                          │  5. 重定向到自定义协议
   │                          │                          │  deeting://auth/callback?grant=zzz
   │                          │                          ├─────────────────────┤
   │                          │                          │                     │
   │  6. 浏览器打开桌面应用     │                          │                     │
   │<─────────────────────────┼──────────────────────────┼─────────────────────┤
   │                          │                          │                     │
   │                          │  接收 grant 参数          │                     │
   │                          │<─────────────────────────┤                     │
   │                          │                          │                     │
   │                          │  POST /oauth/desktop/exchange                  │
   │                          ├─────────────────────────>│                     │
   │                          │                          │                     │
   │                          │  { access_token, user }  │                     │
   │                          │<─────────────────────────┤                     │
   │                          │                          │                     │
   │  7. 登录成功              │                          │                     │
   │<─────────────────────────┤                          │                     │
   │                          │                          │                     │
```

## 关键点说明

### 1. 回调地址是后端 API

**正确配置：**
```bash
# OAuth 提供商中的回调地址
GitHub Callback URL: http://localhost:8000/api/v1/auth/oauth/github/callback
Google Redirect URI: http://localhost:8000/api/v1/auth/oauth/google/callback

# 后端环境变量
GITHUB_REDIRECT_URI=http://localhost:8000/api/v1/auth/oauth/github/callback
GOOGLE_REDIRECT_URI=http://localhost:8000/api/v1/auth/oauth/google/callback
```

**为什么是后端地址？**

1. OAuth 提供商需要回调到一个可访问的 HTTP 地址
2. 桌面应用没有 HTTP 服务器，无法直接接收回调
3. 后端接收授权码后，生成临时 grant
4. 后端重定向到自定义协议 `deeting://`，打开桌面应用

### 2. 自定义协议配置

在 `backend/.env` 中配置：

```bash
DESKTOP_OAUTH_CALLBACK_SCHEME=deeting
```

桌面应用需要注册这个自定义协议，当浏览器访问 `deeting://auth/callback?...` 时，会自动打开应用。

### 3. Grant 机制

**为什么需要 grant？**

1. **安全性**：授权码（code）只在后端使用，不会暴露给桌面应用
2. **一次性**：grant 只能使用一次，防止重放攻击
3. **短期有效**：grant 会在 120 秒后过期

**流程：**
```
后端接收授权码 (code)
    ↓
验证授权码，获取用户信息
    ↓
生成临时 grant (一次性 token)
    ↓
重定向到 deeting://auth/callback?grant=xxx
    ↓
桌面应用接收 grant
    ↓
调用 /oauth/desktop/exchange 交换 access_token
```

## API 端点说明

### 1. 启动 OAuth 流程

**请求：**
```http
POST /api/v1/auth/oauth/desktop/start
Content-Type: application/json

{
  "provider": "github",  // 或 "google"
  "return_scheme": "deeting",
  "platform": "desktop"
}
```

**响应：**
```json
{
  "session_id": "uuid-here",
  "authorize_url": "https://github.com/login/oauth/authorize?...",
  "expires_in": 600
}
```

### 2. OAuth 提供商回调（自动触发）

**请求：**
```http
GET /api/v1/auth/oauth/github/callback?code=xxx&state=yyy
```

**响应：**
```http
HTTP/1.1 307 Temporary Redirect
Location: deeting://auth/callback?provider=github&intent=login&session_id=...&state=...&grant=...
```

### 3. 交换 Grant 为 Access Token

**请求：**
```http
POST /api/v1/auth/oauth/desktop/exchange
Content-Type: application/json

{
  "provider": "github",
  "session_id": "uuid-here",
  "state": "state-string",
  "grant": "grant-token"
}
```

**响应：**
```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "...",
  "token_type": "bearer",
  "user": {
    "id": "user-uuid",
    "email": "user@example.com",
    "name": "Username"
  }
}
```

## 安全机制

### 1. PKCE (Proof Key for Code Exchange)

项目使用 PKCE 增强安全性：

```python
# desktop_oauth_service.py:134
code_verifier = secrets.token_urlsafe(64)

# 构建授权 URL 时添加 code_challenge
params["code_challenge"] = _pkce_code_challenge(code_verifier)
params["code_challenge_method"] = "S256"
```

**作用：**
- 防止授权码拦截攻击
- 即使授权码被截获，没有 code_verifier 也无法使用

### 2. State 参数

每次 OAuth 会话生成唯一的 state：

```python
# desktop_oauth_service.py:133
state = secrets.token_urlsafe(32)
```

**作用：**
- 防止 CSRF 攻击
- 确保回调来自同一个会话

### 3. 会话过期

```bash
# .env 配置
DESKTOP_OAUTH_SESSION_TTL_SECONDS=600  # 会话有效期 10 分钟
DESKTOP_OAUTH_GRANT_TTL_SECONDS=120    # Grant 有效期 2 分钟
```

## 常见问题

### Q: 为什么不直接在前端处理 OAuth？

A: 桌面应用无法直接接收 HTTP 回调，需要通过后端中转。

### Q: Grant 为什么不直接返回 access_token？

A: Grant 是一次性凭证，用于防止重放攻击。即使 grant 被截获，也只能使用一次。

### Q: 自定义协议如何注册？

A: 在桌面应用的配置文件中注册，例如：

**Tauri (tauri.conf.json):**
```json
{
  "plugins": {
    "deep-link": {
      "desktop": {
        "schemes": ["deeting"]
      }
    }
  }
}
```

**Electron (electron-builder.yml):**
```yaml
protocols:
  - name: Deeting
    schemes:
      - deeting
```

### Q: 生产环境如何配置？

A: 生产环境需要：

1. **OAuth 提供商配置：**
   ```
   Callback URL: https://api.yourdomain.com/api/v1/auth/oauth/github/callback
   ```

2. **后端环境变量：**
   ```bash
   GITHUB_REDIRECT_URI=https://api.yourdomain.com/api/v1/auth/oauth/github/callback
   GOOGLE_REDIRECT_URI=https://api.yourdomain.com/api/v1/auth/oauth/google/callback
   ```

3. **确保后端 API 可访问：**
   - 后端 API 需要部署到公网
   - OAuth 提供商需要能够访问回调地址

## 相关文件

- 后端服务：`backend/app/services/users/desktop_oauth_service.py`
- API 路由：`backend/app/api/v1/auth_route.py`
- 前端 Hook：`deeting/hooks/use-auth.ts`
- OAuth API：`deeting/lib/api/auth-oauth-desktop.ts`
- 配置文件：`backend/app/core/config.py`

## 调试技巧

### 1. 查看后端日志

```bash
# 启动后端时开启调试日志
LOG_LEVEL=DEBUG uvicorn app.main:app --reload
```

### 2. 检查 OAuth 流程

```bash
# 查看会话状态
# PostgreSQL
SELECT * FROM desktop_oauth_sessions WHERE id = 'session-uuid';

# 查看 grant
SELECT * FROM desktop_oauth_grants WHERE session_id = 'session-uuid';
```

### 3. 测试自定义协议

```bash
# 在浏览器中测试
deeting://auth/callback?provider=github&intent=login&session_id=test&state=test&grant=test
```

如果配置正确，应该会自动打开桌面应用。
