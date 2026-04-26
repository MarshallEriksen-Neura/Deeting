"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/ui/shadcn/card"
import { useI18n } from "@/hooks/use-i18n"
import PageInspectionResultPanel from "@/components/inspection/page-inspection-result-panel"
import type { NativeCanvasView } from "@/store/workspace-store"
import { WorkflowRuntime } from "@/components/workflow/workflow-runtime"
import { TerminalDashboard } from "@/components/dashboard/terminal-dashboard"
import { useWorkflowStore } from "@/store/workflow-store"
import ViewBlock from "@/components/views/view-block"

function WorkflowMonitorPanel() {
  const run = useWorkflowStore((s) => s.run);
  const steps = useWorkflowStore((s) => s.steps);
  const events = useWorkflowStore((s) => s.events);
  return (
    <TerminalDashboard
      workflowRun={run}
      workflowSteps={steps}
      workflowEvents={events}
    />
  );
}

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
        initialPhaseId={view.content.phaseId as string | undefined}
        initialContextPhaseId={view.content.contextPhaseId as string | undefined}
      />
    )
  }

  // Workflow monitoring dashboard (Atelier mode)
  if (view.content?.viewType === "workflow.monitor") {
    return <WorkflowMonitorPanel />
  }

  if (view.content?.viewType === "page-inspection" && view.content?.result) {
    return (
      <div className="h-full w-full p-6">
        <PageInspectionResultPanel result={view.content.result as any} />
      </div>
    )
  }

  if (typeof view.content?.viewType === "string" && view.content?.payload) {
    return (
      <div className="h-full w-full p-6">
        <ViewBlock
          viewType={view.content.viewType as string}
          payload={view.content.payload}
          title={view.content.title as string | undefined}
          metadata={view.content.metadata as Record<string, unknown> | undefined}
        />
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
