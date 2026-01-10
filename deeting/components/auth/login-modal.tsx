"use client"

import * as React from "react"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { LoginForm, type LoginFormProps } from "./login-form"

export interface LoginModalProps extends Omit<LoginFormProps, "onSuccess"> {
  /** 控制弹窗是否打开 */
  open: boolean
  /** 打开状态变化时的回调 */
  onOpenChange: (open: boolean) => void
  /** 弹窗标题 */
  title?: string
  /** 弹窗描述 */
  description?: string
  /** 登录成功后的回调 */
  onLoginSuccess?: () => void
}

/**
 * 响应式登录弹窗组件
 * Digital Ink 设计风格
 * - 桌面端：使用 Dialog 居中弹窗
 * - 移动端：使用 Drawer 底部抽屉
 */
export function LoginModal({
  open,
  onOpenChange,
  title = "Welcome Back",
  description = "使用邮箱或第三方账号登录",
  onLoginSuccess,
  ...loginFormProps
}: LoginModalProps) {
  const isMobile = useIsMobile()

  const handleLoginSuccess = React.useCallback(() => {
    onOpenChange(false)
    onLoginSuccess?.()
  }, [onOpenChange, onLoginSuccess])

  // 移动端使用 Drawer
  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="bg-white/95 px-4 pb-8 backdrop-blur-xl">
          <DrawerHeader className="text-left">
            <DrawerTitle className="text-2xl font-bold tracking-tight text-slate-800">
              {title}
            </DrawerTitle>
            <DrawerDescription className="text-slate-500">
              {description}
            </DrawerDescription>
          </DrawerHeader>
          <div className="px-4">
            <LoginForm {...loginFormProps} onSuccess={handleLoginSuccess} />
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  // 桌面端使用 Dialog
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="border-white/20 bg-white/95 backdrop-blur-xl sm:max-w-[425px]"
        style={{
          boxShadow: `
            0 4px 6px -1px rgba(0, 0, 0, 0.02),
            0 10px 15px -3px rgba(0, 0, 0, 0.04),
            0 25px 50px -12px rgba(37, 99, 235, 0.06)
          `,
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold tracking-tight text-slate-800">
            {title}
          </DialogTitle>
          <DialogDescription className="text-slate-500">
            {description}
          </DialogDescription>
        </DialogHeader>
        <LoginForm {...loginFormProps} onSuccess={handleLoginSuccess} />
      </DialogContent>
    </Dialog>
  )
}
