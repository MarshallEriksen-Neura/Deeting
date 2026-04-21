"use client"

import { useMemo, useState } from "react"
import { Loader2 } from "lucide-react"
import { useTranslations } from "next-intl"
import { parseMcpRegistryImportConfig } from "@/components/mcp/registry-import"
import { GlassButton } from "@/components/ui/common/glass-button"
import { Input } from "@/components/ui/shadcn/input"
import { Label } from "@/components/ui/shadcn/label"
import { Textarea } from "@/components/ui/shadcn/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/shadcn/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/shadcn/tabs"
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

type ManualTransport = "stdio" | "sse"

export function AddServerSheet({ children, onCreate, open, onOpenChange }: AddServerSheetProps) {
  const t = useTranslations("mcp")
  const { addNotification } = useNotifications()
  const [internalOpen, setInternalOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<"wizard" | "json">("wizard")
  const [transport, setTransport] = useState<ManualTransport>("stdio")
  const [name, setName] = useState("")
  const [serviceDisplayName, setServiceDisplayName] = useState("")
  const [serviceDescription, setServiceDescription] = useState("")
  const [command, setCommand] = useState("")
  const [sseUrl, setSseUrl] = useState("")
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
    setTransport("stdio")
    setName("")
    setServiceDisplayName("")
    setServiceDescription("")
    setCommand("")
    setSseUrl("")
    setArgs("")
    setEnvText("")
    setJsonText("")
  }

  const wizardPayload = useMemo(() => {
    const trimmedName = name.trim()
    const trimmedServiceDisplayName = serviceDisplayName.trim()
    const trimmedServiceDescription = serviceDescription.trim()
    const trimmedCommand = command.trim()
    const trimmedSseUrl = sseUrl.trim()

    if (!trimmedName) return null

    const serviceMetadata: Record<string, unknown> = {
      service_key: trimmedName,
    }
    if (trimmedServiceDisplayName) {
      serviceMetadata.service_display_name = trimmedServiceDisplayName
    }
    if (trimmedServiceDescription) {
      serviceMetadata.service_description = trimmedServiceDescription
    }

    if (transport === "sse") {
      if (!trimmedSseUrl) return null
      return {
        mcpServers: {
          [trimmedName]: {
            type: "sse",
            url: trimmedSseUrl,
            sse_url: trimmedSseUrl,
            ...serviceMetadata,
          },
        },
      }
    }

    if (!trimmedCommand) return null

    return {
      mcpServers: {
        [trimmedName]: {
          command: trimmedCommand,
          args: parseArgs(args),
          env: parseEnvLines(envText),
          ...serviceMetadata,
        },
      },
    }
  }, [args, command, envText, name, serviceDescription, serviceDisplayName, sseUrl, transport])

  const handleSave = async () => {
    if (isSubmitting) return

    let config: Record<string, unknown> | null = null

    if (activeTab === "wizard") {
      if (!wizardPayload) {
        const missingField =
          !name.trim()
            ? t("addServer.fields.name")
            : transport === "sse"
              ? t("addServer.fields.sseUrl")
              : t("addServer.fields.command")
        addNotification({
          type: "warning",
          title: t("toast.missingFields"),
          description: missingField,
          timestamp: Date.now(),
        })
        return
      }
      config = wizardPayload
    } else {
      try {
        const parsed = JSON.parse(jsonText || "{}")
        const validation = parseMcpRegistryImportConfig(parsed)
        if (validation.kind !== "ok") {
          addNotification({
            type: "error",
            title: t("toast.saveFailed"),
            description: t(validation.reasonKey, validation.values),
            timestamp: Date.now(),
          })
          return
        }
        config = parsed
      } catch (err) {
        addNotification({
          type: "error",
          title: t("toast.saveFailed"),
          description:
            err instanceof SyntaxError
              ? `${t("addServer.errors.jsonSyntax")}: ${err.message}`
              : String(err),
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
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      {children ? (
        <DialogTrigger asChild>
          {children}
        </DialogTrigger>
      ) : null}
      <DialogContent className="max-w-2xl p-0">
        <DialogHeader className="px-6 pt-6 sm:px-8">
          <DialogTitle>{t("addServer.title")}</DialogTitle>
          <DialogDescription>
            {t("addServer.description")}
          </DialogDescription>
        </DialogHeader>
        
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
                    <Label>{t("addServer.fields.serviceDisplayName")}</Label>
                    <Input
                      placeholder={t("addServer.placeholders.serviceDisplayName")}
                      value={serviceDisplayName}
                      onChange={(event) => setServiceDisplayName(event.target.value)}
                      disabled={isSubmitting}
                    />
                </div>

                <div className="space-y-2">
                    <Label>{t("addServer.fields.serviceDescription")}</Label>
                    <Textarea
                      placeholder={t("addServer.placeholders.serviceDescription")}
                      value={serviceDescription}
                      onChange={(event) => setServiceDescription(event.target.value)}
                      disabled={isSubmitting}
                    />
                </div>
                
                <div className="space-y-2">
                    <Label>{t("addServer.fields.transport")}</Label>
                    <div className="flex gap-2">
                        <GlassButton
                          type="button"
                          className="flex-1"
                          variant={transport === "stdio" ? "default" : "secondary"}
                          onClick={() => setTransport("stdio")}
                          disabled={isSubmitting}
                        >
                          {t("addServer.transport.stdio")}
                        </GlassButton>
                        <GlassButton
                          type="button"
                          variant={transport === "sse" ? "default" : "secondary"}
                          className="flex-1"
                          onClick={() => setTransport("sse")}
                          disabled={isSubmitting}
                        >
                          {t("addServer.transport.sse")}
                        </GlassButton>
                    </div>
                </div>

                {transport === "sse" ? (
                  <div className="space-y-2">
                    <Label>{t("addServer.fields.sseUrl")}</Label>
                    <Input
                      placeholder={t("addServer.placeholders.sseUrl")}
                      value={sseUrl}
                      onChange={(event) => setSseUrl(event.target.value)}
                      disabled={isSubmitting}
                    />
                  </div>
                ) : (
                  <>
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
                  </>
                )}
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
          <div className="mx-6 rounded-2xl border border-[var(--info-border)] bg-[var(--info-soft)] px-4 py-3 text-sm text-[var(--info)] sm:mx-8">
            <div className="flex items-start gap-2">
              <Loader2 className="mt-0.5 size-4 animate-spin shrink-0" />
              <p>{t("addServer.pendingHint")}</p>
            </div>
          </div>
        ) : null}

        <DialogFooter className="px-6 pb-6 sm:px-8">
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
