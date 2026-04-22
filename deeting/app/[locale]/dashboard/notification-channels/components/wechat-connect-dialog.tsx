"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/shadcn/dialog"
import { Button } from "@/components/ui/shadcn/button"
import { Loader2, QrCode, Smartphone } from "lucide-react"

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
            <div className="rounded-2xl border bg-muted/20 p-4 text-sm text-muted-foreground">
              扫码连接后，桌面端微信联系人就可以参与通知与本地 IM 运行时。
            </div>
            <Button type="button" onClick={onStartConnect}>
              <QrCode className="size-4" />
              开始连接
            </Button>
          </div>
        )
      case "qr_ready":
        return (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-3 rounded-2xl border bg-muted/20 p-4">
              <img src={state.qrImageData} alt="微信扫码二维码" className="h-48 w-48 rounded-2xl bg-white p-3" />
              <div className="text-sm font-medium">请使用微信扫码确认连接</div>
              {state.expiresAt ? <div className="text-xs text-muted-foreground">过期时间：{new Date(state.expiresAt).toLocaleTimeString("zh-CN")}</div> : null}
            </div>
            <Button type="button" variant="outline" onClick={onCancelPairing}>
              取消扫码
            </Button>
          </div>
        )
      case "connecting":
        return (
          <div className="flex flex-col items-center gap-3 rounded-2xl border bg-muted/20 p-6 text-center">
            <Loader2 className="size-5 animate-spin text-primary" />
            <div className="text-sm font-medium">等待微信确认</div>
            <div className="text-xs text-muted-foreground">连接成功后，当前账号会显示在这里。</div>
          </div>
        )
      case "connected":
        return (
          <div className="space-y-4">
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
              <div className="text-xs text-emerald-700">当前连接账号</div>
              <div className="mt-1 flex items-center gap-2 text-sm font-medium text-foreground">
                <Smartphone className="size-4" />
                {state.accountLabel || "已连接微信账号"}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" onClick={onReconnect}>重新连接</Button>
              <Button type="button" variant="outline" onClick={onDisconnect}>断开连接</Button>
            </div>
          </div>
        )
      case "error":
        return (
          <div className="space-y-4">
            <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-700">
              {state.error}
            </div>
            <Button type="button" onClick={onStartConnect}>重试连接</Button>
          </div>
        )
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden border-[color:var(--hairline)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--panel-bg)_96%,white_4%)_0%,color-mix(in_srgb,var(--panel-bg)_88%,var(--window-bg)_12%)_100%)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="tracking-[-0.03em] text-[color:var(--ink)]">
            连接微信
          </DialogTitle>
          <DialogDescription className="text-[color:var(--ink-3)]">
            管理桌面端微信接入状态，并通过扫码完成授权。
          </DialogDescription>
        </DialogHeader>
        {renderBody()}
      </DialogContent>
    </Dialog>
  )
}
