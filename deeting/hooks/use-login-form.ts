"use client"

import { useEffect, useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { useAuthService, type AuthError } from "@/hooks/use-auth"
import { useUserProfile } from "@/hooks/use-user"

export type EmailFormValues = { email: string; inviteCode?: string }
export type CodeFormValues = { code: string }

export type LoginStep = "email" | "code"

export interface UseLoginFormOptions {
  onSuccess?: () => void
  onError?: (error: AuthError) => void
}

export function useLoginForm({ onSuccess, onError }: UseLoginFormOptions = {}) {
  const t = useTranslations("auth.login.form")
  const [step, setStep] = useState<LoginStep>("email")
  const [email, setEmail] = useState("")
  const [inviteCode, setInviteCode] = useState("")
  const [showInviteCode, setShowInviteCode] = useState(false)
  const [countdown, setCountdown] = useState(0)

  const { sendCodeMutation, verifyCodeMutation } = useAuthService()
  const { refreshProfile } = useUserProfile()

  const emailForm = useForm<EmailFormValues>({
    resolver: zodResolver(
      z.object({
        email: z.string().email(t("emailInvalid")),
        inviteCode: z.string().optional(),
      })
    ),
    defaultValues: { email: "", inviteCode: "" },
  })

  const codeForm = useForm<CodeFormValues>({
    resolver: zodResolver(
      z.object({
        code: z.string().length(6, t("codeInvalid")),
      })
    ),
    defaultValues: { code: "" },
  })

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown((v) => v - 1), 1000)
      return () => clearTimeout(timer)
    }
  }, [countdown])

  const isLoading = useMemo(
    () => sendCodeMutation.isMutating || verifyCodeMutation.isMutating,
    [sendCodeMutation.isMutating, verifyCodeMutation.isMutating]
  )

  async function handleSendCode(data: EmailFormValues) {
    // 如果显示了邀请码输入框但未填写，提示用户
    if (showInviteCode && !data.inviteCode?.trim()) {
      emailForm.setError("inviteCode", {
        type: "manual",
        message: t("inviteRequired"),
      })
      return
    }

    try {
      await sendCodeMutation.trigger({
        email: data.email,
        invite_code: data.inviteCode || undefined,
      })

      setEmail(data.email)
      setInviteCode(data.inviteCode || "")
      setStep("code")
      setCountdown(60)
      toast.success(t("toast.codeSent"))
    } catch (error) {
      const err = error as AuthError & { status?: number; code?: string }
      if (err.status === 403 || err.code === "INVITE_CODE_REQUIRED") {
        setShowInviteCode(true)
        return
      }
      toast.error(err.message || t("toast.error"))
      onError?.(err)
    }
  }

  async function handleVerifyCode(data: CodeFormValues) {
    try {
      await verifyCodeMutation.trigger({
        email,
        code: data.code,
        invite_code: inviteCode || undefined,
      })
      await refreshProfile()
      toast.success(t("toast.loginSuccess"))
      onSuccess?.()
    } catch (error) {
      const err = error as AuthError
      toast.error(err.message || t("toast.error"))
      onError?.(err)
    }
  }

  async function handleResendCode() {
    if (countdown > 0) return
    try {
      await sendCodeMutation.trigger({
        email,
        invite_code: inviteCode || undefined,
      })
      setCountdown(60)
      toast.success(t("toast.resendSuccess"))
    } catch (error) {
      const err = error as AuthError
      toast.error(err.message || t("toast.error"))
      onError?.(err)
    }
  }

  return {
    step,
    setStep,
    email,
    inviteCode,
    showInviteCode,
    setShowInviteCode,
    countdown,
    isLoading,
    emailForm,
    codeForm,
    handleSendCode,
    handleVerifyCode,
    handleResendCode,
  }
}
