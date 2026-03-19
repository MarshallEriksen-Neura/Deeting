"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import { Loader2, Mail, ArrowRight, Ticket, Info, ExternalLink } from "lucide-react"

import { GlassButton } from "@/components/ui/glass-button"
import { Input } from "@/components/ui/input"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp"
import { Turnstile } from "@marsidev/react-turnstile"
import { cn } from "@/lib/utils"
import { useLoginForm } from "@/hooks/use-login-form"
import { useAuthService } from "@/hooks/use-auth"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { isTauriRuntime } from "@/lib/api/desktop-config"
import { useAuthStore } from "@/store/auth-store"

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""
const DESKTOP_EXTERNAL_LOGIN_URL = process.env.NEXT_PUBLIC_DESKTOP_EXTERNAL_LOGIN_URL ?? ""

export interface LoginFormProps {
  /** 登录成功后的回调 */
  onSuccess?: () => void | Promise<void>
  /** 登录失败的回调 */
  onError?: (error: Error) => void
  /** 自定义类名 */
  className?: string
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  if (typeof error === "string" && error.trim()) {
    return error
  }

  return fallback
}

// 滑出动画配置
const slideVariants = {
  hidden: {
    opacity: 0,
    height: 0,
    marginTop: 0,
  },
  visible: {
    opacity: 1,
    height: "auto",
    marginTop: 16,
    transition: {
      duration: 0.35,
      ease: [0.4, 0, 0.2, 1] as const,
      opacity: { delay: 0.1 },
    },
  },
  exit: {
    opacity: 0,
    height: 0,
    marginTop: 0,
    transition: {
      duration: 0.25,
      ease: [0.4, 0, 1, 1] as const,
    },
  },
}

export function LoginForm({ onSuccess, onError, className }: LoginFormProps) {
  const t = useTranslations("auth.login.form")
  const inviteCodeRef = React.useRef<HTMLInputElement>(null)
  const searchParams = useSearchParams()
  const tauriRuntime = isTauriRuntime()
  const desktopExternalLoginUrl = DESKTOP_EXTERNAL_LOGIN_URL.trim()
  const desktopLoginSessionId =
    !tauriRuntime ? searchParams.get("desktop_login_session")?.trim() ?? "" : ""
  const hasDesktopBrowserSession = desktopLoginSessionId.length > 0
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const {
    startDesktopBrowserLogin,
    refreshMutation,
    completeDesktopBrowserLogin,
  } = useAuthService()
  const [browserLoginLoading, setBrowserLoginLoading] = React.useState(false)
  const [browserReturnLoading, setBrowserReturnLoading] = React.useState(false)
  const attemptedBrowserRefreshRef = React.useRef(false)
  const completingBrowserLoginRef = React.useRef(false)

  const completeBrowserLoginAndReturn = React.useCallback(async () => {
    if (!hasDesktopBrowserSession) {
      return false
    }

    completingBrowserLoginRef.current = true
    setBrowserReturnLoading(true)
    const result = await completeDesktopBrowserLogin({
      session_id: desktopLoginSessionId,
    })
    toast.success(t("toast.desktopBrowserRedirecting"))
    window.location.assign(result.deep_link_url)
    return true
  }, [completeDesktopBrowserLogin, desktopLoginSessionId, hasDesktopBrowserSession, t])

  const handleLoginSuccess = React.useCallback(async () => {
    if (hasDesktopBrowserSession) {
      try {
        await completeBrowserLoginAndReturn()
        return
      } catch (error) {
        completingBrowserLoginRef.current = false
        setBrowserReturnLoading(false)
        const message = getErrorMessage(error, t("toast.desktopBrowserCompleteFailed"))
        toast.error(message)
        onError?.(error as Error)
        throw error
      }
    }

    await onSuccess?.()
  }, [completeBrowserLoginAndReturn, hasDesktopBrowserSession, onError, onSuccess, t])

  const {
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
    captchaRef,
    setCaptchaToken,
  } = useLoginForm({ onSuccess: handleLoginSuccess, onError })

  const isBusy =
    isLoading ||
    browserLoginLoading ||
    browserReturnLoading

  // 邀请码输入框展开后自动聚焦
  React.useEffect(() => {
    if (showInviteCode && inviteCodeRef.current) {
      const timer = setTimeout(() => {
        inviteCodeRef.current?.focus()
      }, 400)
      return () => clearTimeout(timer)
    }
  }, [showInviteCode])

  React.useEffect(() => {
    if (!hasDesktopBrowserSession || tauriRuntime || isAuthenticated || attemptedBrowserRefreshRef.current) {
      return
    }

    attemptedBrowserRefreshRef.current = true
    refreshMutation.trigger().catch(() => {})
  }, [hasDesktopBrowserSession, isAuthenticated, refreshMutation, tauriRuntime])

  React.useEffect(() => {
    if (
      !hasDesktopBrowserSession ||
      tauriRuntime ||
      !isAuthenticated ||
      completingBrowserLoginRef.current
    ) {
      return
    }

    void completeBrowserLoginAndReturn().catch((error) => {
      completingBrowserLoginRef.current = false
      setBrowserReturnLoading(false)
      const message = getErrorMessage(error, t("toast.desktopBrowserCompleteFailed"))
      toast.error(message)
      onError?.(error as Error)
    })
  }, [
    completeBrowserLoginAndReturn,
    hasDesktopBrowserSession,
    isAuthenticated,
    onError,
    t,
    tauriRuntime,
  ])

  async function handleDesktopBrowserLogin() {
    if (!desktopExternalLoginUrl) {
      toast.error(t("toast.desktopBrowserUrlMissing"))
      return
    }

    try {
      setBrowserLoginLoading(true)
      await startDesktopBrowserLogin(desktopExternalLoginUrl)
      toast.success(t("toast.desktopBrowserOpened"))
    } catch (error) {
      const err = error as Error
      toast.error(err.message || t("toast.error"))
      onError?.(err)
    } finally {
      setBrowserLoginLoading(false)
    }
  }

  return (
    <div className={cn("grid gap-6", className)}>
      {hasDesktopBrowserSession && (
        <div className="rounded-2xl border border-blue-100 bg-blue-50/80 p-4 text-left">
          <p className="text-sm font-semibold text-slate-800">
            {t("desktopBrowserReturnTitle")}
          </p>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            {browserReturnLoading
              ? t("desktopBrowserReturning")
              : t("desktopBrowserReturnDescription")}
          </p>
        </div>
      )}

      {tauriRuntime ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 text-left">
            <p className="text-sm font-semibold text-slate-800">
              {t("desktopBrowserTitle")}
            </p>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              {t("desktopBrowserDescription")}
            </p>
          </div>

          <GlassButton
            type="button"
            className={cn(
              "h-12 w-full rounded-xl font-medium",
              "bg-gradient-to-b from-blue-500 to-blue-600",
              "shadow-[0_4px_12px_-2px_rgba(37,99,235,0.35)]",
              "transition-all duration-200 ease-out",
              "hover:-translate-y-0.5 hover:shadow-[0_8px_20px_-4px_rgba(37,99,235,0.4)]",
              "active:translate-y-0 active:scale-[0.98]",
              "disabled:translate-y-0 disabled:opacity-70"
            )}
            disabled={isBusy}
            onClick={handleDesktopBrowserLogin}
          >
            {browserLoginLoading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ExternalLink className="mr-2 h-4 w-4" />
            )}
            {t("desktopBrowserAction")}
          </GlassButton>
        </div>
      ) : (
        <>
          {step === "email" ? (
            // 第一步：输入邮箱
            <Form {...emailForm}>
              <form onSubmit={emailForm.handleSubmit(handleSendCode)} className="space-y-4">
                {/* 邮箱输入 */}
                <FormField
                  control={emailForm.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium text-slate-700">
                        {t("emailLabel")}
                      </FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Mail className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                          <Input
                            type="email"
                            placeholder={t("emailPlaceholder")}
                            className={cn(
                              "h-12 rounded-xl border-0 bg-slate-50 pl-11 pr-4",
                              "placeholder:text-slate-400",
                              "transition-all duration-300 ease-out",
                              "focus:bg-white focus:shadow-[0_0_0_3px_rgba(37,99,235,0.1),0_4px_12px_-2px_rgba(37,99,235,0.08)]",
                              "focus-visible:ring-0 focus-visible:ring-offset-0"
                            )}
                            disabled={isBusy}
                            autoComplete="email"
                            {...field}
                          />
                        </div>
                      </FormControl>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />

                {/* 邀请码输入 - 滑出动画 */}
                <AnimatePresence>
                  {showInviteCode && (
                    <motion.div
                      variants={slideVariants}
                      initial="hidden"
                      animate="visible"
                      exit="exit"
                      className="overflow-hidden"
                    >
                      <FormField
                        control={emailForm.control}
                        name="inviteCode"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm font-medium text-slate-700">
                              {t("inviteLabel")}
                            </FormLabel>
                            <FormControl>
                              <div className="relative">
                                <Ticket className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                <Input
                                  type="text"
                                  placeholder={t("invitePlaceholder")}
                                  className={cn(
                                    "h-12 rounded-xl border-0 bg-slate-50 pl-11 pr-4",
                                    "placeholder:text-slate-400",
                                    "transition-all duration-300 ease-out",
                                    "focus:bg-white focus:shadow-[0_0_0_3px_rgba(37,99,235,0.1),0_4px_12px_-2px_rgba(37,99,235,0.08)]",
                                    "focus-visible:ring-0 focus-visible:ring-offset-0"
                                  )}
                                  disabled={isBusy}
                                  {...field}
                                  ref={(e) => {
                                    field.ref(e)
                                    inviteCodeRef.current = e
                                  }}
                                />
                              </div>
                            </FormControl>
                            <FormMessage className="text-xs" />

                            {/* 提示信息 */}
                            <motion.div
                              initial={{ opacity: 0, y: -8 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: 0.2, duration: 0.3 }}
                              className={cn(
                                "mt-3 flex items-start gap-2.5 rounded-lg p-3",
                                "bg-gradient-to-br from-blue-50/80 to-blue-50/40",
                                "border-l-[3px] border-blue-500"
                              )}
                            >
                              <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                              <p className="text-[13px] leading-relaxed text-slate-600">
                                <span className="font-medium text-slate-700">
                                  {t("inviteTipTitle")}
                                </span>
                                <br />
                                {t("inviteTipDesc")}
                                <br />
                                <span className="text-slate-500">
                                  {t("inviteTipDescLine2")}
                                </span>
                              </p>
                            </motion.div>
                          </FormItem>
                        )}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Cloudflare Turnstile CAPTCHA */}
                {TURNSTILE_SITE_KEY && (
                  <Turnstile
                    ref={captchaRef}
                    siteKey={TURNSTILE_SITE_KEY}
                    onSuccess={setCaptchaToken}
                    onExpire={() => setCaptchaToken(null)}
                    onError={() => setCaptchaToken(null)}
                    options={{ size: "flexible", theme: "light" }}
                  />
                )}

                {/* 发送验证码按钮 */}
                <GlassButton
                  type="submit"
                  className={cn(
                    "h-12 w-full rounded-xl font-medium",
                    "bg-gradient-to-b from-blue-500 to-blue-600",
                    "shadow-[0_4px_12px_-2px_rgba(37,99,235,0.35)]",
                    "transition-all duration-200 ease-out",
                    "hover:-translate-y-0.5 hover:shadow-[0_8px_20px_-4px_rgba(37,99,235,0.4)]",
                    "active:translate-y-0 active:scale-[0.98]",
                    "disabled:translate-y-0 disabled:opacity-70"
                  )}
                  disabled={isBusy}
                >
                  {isLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowRight className="mr-2 h-4 w-4" />
                  )}
                  {t("sendCode")}
                </GlassButton>
              </form>
            </Form>
          ) : (
            // 第二步：输入验证码
            <div className="space-y-4">
              <div className="space-y-2 text-center">
                <p className="text-sm text-slate-500">{t("codeSentTo")}</p>
                <p className="font-medium text-slate-800">{email}</p>
                <GlassButton
                  type="button"
                  variant="ghost"
                  className="h-auto p-0 text-sm text-blue-500 hover:text-blue-600 bg-transparent"
                  onClick={() => setStep("email")}
                >
                  {t("switchEmail")}
                </GlassButton>
              </div>

              <Form {...codeForm}>
                <form onSubmit={codeForm.handleSubmit(handleVerifyCode)} className="space-y-4">
                  <FormField
                    control={codeForm.control}
                    name="code"
                    render={({ field }) => (
                      <FormItem className="flex flex-col items-center">
                        <FormLabel className="sr-only">{t("codeLabel")}</FormLabel>
                        <FormControl>
                          <InputOTP
                            maxLength={6}
                            disabled={isBusy}
                            {...field}
                          >
                            <InputOTPGroup className="gap-2">
                              {[0, 1, 2, 3, 4, 5].map((index) => (
                                <InputOTPSlot
                                  key={index}
                                  index={index}
                                  className={cn(
                                    "h-12 w-10 rounded-lg border-0 bg-slate-50",
                                    "text-lg font-semibold text-slate-800",
                                    "transition-all duration-200",
                                    "focus:bg-white focus:shadow-[0_0_0_3px_rgba(37,99,235,0.1)]"
                                  )}
                                />
                              ))}
                            </InputOTPGroup>
                          </InputOTP>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <GlassButton
                    type="submit"
                    className={cn(
                      "h-12 w-full rounded-xl font-medium",
                      "bg-gradient-to-b from-blue-500 to-blue-600",
                      "shadow-[0_4px_12px_-2px_rgba(37,99,235,0.35)]",
                      "transition-all duration-200 ease-out",
                      "hover:-translate-y-0.5 hover:shadow-[0_8px_20px_-4px_rgba(37,99,235,0.4)]",
                      "active:translate-y-0 active:scale-[0.98]"
                    )}
                    disabled={isBusy}
                  >
                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {t("login")}
                  </GlassButton>

                  <div className="text-center">
                    {/* Invisible Turnstile for resend (auto-verifies without user interaction) */}
                    {TURNSTILE_SITE_KEY && (
                      <Turnstile
                        ref={captchaRef}
                        siteKey={TURNSTILE_SITE_KEY}
                        onSuccess={setCaptchaToken}
                        onExpire={() => setCaptchaToken(null)}
                        onError={() => setCaptchaToken(null)}
                        options={{ size: "invisible", theme: "light" }}
                      />
                    )}
                    <GlassButton
                      type="button"
                      variant="ghost"
                      className="h-auto p-0 text-sm text-slate-500 hover:text-slate-700 bg-transparent"
                      disabled={countdown > 0 || isBusy}
                      onClick={handleResendCode}
                    >
                      {countdown > 0
                        ? t("resendIn", { seconds: countdown })
                        : t("resend")}
                    </GlassButton>
                  </div>
                </form>
              </Form>
            </div>
          )}

        </>
      )}

      {/* 服务条款 */}
      <p className="text-center text-xs text-slate-400">
        {t("termsPrefix")}{" "}
        <a href="/terms" className="text-blue-500 underline-offset-4 hover:underline">
          {t("terms")}
        </a>{" "}
        {t("and")}{" "}
        <a href="/privacy" className="text-blue-500 underline-offset-4 hover:underline">
          {t("privacy")}
        </a>
      </p>
    </div>
  )
}
