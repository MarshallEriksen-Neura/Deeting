"use client"

import { useMemo, useState } from "react"
import { Loader2 } from "lucide-react"
import { useTranslations } from "next-intl"
import { GlassButton } from "@/components/ui/glass-button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetFooter
} from "@/components/ui/sheet"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { useNotifications } from "@/components/contexts/notification-context"

interface AddServerSheetProps {
  children?: React.ReactNode
  onCreate: (payload: { config: Record<string, unknown> }) => Promise<boolean> | boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

const parseEnvLines = (value: string) => {
  const env: Record<string, string> = {}
  value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .forEach((line) => {
      const [key, ...rest] = line.split("=")
      if (!key) return
      env[key.trim()] = rest.join("=").trim()
    })
  return env
}

const parseArgs = (value: string) =>
  value
    .split(" ")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)

export function AddServerSheet({ children, onCreate, open, onOpenChange }: AddServerSheetProps) {
  const t = useTranslations("mcp")
  const { addNotification } = useNotifications()
  const [internalOpen, setInternalOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<"wizard" | "json">("wizard")
  const [name, setName] = useState("")
  const [command, setCommand] = useState("")
  const [args, setArgs] = useState("")
  const [envText, setEnvText] = useState("")
  const [jsonText, setJsonText] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  const isControlled = typeof open === "boolean"
  const isOpen = isControlled ? open : internalOpen
  const setOpen = onOpenChange ?? setInternalOpen

  const handleOpenChange = (nextOpen: boolean) => {
    if (isSubmitting) return
    setOpen(nextOpen)
  }

  const resetForm = () => {
    setActiveTab("wizard")
    setName("")
    setCommand("")
    setArgs("")
    setEnvText("")
    setJsonText("")
  }

  const wizardPayload = useMemo(() => {
    if (!name || !command) return null
    return {
      mcpServers: {
        [name]: {
          command,
          args: parseArgs(args),
          env: parseEnvLines(envText),
        },
      },
    }
  }, [args, command, envText, name])

  const handleSave = async () => {
    if (isSubmitting) return

    let config: Record<string, unknown> | null = null

    if (activeTab === "wizard") {
      if (!wizardPayload) {
        addNotification({
          type: "warning",
          title: t("toast.missingFields"),
          description: t("addServer.fields.name"),
          timestamp: Date.now(),
        })
        return
      }
      config = wizardPayload
    } else {
      try {
        const parsed = JSON.parse(jsonText || "{}")
        if (!parsed.mcpServers || typeof parsed.mcpServers !== "object") {
          throw new Error("invalid mcpServers")
        }
        config = parsed
      } catch (err) {
        addNotification({
          type: "error",
          title: t("toast.saveFailed"),
          description: String(err),
          timestamp: Date.now(),
        })
        return
      }
    }

    if (!config) {
      return
    }

    setIsSubmitting(true)
    try {
      const created = await onCreate({ config })
      if (!created) {
        return
      }
      setOpen(false)
      resetForm()
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Sheet open={isOpen} onOpenChange={handleOpenChange}>
      {children ? (
        <SheetTrigger asChild>
          {children}
        </SheetTrigger>
      ) : null}
      <SheetContent className="sm:max-w-md">
        <SheetHeader className="px-6 sm:px-8">
          <SheetTitle>{t("addServer.title")}</SheetTitle>
          <SheetDescription>
            {t("addServer.description")}
          </SheetDescription>
        </SheetHeader>
        
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "wizard" | "json")} className="mt-6 px-6 sm:px-8">
            <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="wizard" disabled={isSubmitting}>{t("addServer.tabs.wizard")}</TabsTrigger>
                <TabsTrigger value="json" disabled={isSubmitting}>{t("addServer.tabs.json")}</TabsTrigger>
            </TabsList>
            
            <TabsContent value="wizard" className="space-y-4 py-4">
                <div className="space-y-2">
                    <Label>{t("addServer.fields.name")}</Label>
                    <Input
                      placeholder={t("addServer.placeholders.name")}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      disabled={isSubmitting}
                    />
                </div>
                
                <div className="space-y-2">
                    <Label>{t("addServer.fields.transport")}</Label>
                    <div className="flex gap-2">
                        <GlassButton className="flex-1" disabled={isSubmitting}>{t("addServer.transport.stdio")}</GlassButton>
                        <GlassButton variant="secondary" className="flex-1 text-muted-foreground" disabled>
                          {t("addServer.transport.sse")}
                        </GlassButton>
                    </div>
                </div>

                <div className="space-y-2">
                    <Label>{t("addServer.fields.command")}</Label>
                    <Input
                      placeholder={t("addServer.placeholders.command")}
                      value={command}
                      onChange={(event) => setCommand(event.target.value)}
                      disabled={isSubmitting}
                    />
                </div>

                <div className="space-y-2">
                    <Label>{t("addServer.fields.args")}</Label>
                    <Input
                      placeholder={t("addServer.placeholders.args")}
                      value={args}
                      onChange={(event) => setArgs(event.target.value)}
                      disabled={isSubmitting}
                    />
                </div>

                <div className="space-y-2">
                    <Label>{t("addServer.fields.env")}</Label>
                    <Textarea
                      placeholder={t("addServer.placeholders.env")}
                      className="font-mono text-xs"
                      value={envText}
                      onChange={(event) => setEnvText(event.target.value)}
                      disabled={isSubmitting}
                    />
                </div>
            </TabsContent>

            <TabsContent value="json" className="space-y-4 py-4">
                <div className="space-y-2">
                    <Label>{t("addServer.fields.json")}</Label>
                    <Textarea 
                        className="font-mono text-xs h-[300px]" 
                        placeholder={t.raw("addServer.placeholders.json")}
                        value={jsonText}
                        onChange={(event) => setJsonText(event.target.value)}
                        disabled={isSubmitting}
                    />
                </div>
            </TabsContent>
        </Tabs>

        {isSubmitting ? (
          <div className="mx-6 rounded-2xl border border-sky-200 bg-sky-50/80 px-4 py-3 text-sm text-sky-800 sm:mx-8">
            <div className="flex items-start gap-2">
              <Loader2 className="mt-0.5 size-4 animate-spin shrink-0" />
              <p>{t("addServer.pendingHint")}</p>
            </div>
          </div>
        ) : null}

        <SheetFooter className="px-6 sm:px-8">
            <GlassButton type="submit" className="w-full" onClick={() => void handleSave()} disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t("addServer.saving")}
                </>
              ) : (
                t("addServer.save")
              )}
            </GlassButton>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
