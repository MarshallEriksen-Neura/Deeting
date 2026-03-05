"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { GlassCard } from "@/components/ui/glass-card"
import { createAdminUser } from "@/lib/api/admin-dashboard"

interface UserCreateFormProps {
  /**
   * 创建成功后的回调
   */
  onSuccess?: (user: { email: string; id: string }) => void
  /**
   * 创建失败后的回调
   */
  onError?: (error: string) => void
}

export function UserCreateForm({ onSuccess, onError }: UserCreateFormProps) {
  const t = useTranslations("admin.usersPage.createForm")
  const [email, setEmail] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!email.trim() || !password.trim() || isSubmitting) return

    setIsSubmitting(true)
    setFeedback(null)

    try {
      const result = await createAdminUser({
        email: email.trim(),
        password,
        username: username.trim() || undefined,
      })
      setEmail("")
      setUsername("")
      setPassword("")
      setFeedback(t("feedback.created", { email: result.email }))
      onSuccess?.(result)
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : t("feedback.createFailed")
      setFeedback(message)
      onError?.(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <GlassCard padding="default" hover="none">
      <div className="grid gap-3 md:grid-cols-4">
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder={t("placeholders.email")}
          className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-[var(--foreground)] focus:border-[var(--primary)]/50 focus:outline-none"
        />
        <input
          type="text"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder={t("placeholders.usernameOptional")}
          className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-[var(--foreground)] focus:border-[var(--primary)]/50 focus:outline-none"
        />
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={t("placeholders.temporaryPassword")}
          className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-[var(--foreground)] focus:border-[var(--primary)]/50 focus:outline-none"
        />
        <button
          onClick={() => void handleSubmit()}
          disabled={!email.trim() || !password.trim() || isSubmitting}
          className="inline-flex h-9 cursor-pointer items-center justify-center rounded-lg bg-[var(--primary)] px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? t("actions.submitting") : t("actions.createUser")}
        </button>
      </div>
      {feedback && <p className="mt-2 text-xs text-[var(--muted)]">{feedback}</p>}
    </GlassCard>
  )
}

export default UserCreateForm
