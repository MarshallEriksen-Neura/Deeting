"use client"

import { useCallback, useRef, useState } from "react"
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
  const [open, setOpen] = useState(true)
  const hasNavigatedRef = useRef(false)

  const getSafeTarget = useCallback(() => {
    if (!callbackUrl) return "/"
    if (!callbackUrl.startsWith("/") || callbackUrl.startsWith("//")) return "/"
    if (/(^|\/)login(?:$|[/?#])/i.test(callbackUrl)) return "/"
    return callbackUrl
  }, [callbackUrl])

  const navigateAwayFromLogin = useCallback(() => {
    if (hasNavigatedRef.current) return
    hasNavigatedRef.current = true
    setOpen(false)
    router.replace(getSafeTarget())
    router.refresh()
  }, [getSafeTarget, router])

  const handleLoginSuccess = useCallback(() => {
    navigateAwayFromLogin()
  }, [navigateAwayFromLogin])

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) {
      navigateAwayFromLogin()
    }
  }, [navigateAwayFromLogin])

  return (
    <LoginModal
      open={open}
      onOpenChange={handleOpenChange}
      onLoginSuccess={handleLoginSuccess}
    />
  )
}
