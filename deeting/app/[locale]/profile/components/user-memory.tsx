"use client"

import { Cpu, Sparkles } from "lucide-react"
import { useTranslations } from "next-intl"

import { GlassButton } from "@/components/ui/glass-button"
import { 
  GlassCard, 
  GlassCardContent, 
  GlassCardDescription, 
  GlassCardHeader, 
  GlassCardTitle 
} from "@/components/ui/glass-card"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"

interface UserMemoryProps {
  memoriesCount: number
}

export function UserMemory({ memoriesCount }: UserMemoryProps) {
  const t = useTranslations("profile")

  return (
    <GlassCard padding="none" hover="none" className="border-none shadow-sm">
      <GlassCardHeader className="p-6 pb-2">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-purple-500/10 text-purple-500">
            <Cpu size={20} />
          </div>
          <div>
            <GlassCardTitle>{t("memoryCore.title")}</GlassCardTitle>
            <GlassCardDescription>{t("memoryCore.description")}</GlassCardDescription>
          </div>
        </div>
      </GlassCardHeader>
      <GlassCardContent className="p-6 pt-4 space-y-6">
         <div className="flex items-center justify-between group">
            <div className="space-y-1">
               <Label className="text-base font-medium group-hover:text-primary transition-colors cursor-pointer">{t("memoryCore.longTermMemory")}</Label>
               <p className="text-sm text-muted-foreground">{t("memoryCore.longTermMemoryDesc")}</p>
            </div>
            <Switch defaultChecked />
         </div>
         
         <Separator className="opacity-50" />
         
         <div className="flex items-center justify-between group">
            <div className="space-y-1">
               <Label className="text-base font-medium group-hover:text-primary transition-colors cursor-pointer">{t("memoryCore.indexing")}</Label>
               <p className="text-sm text-muted-foreground">{t("memoryCore.indexingDesc")}</p>
            </div>
            <Switch />
         </div>

         <div className="bg-primary/5 border border-primary/10 p-5 rounded-2xl flex items-center justify-between group/mem hover:bg-primary/10 transition-all">
            <div className="flex items-center gap-3">
              <div className="bg-primary/20 p-2 rounded-lg">
                <Sparkles size={18} className="text-primary" />
              </div>
              <div>
                <span className="text-sm font-semibold block text-primary">{t("memoryCore.activeClusters")}</span>
                <span className="text-xs text-muted-foreground">
                  {t("memoryCore.fragmentsStored", { count: memoriesCount })}
                </span>
              </div>
            </div>
            <GlassButton variant="secondary" size="sm" className="bg-background/80 hover:bg-background shadow-sm">
              {t("memoryCore.reviewEdit")}
            </GlassButton>
         </div>
      </GlassCardContent>
    </GlassCard>
  )
}
