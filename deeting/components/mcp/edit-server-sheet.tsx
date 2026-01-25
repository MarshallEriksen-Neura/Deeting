"use client"

import { useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useNotifications } from "@/components/contexts/notification-context"
import { type McpServer, type McpServerUpdateRequest } from "@/lib/api/mcp"

interface EditServerSheetProps {
  server: McpServer | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (serverId: string, payload: McpServerUpdateRequest) => void
  loading?: boolean
}

export function EditServerSheet({ server, open, onOpenChange, onSave, loading }: EditServerSheetProps) {
  const t = useTranslations("mcp")
  const { addNotification } = useNotifications()
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [sseUrl, setSseUrl] = useState("")
  const [authType, setAuthType] = useState<McpServerUpdateRequest["auth_type"]>("bearer")
  const [secretValue, setSecretValue] = useState("")
  const [isEnabled, setIsEnabled] = useState(true)

  const serverType = useMemo(() => server?.server_type ?? "sse", [server])
  const isRemote = serverType === "sse"

  useEffect(() => {
    if (!server) return
    setName(server.name || "")
    setDescription(server.description || "")
    setSseUrl(server.sse_url || "")
    setAuthType(server.auth_type || "bearer")
    setSecretValue("")
    setIsEnabled(Boolean(server.is_enabled))
  }, [server])

  if (!server) return null

  const handleSave = () => {
    const trimmedName = name.trim()
    const trimmedUrl = sseUrl.trim()
    if (!trimmedName) {
      addNotification({
        type: "warning",
        title: t("toast.missingFields"),
        description: t("server.edit.fields.name"),
        timestamp: Date.now(),
      })
      return
    }
    if (isRemote && !trimmedUrl) {
      addNotification({
        type: "warning",
        title: t("toast.missingFields"),
        description: t("server.edit.fields.sseUrl"),
        timestamp: Date.now(),
      })
      return
    }
    const payload: McpServerUpdateRequest = {
      name: trimmedName,
      description: description.trim(),
    }
    if (isRemote) {
      payload.sse_url = trimmedUrl
      payload.auth_type = authType
      payload.is_enabled = isEnabled
      if (secretValue.trim()) {
        payload.secret_value = secretValue.trim()
      }
    }
    onSave(server.id, payload)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg">
        <SheetHeader className="px-6 pt-6">
          <SheetTitle>{t("server.edit.title")}</SheetTitle>
          <SheetDescription>{t("server.edit.description")}</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4 px-6">
          <div className="space-y-2">
            <Label>{t("server.edit.fields.name")}</Label>
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>{t("server.edit.fields.description")}</Label>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="min-h-[100px]"
            />
          </div>

          <div className="space-y-2">
            <Label>{t("server.edit.fields.type")}</Label>
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
              {isRemote ? t("server.edit.types.sse") : t("server.edit.types.stdio")}
            </div>
          </div>

          {isRemote ? (
            <>
              <div className="space-y-2">
                <Label>{t("server.edit.fields.sseUrl")}</Label>
                <Input
                  value={sseUrl}
                  onChange={(event) => setSseUrl(event.target.value)}
                  placeholder={t("server.edit.placeholders.sseUrl")}
                />
              </div>

              <div className="space-y-2">
                <Label>{t("server.edit.fields.authType")}</Label>
                <Select value={authType || "bearer"} onValueChange={(value) => setAuthType(value as McpServerUpdateRequest["auth_type"])}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("server.edit.fields.authType")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bearer">{t("server.edit.authTypes.bearer")}</SelectItem>
                    <SelectItem value="api_key">{t("server.edit.authTypes.apiKey")}</SelectItem>
                    <SelectItem value="none">{t("server.edit.authTypes.none")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>{t("server.edit.fields.secretValue")}</Label>
                <Input
                  type="password"
                  value={secretValue}
                  onChange={(event) => setSecretValue(event.target.value)}
                  placeholder={t("server.edit.placeholders.secretValue")}
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2">
                <div className="space-y-0.5">
                  <Label className="text-sm">{t("server.edit.fields.enabled")}</Label>
                  <p className="text-xs text-gray-500">{t("server.edit.enabledHint")}</p>
                </div>
                <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
              {t("server.edit.stdioNote")}
            </div>
          )}
        </div>

        <SheetFooter className="mt-6 gap-2 px-6 pb-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("server.edit.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? t("server.edit.saving") : t("server.edit.save")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
