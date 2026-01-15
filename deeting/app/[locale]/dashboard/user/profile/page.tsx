"use client"

import { 
  User, 
  Mail, 
  Shield, 
  Key, 
  Cpu, 
  Sparkles, 
  Copy, 
  RefreshCw,
  Calendar,
  MapPin,
  ExternalLink,
  ChevronRight
} from "lucide-react"
import { useTranslations } from "next-intl"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { GlassButton } from "@/components/ui/glass-button"
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle,
  CardFooter
} from "@/components/ui/card"
import { 
  GlassCard, 
  GlassCardHeader, 
  GlassCardTitle, 
  GlassCardDescription, 
  GlassCardContent 
} from "@/components/ui/glass-card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

export default function ProfilePage() {
  const t = useTranslations("profile")
  const commonT = useTranslations("common")

  // Mock user data
  const user = {
    name: "Alex Commander",
    email: "alex@deeting.os",
    uid: "8492-AC-2026",
    role: "PRO PILOT",
    status: "ONLINE",
    registeredAt: "2025-12-19",
    region: "Tokyo, JP",
    avatar: "https://github.com/shadcn.png",
    bio: "AI enthusiast and digital explorer. Using Deeting OS to orchestrate complex workflows.",
    memoriesCount: 142
  }

  const apiKeys = [
    { provider: "OpenAI", status: "active", key: "sk-proj-....................8T5b", logo: "OA", color: "bg-green-100 text-green-600" },
    { provider: "DeepSeek", status: "not_configured", key: "Not Configured", logo: "DS", color: "bg-purple-100 text-purple-600" }
  ]

  return (
    <div className="container mx-auto p-4 md:p-8 space-y-8 animate-in fade-in duration-700">
      <div className="flex flex-col lg:flex-row gap-8 items-start">
        
        {/* LEFT COLUMN: The Holographic ID Card */}
        <aside className="w-full lg:w-1/3 lg:sticky lg:top-8">
          <div className="relative group">
            {/* Ambient Background Glow */}
            <div className="absolute -inset-0.5 bg-gradient-to-r from-primary to-teal-accent rounded-3xl blur opacity-20 group-hover:opacity-40 transition duration-1000"></div>
            
            <GlassCard 
              className="relative overflow-hidden border-white/20 dark:border-white/10"
              padding="none"
              hover="glow"
            >
              {/* Dynamic Background Effect */}
              <div className="absolute top-0 left-0 w-full h-32 bg-gradient-to-b from-primary/10 to-transparent opacity-50" />
              
              <div className="pt-12 pb-8 flex flex-col items-center text-center relative z-10 px-6">
                
                {/* Avatar Container with AI Glow */}
                <div className="relative mb-6">
                  <div className="absolute inset-0 bg-primary/20 rounded-full blur-xl animate-pulse-slow"></div>
                  <Avatar className="w-32 h-32 border-4 border-background shadow-2xl relative z-10">
                    <AvatarImage src={user.avatar} />
                    <AvatarFallback>AC</AvatarFallback>
                  </Avatar>
                  
                  {/* AI Generation Trigger */}
                  <button 
                    className="absolute bottom-0 right-0 bg-primary text-primary-foreground p-2.5 rounded-full hover:scale-110 transition-all shadow-lg z-20 group/ai"
                    title={t("idCard.regenerateAvatar")}
                  >
                    <Sparkles size={16} className="group-hover/ai:rotate-12 transition-transform" />
                  </button>
                </div>

                <div className="space-y-1">
                  <h2 className="text-2xl font-bold tracking-tight text-foreground">{user.name}</h2>
                  <p className="text-muted-foreground font-mono text-xs tracking-widest uppercase">{t("idCard.uid")}: {user.uid}</p>
                </div>
                
                <div className="mt-6 flex gap-2 justify-center">
                   <Badge variant="secondary" className="bg-primary text-primary-foreground hover:bg-primary/90 px-3 py-1">
                      {user.role}
                   </Badge>
                   <Badge variant="outline" className="border-teal-accent text-teal-accent bg-teal-accent/5 px-3 py-1">
                      {user.status}
                   </Badge>
                </div>

                <Separator className="my-8 opacity-20" />

                <div className="w-full space-y-4">
                   <div className="flex justify-between items-center text-sm">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Calendar size={14} />
                        <span>{t("idCard.registered")}</span>
                      </div>
                      <span className="font-mono font-medium">{user.registeredAt}</span>
                   </div>
                   <div className="flex justify-between items-center text-sm">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <MapPin size={14} />
                        <span>{t("idCard.region")}</span>
                      </div>
                      <span className="font-medium">{user.region}</span>
                   </div>
                </div>

                <GlassButton className="w-full mt-8 group" variant="outline">
                  <span>{t("idCard.viewPublic")}</span>
                  <ExternalLink size={14} className="ml-2 opacity-50 group-hover:opacity-100 transition-opacity" />
                </GlassButton>
              </div>
              
              {/* Card Footer Decoration */}
              <div className="h-1.5 w-full bg-gradient-to-r from-primary via-teal-accent to-primary opacity-50" />
            </GlassCard>
          </div>
        </aside>

        {/* RIGHT COLUMN: The Control Modules */}
        <main className="flex-1 space-y-6">
          
          {/* Module 1: Basic Identity */}
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
                  <Input id="displayName" defaultValue={user.name} className="bg-background/50 border-border/50 focus:border-primary/50" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">{t("basicInfo.email")}</Label>
                  <div className="relative">
                    <Input id="email" defaultValue={user.email} className="bg-background/50 border-border/50 pl-10 focus:border-primary/50" />
                    <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                 <Label htmlFor="bio">{t("basicInfo.bio")}</Label>
                 <Textarea 
                   id="bio"
                   className="min-h-[100px] bg-background/50 border-border/50 resize-none focus:border-primary/50" 
                   defaultValue={user.bio}
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

          {/* Module 2: API Vault */}
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

          {/* Module 3: Memory & Personalization */}
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
                        {t("memoryCore.fragmentsStored", { count: user.memoriesCount })}
                      </span>
                    </div>
                  </div>
                  <GlassButton variant="secondary" size="sm" className="bg-background/80 hover:bg-background shadow-sm">
                    {t("memoryCore.reviewEdit")}
                  </GlassButton>
               </div>
            </GlassCardContent>
          </GlassCard>

          {/* Module 4: Security & Access */}
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

        </main>
      </div>
    </div>
  )
}
