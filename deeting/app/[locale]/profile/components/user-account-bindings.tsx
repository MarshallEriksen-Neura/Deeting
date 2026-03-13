"use client"

import { useMemo, useState } from "react"
import { BadgeCheck, Github, Link2, Mail } from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { GlassButton } from "@/components/ui/glass-button"
import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardHeader,
  GlassCardTitle,
} from "@/components/ui/glass-card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { useAccountBindings } from "@/hooks/use-account-bindings"
import { isTauriRuntime } from "@/lib/api/desktop-config"

type OAuthProvider = "google" | "github"

function providerLabel(t: ReturnType<typeof useTranslations>, provider: OAuthProvider) {
  return provider === "google"
    ? t("bindings.providers.google")
    : t("bindings.providers.github")
}

export function UserAccountBindings() {
  const t = useTranslations("profile")
  const { bindings, isLoading, startOauthBinding, sendEmailCode, confirmEmailCode } =
    useAccountBindings()
  const [pendingProvider, setPendingProvider] = useState<OAuthProvider | null>(null)
  const [emailDraft, setEmailDraft] = useState("")
  const [pendingEmail, setPendingEmail] = useState("")
  const [emailCode, setEmailCode] = useState("")
  const [isSendingEmail, setIsSendingEmail] = useState(false)
  const [isConfirmingEmail, setIsConfirmingEmail] = useState(false)
  const desktopOnly = useMemo(() => isTauriRuntime(), [])

  const handleOauthBind = async (provider: OAuthProvider) => {
    setPendingProvider(provider)
    try {
      await startOauthBinding(provider)
    } catch (error) {
      const message = error instanceof Error ? error.message : t("bindings.errors.oauth")
      toast.error(message)
    } finally {
      setPendingProvider(null)
    }
  }

  const handleSendEmailCode = async () => {
    if (!emailDraft.trim()) return
    setIsSendingEmail(true)
    try {
      await sendEmailCode(emailDraft.trim())
      setPendingEmail(emailDraft.trim())
      toast.success(t("bindings.email.codeSent"))
    } catch (error) {
      const message = error instanceof Error ? error.message : t("bindings.errors.emailSend")
      toast.error(message)
    } finally {
      setIsSendingEmail(false)
    }
  }

  const handleConfirmEmail = async () => {
    if (!pendingEmail || !emailCode.trim()) return
    setIsConfirmingEmail(true)
    try {
      await confirmEmailCode(pendingEmail, emailCode.trim())
      toast.success(t("bindings.email.bound"))
      setEmailDraft("")
      setPendingEmail("")
      setEmailCode("")
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("bindings.errors.emailConfirm")
      toast.error(message)
    } finally {
      setIsConfirmingEmail(false)
    }
  }

  if (isLoading || !bindings) {
    return (
      <GlassCard padding="none" hover="none" className="border-none shadow-sm overflow-hidden">
        <div className="p-6 space-y-4">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      </GlassCard>
    )
  }

  return (
    <GlassCard padding="none" hover="none" className="border-none shadow-sm overflow-hidden">
      <GlassCardHeader className="p-6 pb-2">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-amber-500/10 text-amber-500">
            <Link2 size={20} />
          </div>
          <div>
            <GlassCardTitle>{t("bindings.title")}</GlassCardTitle>
            <GlassCardDescription>{t("bindings.description")}</GlassCardDescription>
          </div>
        </div>
      </GlassCardHeader>
      <GlassCardContent className="p-6 pt-4 space-y-4">
        {(["google", "github"] as const).map((provider) => {
          const binding = bindings.oauth[provider]
          return (
            <div
              key={provider}
              className="flex items-center justify-between rounded-xl border border-border/50 p-4"
            >
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-muted/40 p-2 text-muted-foreground">
                  {provider === "github" ? <Github size={18} /> : <BadgeCheck size={18} />}
                </div>
                <div>
                  <p className="text-sm font-medium">{providerLabel(t, provider)}</p>
                  <p className="text-xs text-muted-foreground">
                    {binding.is_bound
                      ? binding.display_name || t("bindings.connected")
                      : t("bindings.notBound")}
                  </p>
                </div>
              </div>
              {binding.is_bound ? (
                <Badge variant="secondary" className="bg-green-500/10 text-green-600">
                  {t("bindings.bound")}
                </Badge>
              ) : (
                <GlassButton
                  size="sm"
                  variant="outline"
                  disabled={!desktopOnly || pendingProvider === provider}
                  onClick={() => void handleOauthBind(provider)}
                >
                  {pendingProvider === provider ? t("bindings.binding") : t("bindings.bind")}
                </GlassButton>
              )}
            </div>
          )
        })}

        <div className="rounded-xl border border-border/50 p-4 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-muted/40 p-2 text-muted-foreground">
                <Mail size={18} />
              </div>
              <div>
                <p className="text-sm font-medium">{t("bindings.providers.email")}</p>
                <p className="text-xs text-muted-foreground">
                  {t("bindings.email.primary", { email: bindings.email.primary_email })}
                </p>
              </div>
            </div>
            <Badge variant="secondary" className="bg-green-500/10 text-green-600">
              {t("bindings.bound")}
            </Badge>
          </div>

          {bindings.email.aliases.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {bindings.email.aliases.map((alias) => (
                <Badge key={alias.email} variant="secondary">
                  {alias.email}
                </Badge>
              ))}
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_140px]">
            <Input
              value={emailDraft}
              onChange={(event) => setEmailDraft(event.target.value)}
              placeholder={t("bindings.email.placeholder")}
              className="bg-background/50 border-border/50 focus:border-primary/50"
            />
            <GlassButton
              variant="outline"
              disabled={isSendingEmail || !emailDraft.trim()}
              onClick={() => void handleSendEmailCode()}
            >
              {isSendingEmail ? t("bindings.email.sending") : t("bindings.email.sendCode")}
            </GlassButton>
          </div>

          {pendingEmail ? (
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_140px]">
              <Input
                value={emailCode}
                onChange={(event) => setEmailCode(event.target.value)}
                placeholder={t("bindings.email.codePlaceholder", { email: pendingEmail })}
                className="bg-background/50 border-border/50 focus:border-primary/50"
              />
              <GlassButton
                disabled={isConfirmingEmail || emailCode.trim().length < 6}
                onClick={() => void handleConfirmEmail()}
              >
                {isConfirmingEmail
                  ? t("bindings.email.confirming")
                  : t("bindings.email.confirm")}
              </GlassButton>
            </div>
          ) : null}
        </div>
      </GlassCardContent>
    </GlassCard>
  )
}
