"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/ui/shadcn/button"
import { GlassCard } from "@/ui/common/glass-card"
import { Input } from "@/ui/shadcn/input"
import { createAdminUser } from "@/lib/api/admin-dashboard"

interface UserCreateFormProps {
  onSuccess?: (user: { email: string; id: string }) => void
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
        <Input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder={t("placeholders.email")}
        />
        <Input
          type="text"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder={t("placeholders.usernameOptional")}
        />
        <Input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={t("placeholders.temporaryPassword")}
        />
        <Button
          onClick={() => void handleSubmit()}
          disabled={!email.trim() || !password.trim() || isSubmitting}
          size="sm"
        >
          {isSubmitting ? t("actions.submitting") : t("actions.createUser")}
        </Button>
      </div>
      {feedback && <p className="mt-2 text-xs text-[var(--muted)]">{feedback}</p>}
    </GlassCard>
  )
}

export default UserCreateForm
