import { LoginForm } from "@/components/auth"

/**
 * 独立的登录页面
 * - 移动端用户直接访问
 * - 用户刷新拦截路由时显示
 */
export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-[400px] space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-bold">登录</h1>
          <p className="text-muted-foreground">
            使用邮箱验证码或第三方账号登录
          </p>
        </div>
        <LoginForm />
      </div>
    </div>
  )
}
