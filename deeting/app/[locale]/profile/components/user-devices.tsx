"use client"

import { useState } from "react"
import { Monitor, Smartphone, Tablet } from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { GlassButton } from "@/components/ui/glass-button"
import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardHeader,
  GlassCardTitle
} from "@/components/ui/glass-card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { useLoginSessions } from "@/hooks/use-login-sessions"

function DeviceIcon({ type, size = 18 }: { type: string | null; size?: number }) {
  if (type === "mobile") return <Smartphone size={size} />
  if (type === "tablet") return <Tablet size={size} />
  return <Monitor size={size} />
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export function UserDevices() {
  const t = useTranslations("profile")
  const { sessions, isLoading, revoke } = useLoginSessions()
  const [revokingId, setRevokingId] = useState<string | null>(null)

  const handleRevoke = async (sessionId: string) => {
    setRevokingId(sessionId)
    try {
      await revoke(sessionId)
      toast.success(t("deviceManagement.revoked"))
    } catch {
      toast.error(t("deviceManagement.revokeFailed"))
    } finally {
      setRevokingId(null)
    }
  }

  if (isLoading) {
    return (
      <GlassCard padding="none" hover="none" className="border-none shadow-sm overflow-hidden">
        <GlassCardHeader className="p-6 bg-muted/30 border-b border-border/50">
          <Skeleton className="h-6 w-48" />
        </GlassCardHeader>
        <GlassCardContent className="p-4 space-y-4">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </GlassCardContent>
      </GlassCard>
    )
  }

  return (
    <GlassCard padding="none" hover="none" className="border-none shadow-sm overflow-hidden">
      <GlassCardHeader className="p-6 bg-muted/30 border-b border-border/50">
         <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-teal-500/10 text-teal-500">
                <Monitor size={20} />
              </div>
              <div>
                <GlassCardTitle>{t("deviceManagement.title")}</GlassCardTitle>
                <GlassCardDescription>{t("deviceManagement.description")}</GlassCardDescription>
              </div>
            </div>
         </div>
      </GlassCardHeader>
      <GlassCardContent className="p-0">
        {sessions.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {t("deviceManagement.empty")}
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {sessions.map((item) => (
              <div key={item.id} className="p-4 flex items-center justify-between hover:bg-muted/20 transition-colors group">
                 <div className="flex items-center gap-4">
                    <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center font-bold shadow-sm border border-white/10", item.is_current ? "bg-teal-500/10 text-teal-500" : "bg-muted/50 text-muted-foreground")}>
                      <DeviceIcon type={item.device_type} />
                    </div>
                    <div>
                       <p className="text-sm font-semibold flex items-center gap-2">
                          {item.device_name || t("deviceManagement.unknownDevice")}
                          {item.is_current && (
                            <Badge variant="secondary" className="h-5 text-[10px] bg-green-500/10 text-green-500 hover:bg-green-500/20">
                              {t("deviceManagement.currentDevice")}
                            </Badge>
                          )}
                       </p>
                       <p className="text-xs text-muted-foreground mt-0.5">
                          {item.ip_address && <span className="font-mono">{item.ip_address}</span>}
                          {item.ip_address && " · "}
                          {t("deviceManagement.lastActive")}: {formatTime(item.last_active_at)}
                       </p>
                    </div>
                 </div>
                 {!item.is_current && (
                   <GlassButton
                     variant="outline"
                     size="sm"
                     className="h-8 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/20"
                     disabled={revokingId === item.id}
                     onClick={() => handleRevoke(item.id)}
                   >
                      {revokingId === item.id ? "..." : t("deviceManagement.revoke")}
                   </GlassButton>
                 )}
              </div>
            ))}
          </div>
        )}
      </GlassCardContent>
    </GlassCard>
  )
}
