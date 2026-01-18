"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useI18n } from "@/hooks/use-i18n"
import type { NativeCanvasView } from "@/store/workspace-store"

export function NativeCanvasRenderer({
  view,
}: {
  view: NativeCanvasView
}) {
  const t = useI18n("chat")

  return (
    <div className="h-full w-full p-6">
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="text-base">{view.title}</CardTitle>
          <CardDescription>{t("workspace.nativeDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="text-xs text-muted-foreground whitespace-pre-wrap">
            {JSON.stringify(view.content ?? {}, null, 2)}
          </pre>
        </CardContent>
      </Card>
    </div>
  )
}
