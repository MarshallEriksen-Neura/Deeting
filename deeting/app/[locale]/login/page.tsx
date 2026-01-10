import { getTranslations } from "next-intl/server"
import { LoginForm } from "@/components/auth"

/**
 * 独立的登录页面
 * Digital Ink 设计风格 - 新中式数字水墨
 */
export default async function LoginPage() {
  const t = await getTranslations("auth.login.page")
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#F7F9FB]">
      {/* 背景环境光效果 - 水墨晕染 */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse 80% 50% at 50% -20%, rgba(37, 99, 235, 0.08), transparent 70%),
            radial-gradient(ellipse 60% 40% at 80% 100%, rgba(37, 99, 235, 0.04), transparent 60%)
          `,
        }}
      />

      {/* 主内容 */}
      <div className="relative flex min-h-screen items-center justify-center p-4">
        {/* Glass Card 容器 */}
        <div
          className="w-full max-w-[400px] space-y-8 rounded-2xl bg-white/85 p-8 backdrop-blur-xl"
          style={{
            boxShadow: `
              0 4px 6px -1px rgba(0, 0, 0, 0.02),
              0 10px 15px -3px rgba(0, 0, 0, 0.04),
              0 25px 50px -12px rgba(37, 99, 235, 0.06)
            `,
            border: "1px solid rgba(255, 255, 255, 0.2)",
          }}
        >
          {/* Logo & 标题 */}
          <div className="space-y-2 text-center">
            {/* Logo */}
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center">
              <svg
                viewBox="0 0 32 32"
                fill="none"
                className="h-10 w-10"
                xmlns="http://www.w3.org/2000/svg"
              >
                <rect
                  width="32"
                  height="32"
                  rx="8"
                  className="fill-blue-500"
                />
                <path
                  d="M10 16L14 20L22 12"
                  stroke="white"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>

            <h1 className="text-2xl font-bold tracking-tight text-slate-800">
              {t("title")}
            </h1>
            <p className="text-sm text-slate-500">{t("subtitle")}</p>
          </div>

          {/* 登录表单 */}
          <LoginForm />
        </div>
      </div>

      {/* 底部装饰 */}
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent" />
    </div>
  )
}
