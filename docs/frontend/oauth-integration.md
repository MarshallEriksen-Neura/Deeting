# OAuth 登录集成指南

## 概述

本文档说明如何在前端集成 OAuth 登录功能。

## 文件结构

```
frontend/
├── app/(auth)/
│   ├── callback/
│   │   └── page.tsx          # OAuth 回调处理页面
│   └── login/
│       └── page.tsx           # 登录页面
├── lib/
│   └── auth/
│       ├── oauth-redirect.ts  # OAuth 重定向地址管理
│       └── token-manager.ts   # Token 存储管理
└── lib/i18n/
    └── auth.ts                # 认证相关国际化文案
```

## OAuth 登录流程

### 1. 用户点击 OAuth 登录按钮

在登录页面或任何需要 OAuth 登录的地方：

```tsx
import { oauthRedirect } from "@/lib/auth/oauth-redirect";

function LoginButton() {
  const handleOAuthLogin = (provider: string) => {
    // 保存当前页面地址，登录成功后跳转回来
    oauthRedirect.save();
    
    // 跳转到后端 OAuth 授权端点
    window.location.href = `/api/auth/oauth/${provider}/authorize`;
  };

  return (
    <button onClick={() => handleOAuthLogin("google")}>
      使用 Google 登录
    </button>
  );
}
```

### 2. 后端处理授权请求

后端 `/api/auth/oauth/{provider}/authorize` 端点应该：
- 生成 state 参数（防 CSRF）
- 构建 OAuth 授权 URL
- 设置回调地址为 `https://yourdomain.com/callback`
- 重定向用户到 OAuth 提供商

### 3. OAuth 提供商回调

用户授权后，OAuth 提供商会重定向到：
```
https://yourdomain.com/callback?code=xxx&state=xxx
```

### 4. 前端回调页面处理

`frontend/app/(auth)/callback/page.tsx` 会：
- 提取 `code` 和 `state` 参数
- 调用后端 `/auth/oauth/callback` API 验证
- 存储返回的 access_token 和 refresh_token
- 更新用户状态
- 跳转到保存的重定向地址或默认的 `/dashboard`

## 后端 API 要求

### 1. OAuth 授权端点

```
GET /api/auth/oauth/{provider}/authorize
```

响应：重定向到 OAuth 提供商授权页面

### 2. OAuth 回调验证端点

```
POST /auth/oauth/callback
Content-Type: application/json

{
  "code": "authorization_code",
  "state": "state_value"
}
```

响应：
```json
{
  "access_token": "xxx",
  "refresh_token": "xxx",
  "user": {
    "id": 1,
    "email": "user@example.com",
    "name": "User Name",
    "is_active": true
  }
}
```

## 重定向地址管理

使用 `oauthRedirect` 工具管理重定向：

```tsx
import { oauthRedirect } from "@/lib/auth/oauth-redirect";

// 保存当前页面
oauthRedirect.save();

// 保存指定页面
oauthRedirect.save("/dashboard/settings");

// 获取保存的地址
const url = oauthRedirect.get(); // 返回 string | null

// 获取并清除
const url = oauthRedirect.getAndClear("/dashboard"); // 返回地址，没有则返回默认值

// 清除保存的地址
oauthRedirect.clear();
```

## 国际化文案

OAuth 相关文案已添加到 `frontend/lib/i18n/auth.ts`：

```typescript
// 中文
"auth.oauth_processing": "正在处理 OAuth 登录...",
"auth.oauth_success": "登录成功！",
"auth.oauth_failed": "OAuth 登录失败",
"auth.oauth_redirecting": "正在跳转到仪表盘...",
"auth.oauth_redirect_login": "正在跳转到登录页...",
"auth.oauth_provider_error": "OAuth 提供商返回错误",
"auth.oauth_missing_code": "缺少授权码",

// 英文
"auth.oauth_processing": "Processing OAuth login...",
"auth.oauth_success": "Login successful!",
"auth.oauth_failed": "OAuth login failed",
// ...
```

## 错误处理

回调页面会处理以下错误情况：

1. **OAuth 提供商返回错误**：URL 中包含 `error` 参数
2. **缺少授权码**：URL 中没有 `code` 参数
3. **后端验证失败**：API 调用返回错误
4. **网络错误**：请求超时或网络问题

所有错误都会：
- 显示错误提示（toast）
- 显示错误状态页面
- 3秒后自动跳转到登录页

## 安全考虑

1. **State 参数**：后端必须验证 state 参数，防止 CSRF 攻击
2. **Token 存储**：OAuth 登录默认使用 `remember: true`，token 保存7天
3. **HTTPS**：生产环境必须使用 HTTPS
4. **回调地址白名单**：后端应验证回调地址在白名单中

## 配置示例

### 环境变量（后端）

```env
# OAuth 回调地址
OAUTH_CALLBACK_URL=https://yourdomain.com/callback

# Google OAuth
GOOGLE_CLIENT_ID=xxx
GOOGLE_CLIENT_SECRET=xxx

# GitHub OAuth
GITHUB_CLIENT_ID=xxx
GITHUB_CLIENT_SECRET=xxx
```

### 前端环境变量

```env
# API 基础地址
NEXT_PUBLIC_API_BASE_URL=https://api.yourdomain.com
```

## 测试

### 本地测试

1. 启动后端服务：`cd backend && uvicorn main:app --reload`
2. 启动前端服务：`cd frontend && bun dev`
3. 访问 `http://localhost:3000/login`
4. 点击 OAuth 登录按钮

### 注意事项

- 本地测试时，OAuth 提供商的回调地址需要配置为 `http://localhost:3000/callback`
- 某些 OAuth 提供商（如 Google）不支持 localhost，需要使用 ngrok 等工具暴露本地服务

## 常见问题

### Q: 登录成功后跳转到了登录页而不是目标页面？

A: 检查是否在跳转到 OAuth 授权页面前调用了 `oauthRedirect.save()`

### Q: 回调页面一直显示"正在处理"？

A: 检查浏览器控制台错误，可能是后端 API 调用失败或返回格式不正确

### Q: Token 存储失败？

A: 检查浏览器是否禁用了 Cookie 或 localStorage

### Q: 如何支持多个 OAuth 提供商？

A: 在登录页面添加多个按钮，每个按钮调用不同的 provider 参数：

```tsx
<button onClick={() => handleOAuthLogin("google")}>Google</button>
<button onClick={() => handleOAuthLogin("github")}>GitHub</button>
<button onClick={() => handleOAuthLogin("microsoft")}>Microsoft</button>
```
