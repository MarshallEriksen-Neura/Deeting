"use client"

import { useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useI18n } from "@/hooks/use-i18n"
import { WORKSPACE_IFRAME_ALLOWLIST } from "./constants"

function isAllowedUrl(url: string) {
  if (WORKSPACE_IFRAME_ALLOWLIST.length === 0) return true
  try {
    const targetHost = new URL(url).host
    return WORKSPACE_IFRAME_ALLOWLIST.some(
      (allowed) => targetHost === allowed || targetHost.endsWith(`.${allowed}`)
    )
  } catch {
    return false
  }
}

export function PluginIframeRenderer({
  url,
  active,
}: {
  url: string
  active: boolean
}) {
  const t = useI18n("chat")
  const allowed = useMemo(() => isAllowedUrl(url), [url])

  if (!allowed) {
    return (
      <div className="h-full w-full p-6">
        <Card className="h-full">
          <CardHeader>
            <CardTitle className="text-base">{t("workspace.blockedTitle")}</CardTitle>
            <CardDescription>{t("workspace.blockedDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground break-all">{url}</div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <iframe
      src={url}
      title="workspace-plugin"
      className="h-full w-full border-0"
      sandbox="allow-scripts allow-same-origin allow-forms"
      referrerPolicy="no-referrer"
      aria-hidden={!active}
      tabIndex={active ? 0 : -1}
    />
  )
}
