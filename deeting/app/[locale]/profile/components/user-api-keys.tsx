"use client"

import { Key, RefreshCw, Copy, ChevronRight } from "lucide-react"
import { useTranslations } from "next-intl"

import { CardFooter } from "@/components/ui/card"
import { GlassButton } from "@/components/ui/glass-button"
import { 
  GlassCard, 
  GlassCardContent, 
  GlassCardDescription, 
  GlassCardHeader, 
  GlassCardTitle 
} from "@/components/ui/glass-card"
import { cn } from "@/lib/utils"

export interface ApiKeyData {
  provider: string
  status: string
  key: string
  logo: string
  color: string
}

interface UserApiKeysProps {
  apiKeys: ApiKeyData[]
}

export function UserApiKeys({ apiKeys }: UserApiKeysProps) {
  const t = useTranslations("profile")

  return (
    <GlassCard padding="none" hover="none" className="border-none shadow-sm overflow-hidden">
      <GlassCardHeader className="p-6 bg-muted/30 border-b border-border/50">
         <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-orange-500/10 text-orange-500">
                <Key size={20} />
              </div>
              <div>
                <GlassCardTitle>{t("apiVault.title")}</GlassCardTitle>
                <GlassCardDescription>{t("apiVault.description")}</GlassCardDescription>
              </div>
            </div>
            <GlassButton variant="outline" size="sm" className="h-9 px-3">
              <RefreshCw size={14} className="mr-2 opacity-70" /> 
              <span>{t("apiVault.syncStatus")}</span>
            </GlassButton>
         </div>
      </GlassCardHeader>
      <GlassCardContent className="p-0">
         <div className="divide-y divide-border/50">
            {apiKeys.map((item) => (
              <div key={item.provider} className="p-4 flex items-center justify-between hover:bg-muted/20 transition-colors group">
                 <div className="flex items-center gap-4">
                    <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center font-bold text-xs shadow-sm border border-white/10", item.color)}>
                      {item.logo}
                    </div>
                    <div>
                       <p className="text-sm font-semibold">{item.provider}</p>
                       <p className="text-xs text-muted-foreground font-mono mt-0.5">{item.key}</p>
                    </div>
                 </div>
                 <div className="flex gap-2">
                    {item.status === "active" ? (
                      <>
                        <GlassButton variant="ghost" size="icon" className="h-9 w-9 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Copy size={14} className="text-muted-foreground" />
                        </GlassButton>
                        <GlassButton variant="secondary" size="sm" className="h-9">{t("apiVault.update")}</GlassButton>
                      </>
                    ) : (
                      <GlassButton variant="outline" size="sm" className="h-9 border-dashed border-primary/30 text-primary hover:bg-primary/5">
                        {t("apiVault.connect")}
                      </GlassButton>
                    )}
                 </div>
              </div>
            ))}
         </div>
      </GlassCardContent>
      <CardFooter className="p-4 bg-muted/10 flex justify-center border-t border-border/50">
         <GlassButton variant="link" size="sm" className="text-muted-foreground hover:text-primary">
           {t("apiVault.manageAll")}
           <ChevronRight size={14} className="ml-1" />
         </GlassButton>
      </CardFooter>
    </GlassCard>
  )
}
