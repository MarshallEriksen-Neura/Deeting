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
import { Button } from "@/components/ui/button"
import { MCPTool } from "@/types/mcp"
import { useNotifications } from "@/components/contexts/notification-context"

interface ToolConfigSheetProps {
  tool: MCPTool | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (env: Record<string, string>) => void
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

export function ToolConfigSheet({ tool, open, onOpenChange, onSave }: ToolConfigSheetProps) {
  const t = useTranslations("mcp")
  const { addNotification } = useNotifications()
  const [envValues, setEnvValues] = useState<Record<string, string>>({})
  const [envText, setEnvText] = useState("")

  const envSchema = useMemo(() => tool?.envConfig || [], [tool])

  useEffect(() => {
    if (!tool) return
    const nextValues = { ...(tool.env || {}) }
    envSchema.forEach((item) => {
      if (!nextValues[item.key] && item.default) {
        nextValues[item.key] = item.default
      }
    })
    setEnvValues(nextValues)
    if (envSchema.length === 0) {
      const lines = Object.entries(nextValues)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n")
      setEnvText(lines)
    }
  }, [envSchema, tool])

  if (!tool) return null

  const handleSave = () => {
    if (envSchema.length > 0) {
      const missing = envSchema.filter(
        (item) => item.required && !envValues[item.key]
      )
      if (missing.length > 0) {
        addNotification({
          type: "warning",
          title: t("toast.missingFields"),
          description: missing.map((item) => item.label || item.key).join(", "),
          timestamp: Date.now(),
        })
        return
      }
      onSave(envValues)
      return
    }

    onSave(parseEnvLines(envText))
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{t("config.title")}</SheetTitle>
          <SheetDescription>{t("config.description")}</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {envSchema.length > 0 ? (
            envSchema.map((item) => (
              <div key={item.key} className="space-y-2">
                <Label className="flex items-center justify-between">
                  <span>{item.label || item.key}</span>
                  {item.required && <span className="text-xs text-red-500">*</span>}
                </Label>
                <Input
                  type={item.secret ? "password" : "text"}
                  value={envValues[item.key] || ""}
                  onChange={(event) =>
                    setEnvValues((prev) => ({
                      ...prev,
                      [item.key]: event.target.value,
                    }))
                  }
                />
                {item.description && (
                  <p className="text-xs text-gray-500">{item.description}</p>
                )}
              </div>
            ))
          ) : (
            <div className="space-y-2">
              <Label>{t("addServer.fields.env")}</Label>
              <Textarea
                placeholder={t("config.envPlaceholder")}
                className="font-mono text-xs h-[220px]"
                value={envText}
                onChange={(event) => setEnvText(event.target.value)}
              />
            </div>
          )}
        </div>

        <SheetFooter className="mt-6 gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("config.cancel")}
          </Button>
          <Button onClick={handleSave}>{t("config.save")}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
