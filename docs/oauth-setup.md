# OAuth 配置指南

本文档说明如何为 Deeting 桌面端项目配置 Google 和 GitHub OAuth 登录。

## 重要说明

✅ **不需要项目先上线** - 可以在开发阶段就申请 OAuth 应用
✅ **完全免费** - GitHub 和 Google OAuth 都是免费的
✅ **支持本地开发** - 可以使用 `http://localhost:8000` 作为后端回调地址

## 桌面端 OAuth 流程说明

桌面端 OAuth 与 Web 应用不同，流程如下：

```
1. 桌面应用 → 后端 API (/oauth/desktop/start) → 获取授权 URL
2. 桌面应用 → 打开浏览器 → OAuth 提供商授权页面
3. 用户授权 → OAuth 提供商 → 重定向到后端 Callback API
4. 后端处理 → 生成临时 grant → 重定向到自定义协议 (deeting://auth/callback)
5. 桌面应用 → 接收 grant → 调用后端 exchange API → 获取 access_token
```

**关键点：回调地址是后端 API，不是前端地址！**

## GitHub OAuth 配置

### 1. 创建 OAuth App

1. 登录 GitHub
2. 进入 **Settings → Developer settings → OAuth Apps**
3. 点击 **New OAuth App**

### 2. 开发环境配置

填写以下信息：

```
Application name: Deeting Dev
Homepage URL: http://localhost:3000
Authorization callback URL: http://localhost:8000/api/v1/auth/oauth/github/callback
```

**注意：回调地址是后端 API 地址（端口 8000），不是前端地址（端口 3000）**

### 3. 生产环境配置

创建另一个 OAuth App：

```
Application name: Deeting
Homepage URL: https://yourdomain.com
Authorization callback URL: https://api.yourdomain.com/api/v1/auth/oauth/github/callback
```

### 4. 获取凭据

创建完成后，你会看到：
- **Client ID**（立即显示）
- **Client Secret**（点击 "Generate a new client secret" 生成）

### 5. 配置环境变量

在 `backend/.env` 文件中添加：

```bash
# GitHub OAuth
GITHUB_OAUTH_ENABLED=true
GITHUB_CLIENT_ID=your_github_client_id_here
GITHUB_CLIENT_SECRET=your_github_client_secret_here
GITHUB_REDIRECT_URI=http://localhost:8000/api/v1/auth/oauth/github/callback
```

**注意：`GITHUB_REDIRECT_URI` 必须与 GitHub OAuth App 中配置的回调地址完全一致**

## Google OAuth 配置

### 1. 创建 Google Cloud 项目

1. 访问 [Google Cloud Console](https://console.cloud.google.com/)
2. 点击 "Select a project" → "New Project"
3. 输入项目名称（如 "Deeting"）并创建

### 2. 配置 OAuth 同意屏幕

1. 进入 **APIs & Services → OAuth consent screen**
2. 选择用户类型：**External**
3. 发布状态：**Testing**（无需审核）
4. 填写应用信息：
   - App name: Deeting
   - User support email: 你的邮箱
   - Developer contact information: 你的邮箱
5. Scopes：默认即可（openid, profile, email）
6. Test users：添加你的邮箱作为测试用户

### 3. 创建 OAuth 凭据

1. 进入 **APIs & Services → Credentials**
2. 点击 **Create Credentials → OAuth client ID**
3. 应用类型：**Web application**
4. 配置重定向 URI：

**开发环境：**
```
Authorized JavaScript origins:
  http://localhost:3000
  http://localhost:8000

Authorized redirect URIs:
  http://localhost:8000/api/v1/auth/oauth/google/callback
```

**注意：回调地址是后端 API 地址（端口 8000），不是前端地址（端口 3000）**

**生产环境（创建另一个凭据）：**
```
Authorized JavaScript origins:
  https://yourdomain.com
  https://api.yourdomain.com

Authorized redirect URIs:
  https://api.yourdomain.com/api/v1/auth/oauth/google/callback
```

### 4. 获取凭据

创建完成后，你会看到：
- **Client ID**
- **Client Secret**

### 5. 配置环境变量

在 `backend/.env` 文件中添加：

```bash
# Google OAuth
GOOGLE_OAUTH_ENABLED=true
GOOGLE_CLIENT_ID=your_google_client_id_here.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_google_client_secret_here
GOOGLE_REDIRECT_URI=http://localhost:8000/api/v1/auth/oauth/google/callback
```

**注意：`GOOGLE_REDIRECT_URI` 必须与 Google OAuth 凭据中配置的回调地址完全一致**

## 环境变量完整示例

### 开发环境 (backend/.env)

```bash
# GitHub OAuth
GITHUB_OAUTH_ENABLED=true
GITHUB_CLIENT_ID=Iv1.abc123def456
GITHUB_CLIENT_SECRET=1234567890abcdef1234567890abcdef12345678
GITHUB_REDIRECT_URI=http://localhost:8000/api/v1/auth/oauth/github/callback

# Google OAuth
GOOGLE_OAUTH_ENABLED=true
GOOGLE_CLIENT_ID=123456789-abcdefg.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-abcdefghijklmnopqrstuvwxyz
GOOGLE_REDIRECT_URI=http://localhost:8000/api/v1/auth/oauth/google/callback

# Desktop OAuth 配置
DESKTOP_OAUTH_CALLBACK_SCHEME=deeting
DESKTOP_OAUTH_SESSION_TTL_SECONDS=600
DESKTOP_OAUTH_GRANT_TTL_SECONDS=120
```

### 生产环境

```bash
# GitHub OAuth
GITHUB_OAUTH_ENABLED=true
GITHUB_CLIENT_ID=Iv1.xyz789uvw012
GITHUB_CLIENT_SECRET=abcdef1234567890abcdef1234567890abcdef12
GITHUB_REDIRECT_URI=https://api.yourdomain.com/api/v1/auth/oauth/github/callback

# Google OAuth
GOOGLE_OAUTH_ENABLED=true
GOOGLE_CLIENT_ID=987654321-xyzabc.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-zyxwvutsrqponmlkjihgfedcba
GOOGLE_REDIRECT_URI=https://api.yourdomain.com/api/v1/auth/oauth/google/callback
```

## 测试 OAuth 登录

### 1. 启动后端服务

```bash
cd backend
uvicorn app.main:app --reload
```

### 2. 启动前端服务

```bash
cd deeting
bun run dev
```

### 3. 测试登录流程

1. 打开应用
2. 点击 "使用 GitHub 登录" 或 "使用 Google 登录"
3. 浏览器会打开 OAuth 授权页面
4. 授权后，应用会自动回调并登录成功

## 常见问题

### Q: Google OAuth 测试模式有什么限制？

A: 测试模式下，只有添加为 "Test users" 的用户才能登录。每个项目最多可以添加 100 个测试用户。对于开发和测试来说完全足够。

### Q: 什么时候需要 Google 审核？

A: 只有在以下情况下需要 Google 审核：
- 应用需要访问敏感信息（如用户邮箱）
- 应用需要公开发布给所有用户使用
- 应用需要使用生产模式（非测试模式）

**对于开发和测试，使用测试模式即可，无需审核。**

### Q: 可以同时配置多个回调地址吗？

A: 可以。在 GitHub OAuth App 和 Google OAuth 凭据中，可以添加多个重定向 URI：
- 开发环境：`http://localhost:3000/api/v1/auth/oauth/desktop/callback`
- 生产环境：`https://yourdomain.com/api/v1/auth/oauth/desktop/callback`

### Q: 需要为桌面应用单独配置 OAuth 吗？

A: 不需要。Deeting 使用的是基于浏览器的 OAuth 流程，桌面应用会打开系统浏览器进行授权，完成后通过自定义协议（`deeting://`）回调到应用。因此，配置 Web OAuth 即可。

### Q: 生产环境需要做什么额外配置？

A:
1. 创建新的 OAuth App/凭据（使用生产域名）
2. 更新环境变量中的 `REDIRECT_URI`
3. 如果使用 Google OAuth，考虑将应用切换到生产模式（需要审核）

## 安全建议

1. **不要提交 Client Secret 到 Git**
   - 添加 `.env` 到 `.gitignore`
   - 使用环境变量或密钥管理服务

2. **定期轮换密钥**
   - GitHub: 可以随时生成新的 Client Secret
   - Google: 可以随时重新生成 Client Secret

3. **限制重定向 URI**
   - 只添加实际使用的域名
   - 不要使用通配符

4. **监控使用情况**
   - GitHub: 在 OAuth App 页面查看使用统计
   - Google Cloud Console: 查看 API 使用情况

## 相关文档

- [GitHub OAuth Apps 文档](https://docs.github.com/en/developers/apps/building-oauth-apps)
- [Google OAuth 2.0 文档](https://developers.google.com/identity/protocols/oauth2)
- [项目认证实现](../deeting_core/app/services/users/desktop_oauth_service.py)
