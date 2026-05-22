"use client"

import { useEffect, useState } from "react"
import { useI18n } from "@/hooks/use-i18n"
import { Button } from "@/ui/shadcn/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/ui/shadcn/dialog"
import { Input } from "@/ui/shadcn/input"
import { Label } from "@/ui/shadcn/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/shadcn/select"
import {
  type CreateExternalSourcePayload,
  type ExternalSourceConnectorType,
} from "@/lib/api/external-sources"

interface ExternalSourceCreateDialogProps {
  children: React.ReactNode
  onCreate: (payload: CreateExternalSourcePayload) => Promise<void>
}

function defaultBaseUrl(connectorType: ExternalSourceConnectorType): string {
  switch (connectorType) {
    case "evomap_public_feed":
    case "evomap_kg":
      return "https://evomap.ai"
    default:
      return ""
  }
}

export function ExternalSourceCreateDialog({
  children,
  onCreate,
}: ExternalSourceCreateDialogProps) {
  const t = useI18n("settings")
  const [open, setOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [displayName, setDisplayName] = useState("")
  const [connectorType, setConnectorType] =
    useState<ExternalSourceConnectorType>("evomap_public_feed")
  const [baseUrl, setBaseUrl] = useState(defaultBaseUrl("evomap_public_feed"))
  const [apiKey, setApiKey] = useState("")
  const [syncMode, setSyncMode] = useState<"manual" | "scheduled">("manual")
  const [syncIntervalMinutes, setSyncIntervalMinutes] = useState("360")

  useEffect(() => {
    const nextBaseUrl = defaultBaseUrl(connectorType)
    if (nextBaseUrl) {
      setBaseUrl(nextBaseUrl)
    } else {
      setBaseUrl("")
    }
  }, [connectorType])

  async function handleSubmit() {
    setIsSubmitting(true)
    try {
      const payload: CreateExternalSourcePayload = {
        display_name: displayName.trim(),
        connector_type: connectorType,
        sync_mode: syncMode,
        sync_interval_minutes: Number.parseInt(syncIntervalMinutes, 10) || 360,
        is_enabled: false,
      }
      if (baseUrl.trim()) {
        payload.base_url = baseUrl.trim()
      }
      if (apiKey.trim()) {
        payload.api_key = apiKey.trim()
      }
      await onCreate(payload)
      setOpen(false)
      setDisplayName("")
      setApiKey("")
      setSyncMode("manual")
      setSyncIntervalMinutes("360")
    } finally {
      setIsSubmitting(false)
    }
  }

  const needsBaseUrl = connectorType !== "manual_import"
  const needsApiKey = connectorType === "evomap_kg"

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("ecosystem.create.title")}</DialogTitle>
          <DialogDescription>{t("ecosystem.create.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>{t("ecosystem.create.nameLabel")}</Label>
            <Input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder={t("ecosystem.create.namePlaceholder")}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("ecosystem.create.connectorLabel")}</Label>
            <Select
              value={connectorType}
              onValueChange={(value) =>
                setConnectorType(value as ExternalSourceConnectorType)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder={t("ecosystem.create.connectorPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual_import">
                  {t("ecosystem.connector.manual_import")}
                </SelectItem>
                <SelectItem value="evomap_public_feed">
                  {t("ecosystem.connector.evomap_public_feed")}
                </SelectItem>
                <SelectItem value="evomap_kg">
                  {t("ecosystem.connector.evomap_kg")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {needsBaseUrl ? (
            <div className="space-y-2">
              <Label>{t("ecosystem.create.baseUrlLabel")}</Label>
              <Input
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="https://evomap.ai"
              />
            </div>
          ) : null}

          {needsApiKey ? (
            <div className="space-y-2">
              <Label>{t("ecosystem.create.apiKeyLabel")}</Label>
              <Input
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={t("ecosystem.create.apiKeyPlaceholder")}
              />
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>{t("ecosystem.create.syncModeLabel")}</Label>
              <Select
                value={syncMode}
                onValueChange={(value) =>
                  setSyncMode(value as "manual" | "scheduled")
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">
                    {t("ecosystem.syncMode.manual")}
                  </SelectItem>
                  <SelectItem value="scheduled">
                    {t("ecosystem.syncMode.scheduled")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("ecosystem.create.intervalLabel")}</Label>
              <Input
                type="number"
                min={15}
                step={15}
                value={syncIntervalMinutes}
                onChange={(event) => setSyncIntervalMinutes(event.target.value)}
                disabled={syncMode !== "scheduled"}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            {t("ecosystem.create.cancel")}
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || !displayName.trim()}
          >
            {isSubmitting
              ? t("ecosystem.create.creating")
              : t("ecosystem.create.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
