"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { useAuthStore } from "@/store/auth-store"

export function ChatAuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const redirectedRef = React.useRef(false)

  const [isHydrated, setIsHydrated] = React.useState(() =>
    useAuthStore.persist.hasHydrated()
  )

  React.useEffect(() => {
    const onHydrate = () => setIsHydrated(false)
    const onFinishHydration = () => setIsHydrated(true)

    const unsubscribeHydrate = useAuthStore.persist.onHydrate(onHydrate)
    const unsubscribeFinish = useAuthStore.persist.onFinishHydration(onFinishHydration)

    setIsHydrated(useAuthStore.persist.hasHydrated())

    return () => {
      unsubscribeHydrate()
      unsubscribeFinish()
    }
  }, [])

  const callbackUrl = React.useMemo(() => {
    const currentPath = pathname || "/chat"
    const query = searchParams?.toString()
    return query ? `${currentPath}?${query}` : currentPath
  }, [pathname, searchParams])

  React.useEffect(() => {
    if (!isHydrated || isAuthenticated) {
      redirectedRef.current = false
      return
    }

    if (redirectedRef.current) return
    redirectedRef.current = true

    const target = `/login?callbackUrl=${encodeURIComponent(callbackUrl)}`
    router.replace(target)
  }, [callbackUrl, isAuthenticated, isHydrated, router])

  if (!isHydrated || !isAuthenticated) {
    return null
  }

  return <>{children}</>
}
