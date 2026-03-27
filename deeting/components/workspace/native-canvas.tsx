"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useI18n } from "@/hooks/use-i18n"
import PageInspectionResultPanel from "@/components/inspection/page-inspection-result-panel"
import type { NativeCanvasView } from "@/store/workspace-store"
import { WorkflowRuntime } from "@/components/workflow/workflow-runtime"

export function NativeCanvasRenderer({
  view,
}: {
  view: NativeCanvasView
}) {
  const t = useI18n("chat")

  // Workflow runtime view
  if (view.content?.viewType === "workflow") {
    return (
      <WorkflowRuntime
        initialGoal={view.content.goal as string | undefined}
        initialRunId={view.content.runId as string | undefined}
      />
    )
  }

  if (view.content?.viewType === "page-inspection" && view.content?.result) {
    return (
      <div className="h-full w-full p-6">
        <PageInspectionResultPanel result={view.content.result as any} />
      </div>
    )
  }

  // Default: generic native canvas placeholder
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
