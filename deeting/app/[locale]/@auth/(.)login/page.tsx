"use client"

import { useRouter } from "next/navigation"
import { LoginModal } from "@/components/auth"

/**
 * 路由拦截页面 - 拦截 /login 路由
 * 在当前页面上方显示 Dialog，而不是跳转到新页面
 * 这样用户可以在不离开当前页面的情况下登录
 */
export default function LoginInterceptPage() {
  const router = useRouter()

  return (
    <LoginModal
      open={true}
      onOpenChange={(open) => {
        if (!open) {
          router.back()
        }
      }}
      onLoginSuccess={() => {
        router.back()
        router.refresh()
      }}
    />
  )
}
