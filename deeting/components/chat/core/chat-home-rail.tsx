"use client"

import { useCallback, useState } from "react"
import {
  Loader2,
  LogOut,
  UserRound,
} from "lucide-react"
import Image from "next/image"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { useI18n } from "@/hooks/use-i18n"
import { useUserStore } from "@/store/user-store"
import { HistorySidebar } from "@/components/chat/sidebar/history-sidebar"
import { isTauriRuntime as detectTauriRuntime } from "@/lib/runtime/tauri"
import {
  DESKTOP_CONFIG_KEYS,
  getDesktopConfig,
  setDesktopConfig,
} from "@/lib/api/desktop-config"
import { Button } from "@/ui/shadcn/button"
import { Textarea } from "@/ui/shadcn/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/shadcn/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/shadcn/dropdown-menu"
import { Avatar, AvatarFallback, AvatarImage } from "@/ui/shadcn/avatar"

export function ChatHomeRail() {
  const t = useI18n("chat")
  const isTauriRuntime = detectTauriRuntime()
  const profile = useUserStore((state) => state.profile)
  const [isPersonaDialogOpen, setIsPersonaDialogOpen] = useState(false)
  const [personaPrompt, setPersonaPrompt] = useState("")
  const [savedPersonaPrompt, setSavedPersonaPrompt] = useState("")
  const [isPersonaLoading, setIsPersonaLoading] = useState(false)
  const [isPersonaSaving, setIsPersonaSaving] = useState(false)
  const profileName = profile?.username || profile?.email || "User"
  const avatarUrl = profile?.avatar_url ?? undefined

  const handleOpenPersonaDialog = useCallback(async () => {
    if (!isTauriRuntime || isPersonaLoading) return

    setIsPersonaDialogOpen(true)
    setIsPersonaLoading(true)

    try {
      const currentValue = (await getDesktopConfig(DESKTOP_CONFIG_KEYS.personaPrompt))?.trim() ?? ""
      setPersonaPrompt(currentValue)
      setSavedPersonaPrompt(currentValue)
    } catch (error) {
      console.warn("load_persona_prompt_failed", error)
      toast.error(t("hud.personaPrompt.toast.loadFailed"))
    } finally {
      setIsPersonaLoading(false)
    }
  }, [isPersonaLoading, isTauriRuntime, t])

  const handlePersonaDialogOpenChange = useCallback((open: boolean) => {
    if (!open && isPersonaSaving) return
    setIsPersonaDialogOpen(open)
  }, [isPersonaSaving])

  const handleSavePersonaPrompt = useCallback(async () => {
    if (!isTauriRuntime) return

    const nextValue = personaPrompt.trim()
    setIsPersonaSaving(true)

    try {
      await setDesktopConfig(DESKTOP_CONFIG_KEYS.personaPrompt, nextValue)
      setPersonaPrompt(nextValue)
      setSavedPersonaPrompt(nextValue)
      setIsPersonaDialogOpen(false)
      toast.success(t("hud.personaPrompt.toast.saveSuccess"))
    } catch (error) {
      console.warn("save_persona_prompt_failed", error)
      toast.error(t("hud.personaPrompt.toast.saveFailed"))
    } finally {
      setIsPersonaSaving(false)
    }
  }, [isTauriRuntime, personaPrompt, t])

  const handleExitToHome = useCallback(() => {
    window.location.assign("/")
  }, [])

  const personaPromptDirty = personaPrompt.trim() !== savedPersonaPrompt

  return (
    <>
      <aside
        aria-label="Chat navigation"
        className={cn(
          "pointer-events-auto absolute bottom-2 left-2 top-2 z-30 hidden w-[328px] select-none flex-col overflow-hidden rounded-[22px]",
          "border border-white/70 bg-white/90 px-0 py-4 shadow-[0_18px_48px_-42px_rgba(69,78,135,0.34)] backdrop-blur-2xl",
          "ring-1 ring-white/60 dark:border-white/10 dark:bg-zinc-950/60 dark:ring-white/10",
          "lg:flex",
        )}
      >
        <div className="flex items-center gap-3 px-4 pb-5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[14px] border border-slate-200/80 bg-white shadow-[0_12px_28px_-24px_rgba(92,72,203,0.58)]">
            <Image
              src="/web-app-manifest-192x192.png"
              alt=""
              width={36}
              height={36}
              className="h-full w-full object-cover"
              priority
            />
          </div>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold tracking-tight text-slate-800 dark:text-white/85">
              Deeting
            </p>
          </div>
        </div>

        <HistorySidebar className="min-h-0 flex-1" />

        <div className="mx-3 mt-2 border-t border-slate-200/70 pt-3 dark:border-white/10">
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex min-h-12 w-full items-center gap-3 rounded-2xl px-2 py-2 text-left transition-colors hover:bg-slate-100/70 active:bg-slate-100 dark:hover:bg-white/10"
                aria-label={profileName}
                title={profileName}
              >
                <Avatar className="size-10 shrink-0 border border-white/70 bg-[linear-gradient(145deg,#62a8f8_0%,#8550db_78%)] text-white ring-1 ring-white/45">
                  <AvatarImage src={avatarUrl} alt={profileName} />
                  <AvatarFallback className="bg-transparent text-sm font-semibold text-white">
                    <UserRound className="h-5 w-5" strokeWidth={2} />
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-700 dark:text-white/75">
                  {profileName}
                </span>
              </button>
            </DropdownMenuTrigger>

            <DropdownMenuContent
              side="right"
              align="end"
              sideOffset={14}
              collisionPadding={10}
              className="w-36 rounded-2xl border-white/70 bg-white/90 p-1.5 shadow-[0_18px_44px_-24px_rgba(15,23,42,0.36)] backdrop-blur-2xl dark:border-white/10 dark:bg-zinc-950/90"
              onCloseAutoFocus={(event) => event.preventDefault()}
            >
              <DropdownMenuItem
                disabled={!isTauriRuntime || isPersonaLoading}
                className="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-slate-700 focus:bg-[#f0edff] focus:text-[#5541c5] dark:text-white/75 dark:focus:bg-white/10 dark:focus:text-white"
                onClick={() => {
                  void handleOpenPersonaDialog()
                }}
              >
                {isPersonaLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <UserRound className="h-4 w-4" strokeWidth={2.1} />
                )}
                {t("hud.personaPrompt.button")}
              </DropdownMenuItem>

              <DropdownMenuItem
                className="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-slate-700 focus:bg-red-50 focus:text-red-600 dark:text-white/75 dark:focus:bg-red-500/10 dark:focus:text-red-300"
                onClick={handleExitToHome}
              >
                <LogOut className="h-4 w-4" strokeWidth={2.1} />
                {t("hud.menu.exit")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      <Dialog open={isPersonaDialogOpen} onOpenChange={handlePersonaDialogOpenChange}>
        <DialogContent className="border-white/20 bg-white/80 backdrop-blur-2xl dark:border-white/10 dark:bg-gray-900/90 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("hud.personaPrompt.title")}</DialogTitle>
            <DialogDescription>{t("hud.personaPrompt.description")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <Textarea
              value={personaPrompt}
              onChange={(event) => setPersonaPrompt(event.target.value)}
              disabled={isPersonaLoading || isPersonaSaving}
              placeholder={t("hud.personaPrompt.placeholder")}
              className="min-h-40 rounded-2xl border-border/60 bg-background/80"
            />
            <p className="text-xs text-muted-foreground">{t("hud.personaPrompt.help")}</p>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setIsPersonaDialogOpen(false)}
              disabled={isPersonaSaving}
            >
              {t("hud.personaPrompt.cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => {
                void handleSavePersonaPrompt()
              }}
              disabled={isPersonaLoading || isPersonaSaving || !personaPromptDirty}
            >
              {isPersonaSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("hud.personaPrompt.saving")}
                </>
              ) : (
                t("hud.personaPrompt.save")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
