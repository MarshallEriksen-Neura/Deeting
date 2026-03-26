"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Loader2, QrCode, Smartphone } from "lucide-react"
import { cn } from "@/lib/utils"

export type WechatConnectionViewState =
  | { state: "disconnected" }
  | { state: "qr_ready"; qrImageData: string; expiresAt?: string }
  | { state: "connecting" }
  | { state: "connected"; accountLabel?: string }
  | { state: "error"; error: string }

export function WechatConnectDialog({
  open,
  onOpenChange,
  state,
  onStartConnect,
  onReconnect,
  onDisconnect,
  onCancelPairing,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  state: WechatConnectionViewState
  onStartConnect: () => void
  onReconnect: () => void
  onDisconnect: () => void
  onCancelPairing: () => void
}) {
  const renderBody = () => {
    switch (state.state) {
      case "disconnected":
        return (
          <div className="space-y-4">
            <div className="rounded-2xl border border-white/10 bg-[var(--foreground)]/[0.03] p-4 text-sm text-[var(--muted)]">
              扫码后将当前桌面实例与微信账号绑定。
            </div>
            <button
              type="button"
              onClick={onStartConnect}
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white"
            >
              <QrCode className="h-4 w-4" />
              连接微信
            </button>
          </div>
        )
      case "qr_ready":
        return (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-[var(--foreground)]/[0.03] p-4">
              <img
                src={state.qrImageData}
                alt="微信登录二维码"
                className="h-48 w-48 rounded-2xl bg-white p-3"
              />
              <div className="text-sm font-medium text-[var(--foreground)]">
                请使用微信扫码登录
              </div>
              {state.expiresAt ? (
                <div className="text-xs text-[var(--muted)]">
                  二维码有效期至 {new Date(state.expiresAt).toLocaleTimeString("zh-CN")}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onCancelPairing}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2 text-sm text-[var(--foreground)]"
            >
              取消扫码
            </button>
          </div>
        )
      case "connecting":
        return (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-[var(--foreground)]/[0.03] p-6 text-center">
            <Loader2 className="h-5 w-5 animate-spin text-[var(--primary)]" />
            <div className="text-sm font-medium text-[var(--foreground)]">
              正在等待扫码确认
            </div>
            <div className="text-xs text-[var(--muted)]">
              微信端确认后，桌面会自动完成绑定。
            </div>
          </div>
        )
      case "connected":
        return (
          <div className="space-y-4">
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
              <div className="text-xs text-emerald-300">当前已连接账号</div>
              <div className="mt-1 flex items-center gap-2 text-sm font-medium text-white">
                <Smartphone className="h-4 w-4" />
                {state.accountLabel || "已连接微信账号"}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onReconnect}
                className="inline-flex items-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white"
              >
                重新连接
              </button>
              <button
                type="button"
                onClick={onDisconnect}
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2 text-sm text-[var(--foreground)]"
              >
                断开连接
              </button>
            </div>
          </div>
        )
      case "error":
        return (
          <div className="space-y-4">
            <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
              {state.error}
            </div>
            <button
              type="button"
              onClick={onStartConnect}
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white"
            >
              再试一次
            </button>
          </div>
        )
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("sm:max-w-md border-white/10 bg-[var(--surface)]/95")}>
        <DialogHeader>
          <DialogTitle>微信连接</DialogTitle>
          <DialogDescription>
            在桌面端完成扫码绑定后，微信消息会直接进入本地 AI 运行时。
          </DialogDescription>
        </DialogHeader>
        {renderBody()}
      </DialogContent>
    </Dialog>
  )
}
