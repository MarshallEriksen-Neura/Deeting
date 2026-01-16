"use client"

import { useMemo, useState } from "react"
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
  children: React.ReactNode
  onCreate: (payload: { config: Record<string, unknown> }) => void
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

export function AddServerSheet({ children, onCreate }: AddServerSheetProps) {
  const t = useTranslations("mcp")
  const { addNotification } = useNotifications()
  const [open, setOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<"wizard" | "json">("wizard")
  const [name, setName] = useState("")
  const [command, setCommand] = useState("")
  const [args, setArgs] = useState("")
  const [envText, setEnvText] = useState("")
  const [jsonText, setJsonText] = useState("")

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

  const handleSave = () => {
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
      onCreate({ config: wizardPayload })
      setOpen(false)
      setName("")
      setCommand("")
      setArgs("")
      setEnvText("")
      return
    }

    try {
      const parsed = JSON.parse(jsonText || "{}")
      if (!parsed.mcpServers || typeof parsed.mcpServers !== "object") {
        throw new Error("invalid mcpServers")
      }
      onCreate({ config: parsed })
      setOpen(false)
      setJsonText("")
    } catch (err) {
      addNotification({
        type: "error",
        title: t("toast.saveFailed"),
        description: String(err),
        timestamp: Date.now(),
      })
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {children}
      </SheetTrigger>
      <SheetContent className="sm:max-w-md">
        <SheetHeader className="px-6 sm:px-8">
          <SheetTitle>{t("addServer.title")}</SheetTitle>
          <SheetDescription>
            {t("addServer.description")}
          </SheetDescription>
        </SheetHeader>
        
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "wizard" | "json")} className="mt-6 px-6 sm:px-8">
            <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="wizard">{t("addServer.tabs.wizard")}</TabsTrigger>
                <TabsTrigger value="json">{t("addServer.tabs.json")}</TabsTrigger>
            </TabsList>
            
            <TabsContent value="wizard" className="space-y-4 py-4">
                <div className="space-y-2">
                    <Label>{t("addServer.fields.name")}</Label>
                    <Input placeholder={t("addServer.placeholders.name")} value={name} onChange={(event) => setName(event.target.value)} />
                </div>
                
                <div className="space-y-2">
                    <Label>{t("addServer.fields.transport")}</Label>
                    <div className="flex gap-2">
                        <GlassButton className="flex-1">{t("addServer.transport.stdio")}</GlassButton>
                        <GlassButton variant="secondary" className="flex-1 text-muted-foreground" disabled>
                          {t("addServer.transport.sse")}
                        </GlassButton>
                    </div>
                </div>

                <div className="space-y-2">
                    <Label>{t("addServer.fields.command")}</Label>
                    <Input placeholder={t("addServer.placeholders.command")} value={command} onChange={(event) => setCommand(event.target.value)} />
                </div>

                <div className="space-y-2">
                    <Label>{t("addServer.fields.args")}</Label>
                    <Input placeholder={t("addServer.placeholders.args")} value={args} onChange={(event) => setArgs(event.target.value)} />
                </div>

                <div className="space-y-2">
                    <Label>{t("addServer.fields.env")}</Label>
                    <Textarea placeholder={t("addServer.placeholders.env")} className="font-mono text-xs" value={envText} onChange={(event) => setEnvText(event.target.value)} />
                </div>
            </TabsContent>

            <TabsContent value="json" className="space-y-4 py-4">
                <div className="space-y-2">
                    <Label>{t("addServer.fields.json")}</Label>
                    <Textarea 
                        className="font-mono text-xs h-[300px]" 
                        placeholder={t("addServer.placeholders.json")}
                        value={jsonText}
                        onChange={(event) => setJsonText(event.target.value)}
                    />
                </div>
            </TabsContent>
        </Tabs>

        <SheetFooter className="px-6 sm:px-8">
            <GlassButton type="submit" className="w-full" onClick={handleSave}>
              {t("addServer.save")}
            </GlassButton>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
