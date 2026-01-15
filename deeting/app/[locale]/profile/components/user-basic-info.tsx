"use client"

import { User, Mail } from "lucide-react"
import { useTranslations } from "next-intl"

import { GlassButton } from "@/components/ui/glass-button"
import { 
  GlassCard, 
  GlassCardContent, 
  GlassCardDescription, 
  GlassCardHeader, 
  GlassCardTitle 
} from "@/components/ui/glass-card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

interface UserBasicInfoProps {
  name: string
  email: string
  bio: string
}

export function UserBasicInfo({ name, email, bio }: UserBasicInfoProps) {
  const t = useTranslations("profile")

  return (
    <GlassCard padding="none" hover="none" className="border-none shadow-sm overflow-hidden">
      <GlassCardHeader className="p-6 pb-2">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-500/10 text-blue-500">
            <User size={20} />
          </div>
          <div>
            <GlassCardTitle>{t("basicInfo.title")}</GlassCardTitle>
            <GlassCardDescription>{t("basicInfo.description")}</GlassCardDescription>
          </div>
        </div>
      </GlassCardHeader>
      <GlassCardContent className="p-6 pt-4 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="displayName">{t("basicInfo.displayName")}</Label>
            <Input id="displayName" defaultValue={name} className="bg-background/50 border-border/50 focus:border-primary/50" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">{t("basicInfo.email")}</Label>
            <div className="relative">
              <Input id="email" defaultValue={email} className="bg-background/50 border-border/50 pl-10 focus:border-primary/50" />
              <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            </div>
          </div>
        </div>
        <div className="space-y-2">
           <Label htmlFor="bio">{t("basicInfo.bio")}</Label>
           <Textarea 
             id="bio"
             className="min-h-[100px] bg-background/50 border-border/50 resize-none focus:border-primary/50" 
             defaultValue={bio}
             placeholder={t("basicInfo.bioPlaceholder")} 
           />
           <p className="text-xs text-muted-foreground italic">
             {t("basicInfo.bioHint")}
           </p>
        </div>
        <div className="flex justify-end pt-2">
          <GlassButton>{t("basicInfo.save")}</GlassButton>
        </div>
      </GlassCardContent>
    </GlassCard>
  )
}
