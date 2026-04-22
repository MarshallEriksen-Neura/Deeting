"use client"

import { useLocale, useTranslations } from "next-intl"
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
  const t = useTranslations("monitoring")
  const locale = useLocale()

  const renderBody = () => {
    switch (state.state) {
      case "disconnected":
        return (
          <div className="space-y-4">
            <div className="rounded-2xl border bg-muted/20 p-4 text-sm text-muted-foreground">
              {t("notificationChannels.wechat.dialog.disconnectedHint")}
            </div>
            <Button type="button" onClick={onStartConnect}>
              <QrCode className="size-4" />
              {t("notificationChannels.wechat.dialog.startConnect")}
            </Button>
          </div>
        )
      case "qr_ready":
        return (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-3 rounded-2xl border bg-muted/20 p-4">
              <img
                src={state.qrImageData}
                alt={t("notificationChannels.wechat.dialog.qrAlt")}
                className="h-48 w-48 rounded-2xl bg-white p-3"
              />
              <div className="text-sm font-medium">{t("notificationChannels.wechat.dialog.scanHint")}</div>
              {state.expiresAt ? (
                <div className="text-xs text-muted-foreground">
                  {t("notificationChannels.wechat.dialog.expiresAt", {
                    time: new Date(state.expiresAt).toLocaleTimeString(locale),
                  })}
                </div>
              ) : null}
            </div>
            <Button type="button" variant="outline" onClick={onCancelPairing}>
              {t("notificationChannels.wechat.dialog.cancelPairing")}
            </Button>
          </div>
        )
      case "connecting":
        return (
          <div className="flex flex-col items-center gap-3 rounded-2xl border bg-muted/20 p-6 text-center">
            <Loader2 className="size-5 animate-spin text-primary" />
            <div className="text-sm font-medium">{t("notificationChannels.wechat.dialog.waitingConfirm")}</div>
            <div className="text-xs text-muted-foreground">{t("notificationChannels.wechat.dialog.waitingDescription")}</div>
          </div>
        )
      case "connected":
        return (
          <div className="space-y-4">
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
              <div className="text-xs text-emerald-700">{t("notificationChannels.wechat.dialog.connectedAccount")}</div>
              <div className="mt-1 flex items-center gap-2 text-sm font-medium text-foreground">
                <Smartphone className="size-4" />
                {state.accountLabel || t("notificationChannels.wechat.dialog.connectedFallback")}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" onClick={onReconnect}>{t("notificationChannels.wechat.dialog.reconnect")}</Button>
              <Button type="button" variant="outline" onClick={onDisconnect}>{t("notificationChannels.wechat.dialog.disconnect")}</Button>
            </div>
          </div>
        )
      case "error":
        return (
          <div className="space-y-4">
            <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-700">
              {state.error}
            </div>
            <Button type="button" onClick={onStartConnect}>{t("notificationChannels.wechat.dialog.retry")}</Button>
          </div>
        )
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden border-[color:var(--hairline)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--panel-bg)_96%,white_4%)_0%,color-mix(in_srgb,var(--panel-bg)_88%,var(--window-bg)_12%)_100%)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="tracking-[-0.03em] text-[color:var(--ink)]">
            {t("notificationChannels.wechat.dialog.title")}
          </DialogTitle>
          <DialogDescription className="text-[color:var(--ink-3)]">
            {t("notificationChannels.wechat.dialog.description")}
          </DialogDescription>
        </DialogHeader>
        {renderBody()}
      </DialogContent>
    </Dialog>
  )
}
