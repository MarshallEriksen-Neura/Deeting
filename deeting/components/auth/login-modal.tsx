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
 * - 桌面端：使用 Dialog 居中弹窗
 * - 移动端：使用 Drawer 底部抽屉
 */
export function LoginModal({
  open,
  onOpenChange,
  title = "登录",
  description = "使用邮箱验证码或第三方账号登录",
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
        <DrawerContent className="px-4 pb-8">
          <DrawerHeader className="text-left">
            <DrawerTitle className="text-2xl">{title}</DrawerTitle>
            <DrawerDescription>{description}</DrawerDescription>
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
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="text-2xl">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <LoginForm {...loginFormProps} onSuccess={handleLoginSuccess} />
      </DialogContent>
    </Dialog>
  )
}
