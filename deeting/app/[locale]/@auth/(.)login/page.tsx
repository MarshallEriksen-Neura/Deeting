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

  const handleLoginSuccess = () => {
    // 优先使用 callbackUrl，否则返回上一页，最后默认首页
    if (callbackUrl) {
      router.push(callbackUrl)
    } else if (window.history.length > 1) {
      router.back()
    } else {
      router.push("/")
    }
    router.refresh()
  }

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      router.back()
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
