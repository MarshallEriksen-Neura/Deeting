"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { GlassButton } from "@/components/ui/glass-button"
import { Loader2, QrCode, Smartphone } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"

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
  const t = useTranslations("dashboard.notificationChannelsPage.wechatDialog")

  const renderBody = () => {
    switch (state.state) {
      case "disconnected":
        return (
          <div className="space-y-4">
            <div className="rounded-2xl border border-white/10 bg-[var(--foreground)]/[0.03] p-4 text-sm text-[var(--muted)]">
              {t("disconnected.description")}
            </div>
            <GlassButton
              type="button"
              onClick={onStartConnect}
              size="sm"
            >
              <QrCode className="h-4 w-4" />
              {t("actions.connect")}
            </GlassButton>
          </div>
        )
      case "qr_ready":
        return (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-[var(--foreground)]/[0.03] p-4">
              <img
                src={state.qrImageData}
                alt={t("qrReady.qrAlt")}
                className="h-48 w-48 rounded-2xl bg-white p-3"
              />
              <div className="text-sm font-medium text-[var(--foreground)]">
                {t("qrReady.title")}
              </div>
              {state.expiresAt ? (
                <div className="text-xs text-[var(--muted)]">
                  {t("qrReady.expiresAt", {
                    time: new Date(state.expiresAt).toLocaleTimeString(),
                  })}
                </div>
              ) : null}
            </div>
            <GlassButton
              type="button"
              variant="secondary"
              size="sm"
              onClick={onCancelPairing}
            >
              {t("actions.cancelScan")}
            </GlassButton>
          </div>
        )
      case "connecting":
        return (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-[var(--foreground)]/[0.03] p-6 text-center">
            <Loader2 className="h-5 w-5 animate-spin text-[var(--primary)]" />
            <div className="text-sm font-medium text-[var(--foreground)]">
              {t("connecting.title")}
            </div>
            <div className="text-xs text-[var(--muted)]">
              {t("connecting.description")}
            </div>
          </div>
        )
      case "connected":
        return (
          <div className="space-y-4">
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
              <div className="text-xs text-emerald-300">{t("connected.currentAccount")}</div>
              <div className="mt-1 flex items-center gap-2 text-sm font-medium text-white">
                <Smartphone className="h-4 w-4" />
                {state.accountLabel || t("connected.defaultAccount")}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <GlassButton
                type="button"
                size="sm"
                onClick={onReconnect}
              >
                {t("actions.reconnect")}
              </GlassButton>
              <GlassButton
                type="button"
                variant="secondary"
                size="sm"
                onClick={onDisconnect}
              >
                {t("actions.disconnect")}
              </GlassButton>
            </div>
          </div>
        )
      case "error":
        return (
          <div className="space-y-4">
            <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
              {state.error}
            </div>
            <GlassButton
              type="button"
              size="sm"
              onClick={onStartConnect}
            >
              {t("actions.tryAgain")}
            </GlassButton>
          </div>
        )
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("sm:max-w-md border-white/10 bg-[var(--surface)]/95")}>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t("description")}
          </DialogDescription>
        </DialogHeader>
        {renderBody()}
      </DialogContent>
    </Dialog>
  )
}
