"use client"

import * as React from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Loader2, Mail, ArrowRight, Ticket, Info } from "lucide-react"

import { Button } from "@/components/ui/button"
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
import { cn } from "@/lib/utils"
import { useLoginForm } from "@/hooks/use-login-form"
import { useTranslations } from "next-intl"

export interface LoginFormProps {
  /** 登录成功后的回调 */
  onSuccess?: () => void
  /** 登录失败的回调 */
  onError?: (error: Error) => void
  /** 自定义类名 */
  className?: string
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

  const {
    step,
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
  } = useLoginForm({ onSuccess, onError })

  // 邀请码输入框展开后自动聚焦
  React.useEffect(() => {
    if (showInviteCode && inviteCodeRef.current) {
      const timer = setTimeout(() => {
        inviteCodeRef.current?.focus()
      }, 400)
      return () => clearTimeout(timer)
    }
  }, [showInviteCode])

  // OAuth 登录处理（仍保留占位，未来接入）
  async function handleOAuthLogin(provider: "google" | "github") {
    try {
      console.log("OAuth login with:", provider)
    } catch (error) {
      onError?.(error as Error)
    }
  }

  return (
    <div className={cn("grid gap-6", className)}>
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
                        disabled={isLoading}
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
                              disabled={isLoading}
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

            {/* 发送验证码按钮 */}
            <Button
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
              disabled={isLoading}
            >
              {isLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ArrowRight className="mr-2 h-4 w-4" />
              )}
              {t("sendCode")}
            </Button>
          </form>
        </Form>
      ) : (
        // 第二步：输入验证码
        <div className="space-y-4">
          <div className="space-y-2 text-center">
            <p className="text-sm text-slate-500">{t("codeSentTo")}</p>
            <p className="font-medium text-slate-800">{email}</p>
            <Button
              type="button"
              variant="link"
              className="h-auto p-0 text-sm text-blue-500 hover:text-blue-600"
              onClick={() => setStep("email")}
            >
              {t("switchEmail")}
            </Button>
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
                        disabled={isLoading}
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

              <Button
                type="submit"
                className={cn(
                  "h-12 w-full rounded-xl font-medium",
                  "bg-gradient-to-b from-blue-500 to-blue-600",
                  "shadow-[0_4px_12px_-2px_rgba(37,99,235,0.35)]",
                  "transition-all duration-200 ease-out",
                  "hover:-translate-y-0.5 hover:shadow-[0_8px_20px_-4px_rgba(37,99,235,0.4)]",
                  "active:translate-y-0 active:scale-[0.98]"
                )}
                disabled={isLoading}
              >
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t("login")}
              </Button>

              <div className="text-center">
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0 text-sm text-slate-500 hover:text-slate-700"
                  disabled={countdown > 0 || isLoading}
                  onClick={handleResendCode}
                >
                  {countdown > 0
                    ? t("resendIn", { seconds: countdown })
                    : t("resend")}
                </Button>
              </div>
            </form>
          </Form>
        </div>
      )}

      {/* 分割线 */}
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-slate-200" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-white px-3 text-slate-400">{t("or")}</span>
        </div>
      </div>

      {/* OAuth 登录按钮 */}
      <div className="grid gap-3">
        <Button
          variant="outline"
          type="button"
          className={cn(
            "h-11 rounded-xl border-0 bg-slate-100 font-medium text-slate-700",
            "transition-all duration-200 ease-out",
            "hover:-translate-y-0.5 hover:bg-slate-200"
          )}
          disabled={isLoading}
          onClick={() => handleOAuthLogin("google")}
        >
          <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
          {t("oauthGoogle")}
        </Button>

        <Button
          variant="outline"
          type="button"
          className={cn(
            "h-11 rounded-xl border-0 bg-slate-100 font-medium text-slate-700",
            "transition-all duration-200 ease-out",
            "hover:-translate-y-0.5 hover:bg-slate-200"
          )}
          disabled={isLoading}
          onClick={() => handleOAuthLogin("github")}
        >
          <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
          </svg>
          {t("oauthGithub")}
        </Button>
      </div>

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
