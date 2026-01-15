"use client"

import { Key, Shield } from "lucide-react"
import { useTranslations } from "next-intl"

import { GlassButton } from "@/components/ui/glass-button"
import { 
  GlassCard, 
  GlassCardContent, 
  GlassCardDescription, 
  GlassCardHeader, 
  GlassCardTitle 
} from "@/components/ui/glass-card"

export function UserSecurity() {
  const t = useTranslations("profile")

  return (
    <GlassCard padding="none" hover="none" className="border-none shadow-sm">
      <GlassCardHeader className="p-6 pb-2">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-red-500/10 text-red-500">
            <Shield size={20} />
          </div>
          <div>
            <GlassCardTitle>{t("security.title")}</GlassCardTitle>
            <GlassCardDescription>{t("security.description")}</GlassCardDescription>
          </div>
        </div>
      </GlassCardHeader>
      <GlassCardContent className="p-6 pt-4 space-y-4">
         <div className="flex items-center justify-between p-4 rounded-xl border border-border/50 hover:border-primary/30 transition-colors">
           <div className="flex items-center gap-3">
             <Key size={18} className="text-muted-foreground" />
             <div>
               <p className="text-sm font-medium">{t("security.password")}</p>
               <p className="text-xs text-muted-foreground">
                 {t("security.passwordDesc", { time: "3 months ago" })}
               </p>
             </div>
           </div>
           <GlassButton variant="outline" size="sm">{t("security.update")}</GlassButton>
         </div>
         
         <div className="flex items-center justify-between p-4 rounded-xl border border-border/50 hover:border-primary/30 transition-colors">
           <div className="flex items-center gap-3">
             <Shield size={18} className="text-muted-foreground" />
             <div>
               <p className="text-sm font-medium">{t("security.twoFactor")}</p>
               <p className="text-xs text-muted-foreground text-teal-accent">
                 {t("security.twoFactorEnabled")}
               </p>
             </div>
           </div>
           <GlassButton variant="outline" size="sm">{t("security.manage")}</GlassButton>
         </div>
      </GlassCardContent>
    </GlassCard>
  )
}
