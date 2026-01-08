# OAuth 登录集成示例

## 在登录对话框中集成 OAuth 按钮

### 方法 1：直接在 AuthDialog 中添加

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

        {/* OAuth 登录按钮 */}
        <OAuthButtons redirectUrl={redirectTo} />

        <BrushBorder className="mt-4">
          {/* 现有的邮箱密码登录表单 */}
          {isLogin ? (
            <form onSubmit={loginForm.handleSubmit(handleLogin)} className="space-y-6">
              {/* ... 表单内容 ... */}
            </form>
          ) : (
            <form onSubmit={registerForm.handleSubmit(handleRegister)} className="space-y-6">
              {/* ... 表单内容 ... */}
            </form>
          )}
        </BrushBorder>

        {/* 切换登录/注册模式 */}
        <div className="mt-4 text-center text-sm">
          {/* ... 现有代码 ... */}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

### 方法 2：创建独立的 OAuth 登录页面

创建 `frontend/app/(auth)/oauth/page.tsx`：

```tsx
"use client";

import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { useI18n } from "@/lib/i18n-context";
import Link from "next/link";

export default function OAuthLoginPage() {
  const { t } = useI18n();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="max-w-md w-full px-4">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-serif font-bold mb-2">
            {t("app.title")}
          </h1>
          <p className="text-muted-foreground">
            {t("auth.login.subtitle")}
          </p>
        </div>

        <div className="bg-card border rounded-lg p-6 shadow-sm">
          <OAuthButtons showDivider={false} />

          <div className="mt-6 text-center">
            <Link
              href="/login"
              className="text-sm text-muted-foreground hover:text-primary"
            >
              使用邮箱密码登录
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
```

## 在任意页面添加 OAuth 登录

### 示例：在受保护页面添加登录提示

```tsx
"use client";

import { useAuthStore } from "@/lib/stores/auth-store";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { usePathname } from "next/navigation";

export function ProtectedContent() {
  const { isAuthenticated } = useAuthStore();
  const pathname = usePathname();

  if (!isAuthenticated) {
    return (
      <div className="max-w-md mx-auto mt-20 p-6 border rounded-lg">
        <h2 className="text-xl font-bold mb-4">需要登录</h2>
        <p className="text-muted-foreground mb-6">
          请登录以访问此页面
        </p>
        <OAuthButtons redirectUrl={pathname} />
      </div>
    );
  }

  return (
    <div>
      {/* 受保护的内容 */}
    </div>
  );
}
```

## 自定义 OAuth 按钮样式

### 创建自定义按钮

```tsx
"use client";

import { oauthRedirect } from "@/lib/auth/oauth-redirect";
import { Button } from "@/components/ui/button";

interface CustomOAuthButtonProps {
  provider: string;
  icon?: React.ReactNode;
  label: string;
  redirectUrl?: string;
}

export function CustomOAuthButton({
  provider,
  icon,
  label,
  redirectUrl,
}: CustomOAuthButtonProps) {
  const handleClick = () => {
    if (redirectUrl) {
      oauthRedirect.save(redirectUrl);
    } else {
      oauthRedirect.save();
    }
    window.location.href = `/api/auth/oauth/${provider}/authorize`;
  };

  return (
    <Button
      type="button"
      variant="outline"
      onClick={handleClick}
      className="w-full"
    >
      {icon && <span className="mr-2">{icon}</span>}
      {label}
    </Button>
  );
}
```

使用示例：

```tsx
<CustomOAuthButton
  provider="google"
  label="使用 Google 登录"
  icon={<GoogleIcon />}
  redirectUrl="/dashboard"
/>
```

## 处理 OAuth 错误

### 在登录页面显示错误信息

```tsx
"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n-context";

export function LoginPage() {
  const searchParams = useSearchParams();
  const { t } = useI18n();

  useEffect(() => {
    const error = searchParams.get("error");
    if (error) {
      let message = t("auth.oauth_failed");
      
      switch (error) {
        case "oauth_failed":
          message = t("auth.oauth_failed");
          break;
        case "missing_code":
          message = t("auth.oauth_missing_code");
          break;
        case "access_denied":
          message = "用户取消了授权";
          break;
        default:
          message = `登录失败: ${error}`;
      }
      
      toast.error(message);
    }
  }, [searchParams, t]);

  return (
    <div>
      {/* 登录页面内容 */}
    </div>
  );
}
```

## 测试 OAuth 登录流程

### 1. 本地测试配置

在 `.env.local` 中配置：

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

### 2. 测试步骤

1. 启动后端服务
2. 启动前端服务
3. 访问登录页面
4. 点击 OAuth 登录按钮
5. 完成 OAuth 授权
6. 验证是否正确跳转到目标页面

### 3. 调试技巧

在浏览器控制台查看日志：

```javascript
// 查看保存的重定向地址
console.log(sessionStorage.getItem("oauth_redirect"));

// 查看当前 token
console.log(localStorage.getItem("access_token"));
console.log(document.cookie);
```

## 常见问题排查

### 问题 1：点击按钮后没有跳转

**原因**：后端 OAuth 授权端点配置错误

**解决**：检查后端路由配置，确保 `/api/auth/oauth/{provider}/authorize` 端点存在

### 问题 2：回调后显示错误

**原因**：后端验证失败或返回格式不正确

**解决**：
1. 检查后端日志
2. 验证 OAuth 配置（Client ID、Secret）
3. 确认回调地址在 OAuth 提供商后台配置正确

### 问题 3：登录成功但没有跳转

**原因**：重定向地址保存或读取失败

**解决**：
1. 检查浏览器是否禁用了 sessionStorage
2. 确认在跳转前调用了 `oauthRedirect.save()`
3. 查看浏览器控制台是否有错误

### 问题 4：Token 存储失败

**原因**：浏览器安全策略限制

**解决**：
1. 确保使用 HTTPS（生产环境）
2. 检查 Cookie 设置（SameSite、Secure）
3. 验证浏览器是否允许第三方 Cookie
