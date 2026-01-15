"use client"

import { Monitor } from "lucide-react"
import { useTranslations } from "next-intl"

import { Badge } from "@/components/ui/badge"
import { GlassButton } from "@/components/ui/glass-button"
import { 
  GlassCard, 
  GlassCardContent, 
  GlassCardDescription, 
  GlassCardHeader, 
  GlassCardTitle 
} from "@/components/ui/glass-card"
import { cn } from "@/lib/utils"

export interface ConnectedDevice {
  agent_id: string
  issued_at: string
  expires_at: string
  status: string
}

interface UserDevicesProps {
  devices: ConnectedDevice[]
}

export function UserDevices({ devices }: UserDevicesProps) {
  const t = useTranslations("profile")

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
         <div className="divide-y divide-border/50">
            {devices.map((item) => (
              <div key={item.agent_id} className="p-4 flex items-center justify-between hover:bg-muted/20 transition-colors group">
                 <div className="flex items-center gap-4">
                    <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center bg-teal-500/10 text-teal-500 font-bold shadow-sm border border-white/10")}>
                      <Monitor size={18} />
                    </div>
                    <div>
                       <p className="text-sm font-semibold flex items-center gap-2">
                          {item.agent_id}
                          {item.status === "active" && <Badge variant="secondary" className="h-5 text-[10px] bg-green-500/10 text-green-500 hover:bg-green-500/20">{t("deviceManagement.active")}</Badge>}
                          {item.status === "expired" && <Badge variant="secondary" className="h-5 text-[10px] bg-gray-500/10 text-gray-500 hover:bg-gray-500/20">{t("deviceManagement.expired")}</Badge>}
                       </p>
                       <p className="text-xs text-muted-foreground font-mono mt-0.5">
                          {t("deviceManagement.lastActive")}: {item.issued_at}
                       </p>
                    </div>
                 </div>
                 <GlassButton variant="outline" size="sm" className="h-8 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/20">
                    {t("deviceManagement.revoke")}
                 </GlassButton>
              </div>
            ))}
         </div>
      </GlassCardContent>
    </GlassCard>
  )
}
