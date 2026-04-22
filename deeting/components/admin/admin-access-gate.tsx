"use client"

import Link from "next/link"
import { ShieldAlert } from "lucide-react"

import { useUserProfile } from "@/hooks/use-user"
import { Button } from "@/ui/shadcn/button"

export function AdminAccessGate({ children }: { children: React.ReactNode }) {
  const { profile, isLoading, isAuthenticated } = useUserProfile()

  if (isLoading) {
    return (
      <main className="min-h-[calc(100vh-4rem)] bg-[var(--window-bg)] p-6">
        <div className="h-[320px] animate-pulse rounded-[32px] border border-[var(--hairline)] bg-[var(--panel-bg)]" />
      </main>
    )
  }

  if (!isAuthenticated || !profile?.is_superuser) {
    return (
      <main className="min-h-[calc(100vh-4rem)] bg-[var(--window-bg)] p-6">
        <section className="relative isolate mx-auto flex min-h-[520px] max-w-4xl items-center justify-center overflow-hidden rounded-[36px] border border-[var(--hairline)] bg-[var(--panel-bg)] p-8 text-center shadow-[0_24px_80px_-64px_color-mix(in_srgb,var(--ink)_45%,transparent)]">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,color-mix(in_srgb,var(--accent-soft)_80%,transparent),transparent_34%),radial-gradient(circle_at_80%_80%,color-mix(in_srgb,var(--ink)_10%,transparent),transparent_32%)]" />
          <div className="relative max-w-lg space-y-5">
            <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border border-[var(--hairline)] bg-[var(--window-bg)] text-[var(--accent-strong)]">
              <ShieldAlert className="size-6" />
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-[-0.04em] text-[var(--ink)]">Admin access required</h1>
              <p className="text-sm leading-6 text-[var(--ink-2)]">
                This console is only visible to superuser accounts. The sidebar entry is hidden for normal users, and direct access is blocked here.
              </p>
            </div>
            <Button asChild>
              <Link href="/">Return to workspace</Link>
            </Button>
          </div>
        </section>
      </main>
    )
  }

  return <>{children}</>
}
