# LinuxDo OAuth 前端接入方案

## 后端 API 分析

根据后端实现，已有以下 OAuth 端点：

### 1. 授权端点
```
GET /auth/oauth/linuxdo/authorize
```
- **功能**: 生成 LinuxDo 授权链接并重定向到 LinuxDo
- **响应**: 307 重定向到 LinuxDo 授权页面
- **State**: 后端自动生成并存储在 Redis（5分钟有效期）

### 2. 回调验证端点
```
POST /auth/oauth/callback
Content-Type: application/json

{
  "code": "authorization_code",
  "state": "state_value"
}
```

**响应**:
```json
{
  "access_token": "xxx",
  "refresh_token": "xxx",
  "token_type": "bearer",
  "expires_in": 3600,
  "user": {
    "id": 1,
    "email": "user@example.com",
    "display_name": "User Name",
    "is_active": true,
    "avatar_url": "https://...",
    "role": "user"
  }
}
```

## 前端接入步骤

### 步骤 1: 更新 OAuth 按钮组件

由于后端只实现了 LinuxDo OAuth，需要更新按钮组件只显示 LinuxDo：

```tsx
// frontend/components/auth/oauth-buttons.tsx
"use client";

import { oauthRedirect } from "@/lib/auth/oauth-redirect";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n-context";

interface OAuthButtonsProps {
  redirectUrl?: string;
  showDivider?: boolean;
}

export function OAuthButtons({ redirectUrl, showDivider = true }: OAuthButtonsProps) {
  const { t } = useI18n();

  const handleLinuxDoLogin = () => {
    // 保存重定向地址
    if (redirectUrl) {
      oauthRedirect.save(redirectUrl);
    } else {
      oauthRedirect.save();
    }

    // 直接跳转到后端授权端点（后端会重定向到 LinuxDo）
    window.location.href = "/auth/oauth/linuxdo/authorize";
  };

  return (
    <div className="space-y-4">
      {showDivider && (
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground">
              {t("auth.oauth_divider")}
            </span>
          </div>
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        onClick={handleLinuxDoLogin}
        className="w-full"
      >
        <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
          {/* LinuxDo Logo - 可以替换为实际的 logo */}
          <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z" />
        </svg>
        {t("auth.oauth_linuxdo")}
      </Button>
    </div>
  );
}
```

### 步骤 2: 添加国际化文案

```tsx
// frontend/lib/i18n/auth.ts
export const authTranslations: Record<Language, Record<string, string>> = {
  zh: {
    // ... 现有文案 ...
    "auth.oauth_linuxdo": "使用 LinuxDo 继续",
  },
  en: {
    // ... 现有文案 ...
    "auth.oauth_linuxdo": "Continue with LinuxDo",
  },
};
```

### 步骤 3: 回调页面已经创建

回调页面 `frontend/app/(auth)/callback/page.tsx` 已经创建好，会自动处理：
- ✅ 提取 URL 中的 `code` 和 `state` 参数
- ✅ 调用后端 `/auth/oauth/callback` API
- ✅ 存储 token 和用户信息
- ✅ 跳转到目标页面

**无需修改**，因为它已经兼容后端的 API 格式。

### 步骤 4: 在登录对话框中集成

在 `frontend/components/auth/auth-dialog.tsx` 中添加 OAuth 按钮：

```tsx
import { OAuthButtons } from "@/components/auth/oauth-buttons";

export function AuthDialog() {
  // ... 现有代码 ...

  return (
    <Dialog open={isAuthDialogOpen} onOpenChange={closeAuthDialog}>
      <DialogContent className="max-w-md w-full">
        <DialogHeader className="text-center">
          <DialogTitle className="text-2xl font-serif font-bold">
            {t("app.title")}
          </DialogTitle>
          <DialogDescription>
            {isLogin ? t("auth.login.subtitle") : t("auth.register.subtitle")}
          </DialogDescription>
        </DialogHeader>

        {/* 添加 OAuth 登录按钮 */}
        <OAuthButtons redirectUrl={redirectTo} />

        <BrushBorder className="mt-4">
          {/* 现有的邮箱密码登录表单 */}
          {isLogin ? (
            <form onSubmit={loginForm.handleSubmit(handleLogin)}>
              {/* ... */}
            </form>
          ) : (
            <form onSubmit={registerForm.handleSubmit(handleRegister)}>
              {/* ... */}
            </form>
          )}
        </BrushBorder>

        {/* 切换登录/注册 */}
        <div className="mt-4 text-center text-sm">
          {/* ... */}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

## 完整的登录流程

```
1. 用户点击"使用 LinuxDo 继续"按钮
   ↓
2. 前端保存当前页面地址到 sessionStorage
   ↓
3. 前端跳转到 /auth/oauth/linuxdo/authorize
   ↓
4. 后端生成 state 并存储到 Redis
   ↓
5. 后端重定向到 LinuxDo 授权页面
   ↓
6. 用户在 LinuxDo 授权
   ↓
7. LinuxDo 回调到前端 /callback?code=xxx&state=xxx
   ↓
8. 前端回调页面提取 code 和 state
   ↓
9. 前端调用后端 POST /auth/oauth/callback
   ↓
10. 后端验证 state、获取 token、同步用户信息
    ↓
11. 后端返回 access_token、refresh_token 和用户信息
    ↓
12. 前端存储 token 和用户信息
    ↓
13. 前端跳转到保存的页面或 /dashboard
```

## 环境变量配置

### 后端 (.env)

```env
# LinuxDo OAuth 配置
LINUXDO_OAUTH_ENABLED=true
LINUXDO_CLIENT_ID=your_client_id
LINUXDO_CLIENT_SECRET=your_client_secret
LINUXDO_REDIRECT_URI=https://ai.ethereals.space/callback

# 可选：自定义端点（使用默认值即可）
# LINUXDO_AUTHORIZE_ENDPOINT=https://connect.linux.do/oauth2/authorize
# LINUXDO_TOKEN_ENDPOINT=https://connect.linux.do/oauth2/token
# LINUXDO_USERINFO_ENDPOINT=https://connect.linux.do/api/user
```

### 前端 (.env.local)

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

## LinuxDo OAuth 应用配置

在 LinuxDo Connect 后台配置：

- **应用名称**: AI 终网关
- **应用主页**: https://ai.ethereals.space/
- **回调地址**: 
  - 开发环境: `http://localhost:3000/callback`
  - 生产环境: `https://ai.ethereals.space/callback`

## 测试清单

- [ ] 点击 LinuxDo 按钮能正确跳转到授权页面
- [ ] 授权后能正确回调到 /callback 页面
- [ ] 回调页面显示"正在处理 OAuth 登录..."
- [ ] Token 能正确存储到 localStorage/Cookie
- [ ] 用户信息能正确更新到 auth store
- [ ] 能正确跳转到目标页面
- [ ] 取消授权能正确返回登录页并显示错误
- [ ] State 过期（5分钟后）能正确提示错误
- [ ] 重复使用同一个 code 会被拒绝

## 错误处理

后端可能返回的错误：

| 错误信息 | HTTP 状态码 | 原因 |
|---------|-----------|------|
| LinuxDo OAuth 尚未启用 | 503 | 后端未配置 LINUXDO_OAUTH_ENABLED=true |
| LinuxDo OAuth 配置缺失 | 503 | 缺少 CLIENT_ID 或 CLIENT_SECRET |
| 缺少授权码参数 | 400 | 回调时没有 code 参数 |
| 缺少 state 参数 | 400 | 回调时没有 state 参数 |
| state 无效或已过期 | 400 | state 不存在或超过5分钟 |
| LinuxDo token 接口请求失败 | 502 | 网络问题或 LinuxDo 服务异常 |
| LinuxDo token 接口返回错误状态 | 502 | LinuxDo 拒绝了 token 请求 |
| LinuxDo 用户信息接口请求失败 | 502 | 无法获取用户信息 |

前端回调页面会自动处理这些错误并显示友好提示。

## 与现有代码的兼容性

✅ **完全兼容** - 回调页面已经按照标准 OAuth 流程实现，与后端 API 格式完全匹配：

1. 后端返回的 `OAuthCallbackResponse` 包含：
   - `access_token`
   - `refresh_token`
   - `token_type`
   - `expires_in`
   - `user` (UserResponse)

2. 前端回调页面期望的响应格式：
   ```typescript
   const { access_token, refresh_token, user } = response.data;
   ```

3. Token 存储方式一致：
   - 使用 `tokenManager.setAccessToken()`
   - 使用 `tokenManager.setRefreshToken()`
   - OAuth 登录默认 `remember: true`（7天有效期）

## 下一步

1. ✅ 更新 `frontend/components/auth/oauth-buttons.tsx` - 只显示 LinuxDo 按钮
2. ✅ 添加 `auth.oauth_linuxdo` 国际化文案
3. ✅ 在登录对话框中集成 OAuth 按钮
4. ✅ 测试完整的登录流程
5. ✅ 处理边界情况和错误提示

所有核心代码已经准备好，只需要简单的集成即可！
