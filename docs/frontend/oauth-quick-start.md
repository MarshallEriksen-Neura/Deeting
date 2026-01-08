# OAuth 前端快速接入指南

## ✅ 已完成的工作

### 1. 核心文件已创建
- ✅ `frontend/app/(auth)/callback/page.tsx` - OAuth 回调处理页面
- ✅ `frontend/lib/auth/oauth-redirect.ts` - 重定向地址管理
- ✅ `frontend/components/auth/oauth-buttons.tsx` - LinuxDo 登录按钮
- ✅ `frontend/lib/i18n/auth.ts` - 国际化文案（已添加 OAuth 相关）

### 2. 后端 API 已实现
- ✅ `GET /auth/oauth/linuxdo/authorize` - 生成授权链接并重定向
- ✅ `POST /auth/oauth/callback` - 处理回调并返回 token

## 🚀 接入步骤

### 步骤 1: 在登录对话框中添加 OAuth 按钮

编辑 `frontend/components/auth/auth-dialog.tsx`：

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

        {/* 👇 添加这一行 */}
        <OAuthButtons redirectUrl={redirectTo} />

        <BrushBorder className="mt-4">
          {/* 现有的邮箱密码登录表单 */}
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

### 步骤 2: 配置环境变量

#### 后端 `.env`
```env
# LinuxDo OAuth 配置
LINUXDO_OAUTH_ENABLED=true
LINUXDO_CLIENT_ID=你的_client_id
LINUXDO_CLIENT_SECRET=你的_client_secret
LINUXDO_REDIRECT_URI=https://ai.ethereals.space/callback
```

#### 前端 `.env.local`
```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

### 步骤 3: 在 LinuxDo 配置回调地址

在 LinuxDo Connect 应用配置中填写：

**回调地址**:
- 开发环境: `http://localhost:3000/callback`
- 生产环境: `https://ai.ethereals.space/callback`

## 🎯 完整的登录流程

```
用户点击"使用 LinuxDo 继续"
    ↓
前端保存当前页面地址
    ↓
跳转到 /auth/oauth/linuxdo/authorize
    ↓
后端生成 state 并重定向到 LinuxDo
    ↓
用户在 LinuxDo 授权
    ↓
LinuxDo 回调到 /callback?code=xxx&state=xxx
    ↓
前端回调页面调用 POST /auth/oauth/callback
    ↓
后端验证并返回 token + 用户信息
    ↓
前端存储 token 并更新用户状态
    ↓
跳转到目标页面
```

## 🧪 测试清单

在浏览器中测试以下场景：

- [ ] 点击"使用 LinuxDo 继续"按钮
- [ ] 能正确跳转到 LinuxDo 授权页面
- [ ] 授权后能回调到 `/callback` 页面
- [ ] 回调页面显示"正在处理 OAuth 登录..."
- [ ] 登录成功后显示绿色勾号
- [ ] 能正确跳转到仪表盘或原页面
- [ ] 用户信息正确显示在导航栏
- [ ] 刷新页面后仍保持登录状态

### 错误场景测试

- [ ] 取消授权能返回登录页并显示错误
- [ ] 后端未配置时显示友好错误提示
- [ ] 网络错误时显示重试提示

## 📝 代码示例

### 在任意页面添加 OAuth 登录

```tsx
import { OAuthButtons } from "@/components/auth/oauth-buttons";

export function MyPage() {
  return (
    <div>
      <h1>需要登录</h1>
      <OAuthButtons redirectUrl="/my-target-page" />
    </div>
  );
}
```

### 只显示按钮，不显示分隔线

```tsx
<OAuthButtons showDivider={false} />
```

### 自定义重定向地址

```tsx
<OAuthButtons redirectUrl="/dashboard/settings" />
```

## 🐛 常见问题

### Q: 点击按钮后没有反应？

**检查**:
1. 浏览器控制台是否有错误
2. 后端是否正常运行
3. `LINUXDO_OAUTH_ENABLED` 是否设置为 `true`

### Q: 回调后显示错误？

**检查**:
1. LinuxDo 回调地址是否配置正确
2. 后端 `LINUXDO_REDIRECT_URI` 是否与前端回调页面一致
3. `LINUXDO_CLIENT_ID` 和 `LINUXDO_CLIENT_SECRET` 是否正确

### Q: 登录成功但没有跳转？

**检查**:
1. 浏览器控制台查看是否有 JavaScript 错误
2. 检查 sessionStorage 中是否有 `oauth_redirect` 键
3. 确认 `oauthRedirect.save()` 在跳转前被调用

### Q: Token 存储失败？

**检查**:
1. 浏览器是否禁用了 Cookie 或 localStorage
2. 是否在隐私模式/无痕模式下测试
3. 检查浏览器控制台的存储标签页

## 📚 相关文档

- [OAuth 集成详细指南](./oauth-integration.md)
- [LinuxDo OAuth 接入方案](./oauth-linuxdo-integration.md)
- [OAuth 集成示例](./oauth-integration-example.md)
- [认证错误处理](./auth-error-handling.md)

## 🎉 完成！

完成以上步骤后，你的应用就支持 LinuxDo OAuth 登录了！

用户可以通过以下方式登录：
1. 邮箱 + 密码（原有方式）
2. LinuxDo OAuth（新增方式）

两种方式的用户数据会自动关联（通过 `identities` 表）。
