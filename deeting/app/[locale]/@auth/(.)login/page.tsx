"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { LoginModal } from "@/components/auth"

/**
 * 路由拦截页面 - 拦截 /login 路由
 * 在当前页面上方显示 Dialog，而不是跳转到新页面
 * 这样用户可以在不离开当前页面的情况下登录
 */
export default function LoginInterceptPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get("callbackUrl")

  const getSafeTarget = () => {
    if (!callbackUrl) return "/"
    if (!callbackUrl.startsWith("/") || callbackUrl.startsWith("//")) return "/"
    if (/(^|\/)login(?:$|[/?#])/i.test(callbackUrl)) return "/"
    return callbackUrl
  }

  const navigateAwayFromLogin = () => {
    router.replace(getSafeTarget())
    router.refresh()
  }

  const handleLoginSuccess = () => {
    navigateAwayFromLogin()
  }

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      navigateAwayFromLogin()
    }
  }

  return (
    <LoginModal
      open={true}
      onOpenChange={handleOpenChange}
      onLoginSuccess={handleLoginSuccess}
    />
  )
}
