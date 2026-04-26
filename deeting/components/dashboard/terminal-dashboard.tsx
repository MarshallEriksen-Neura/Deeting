"use client"
import React, { useState, useEffect, useRef } from "react"
import { useUserSecretary, useUserEmbeddingConfig } from "@/lib/swr/use-embedding-settings"
import { usePlatformModels } from "@/lib/swr/use-platform-models"
import { useChatModels } from "@/hooks/use-chat-models"
import { isTauriRuntime } from "@/lib/runtime/tauri"
import { buildWorkflowResultPayload, isWorkflowTerminal } from "@/lib/workflow/presentation"
import ViewBlock from "@/components/views/view-block"
import type { WorkflowEvent, WorkflowRun, WorkflowStepRun } from "@/lib/workflow/types"

interface TerminalDashboardProps {
  workflowRun?: WorkflowRun | null
  workflowSteps?: WorkflowStepRun[]
  workflowEvents?: WorkflowEvent[]
}

export function TerminalDashboard({
  workflowRun = null,
  workflowSteps = [],
  workflowEvents = [],
}: TerminalDashboardProps) {
  const { data: secretaryData } = useUserSecretary()
  const { data: embeddingData } = useUserEmbeddingConfig()
  const { models: platformModels } = usePlatformModels()
  const { models: chatModels } = useChatModels({ enabled: isTauriRuntime() })

  const secModelId = secretaryData?.provider_model_id || secretaryData?.model_name
  // Try local chat models first (desktop), then platform models
  const localSecModel = isTauriRuntime()
    ? chatModels.find((m) => m.provider_model_id === secModelId || m.id === secModelId)
    : undefined
  const platformSecModel = platformModels.find((m) => m.model_id === secModelId || m.id === secModelId)
  const secretaryModelName =
    localSecModel?.display_name || localSecModel?.id || platformSecModel?.display_name || secModelId || "Claude-3.5-Sonnet (Default)"

  const embModelId = embeddingData?.provider_model_id
  const localEmbModel = isTauriRuntime()
    ? chatModels.find((m) => m.provider_model_id === embModelId || m.id === embModelId)
    : undefined
  const platformEmbModel = platformModels.find((m) => m.model_id === embModelId || m.id === embModelId)
  const embeddingModelName =
    localEmbModel?.display_name || localEmbModel?.id || platformEmbModel?.display_name || embModelId || "text-embedding-3-large (Default)"

  const [uptime, setUptime] = useState("00:00:00")
  const [nodes, setNodes] = useState<React.ReactNode[]>([])
  const containerRef = useRef<HTMLDivElement>(null)
  const isLiveWorkflow = Boolean(workflowRun)

  useEffect(() => {
    const start = Date.now()
    const timer = setInterval(() => {
      const diff = Math.floor((Date.now() - start) / 1000)
      const h = String(Math.floor(diff / 3600)).padStart(2, "0")
      const m = String(Math.floor((diff % 3600) / 60)).padStart(2, "0")
      const s = String(diff % 60).padStart(2, "0")
      setUptime(`${h}:${m}:${s}`)
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  const addNode = (node: React.ReactNode) => {
    setNodes((prev) => [...prev, node])
    setTimeout(() => {
      if (containerRef.current) {
        containerRef.current.scrollTop = containerRef.current.scrollHeight
      }
    }, 50)
  }

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  useEffect(() => {
    if (isLiveWorkflow) return
    let isCancelled = false

    const runScenario = async () => {
      setNodes([])

      // Initializing
      addNode(
        <div key={Date.now()} className="flex items-center gap-2 text-[var(--atl-ink-soft)] mb-6 text-xs font-mono">
          <div className="w-1.5 h-1.5 rounded-full bg-[var(--atl-success)] shadow-[0_0_8px_var(--atl-success)] animate-pulse"></div>
          [SYSTEM] Kernel active. Awaiting instructions...
        </div>
      )
      await sleep(1000)
      if (isCancelled) return

      // Slide 1: User input
      addNode(
        <div key={Date.now()} className="mb-6 flex gap-3">
          <div className="shrink-0 mt-0.5 text-[var(--atl-accent)]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
          </div>
          <div className="text-[var(--atl-ink)] text-[13px] leading-relaxed">
            Please analyze the recent marketing data, generate a summary report, and draft an email to the team.
          </div>
        </div>
      )
      await sleep(800)
      if (isCancelled) return

      // Slide 2: AI Planning
      addNode(
        <div key={Date.now()} className="flex items-center gap-2 text-[var(--atl-ink-soft)] text-xs font-mono mb-4 uppercase tracking-wider">
          <span className="w-4 border-t border-[var(--atl-rule)]"></span>
          Intent Parsing
          <span className="flex-1 border-t border-[var(--atl-rule)]"></span>
        </div>
      )
      await sleep(400)
      if (isCancelled) return
      
      addNode(
        <div key={Date.now()} className="text-[var(--atl-ink-soft)] font-mono text-xs pl-6 border-l border-[var(--atl-rule)] ml-1.5 mb-2">
          &gt; Analyzing intent signatures...<br/>
          <span className="text-[var(--atl-success)] mt-1 inline-block">&gt; Match: [Data Analysis, Summarization, Email Drafting]</span>
        </div>
      )
      await sleep(600)
      if (isCancelled) return

      addNode(
        <div key={Date.now()} className="pl-6 ml-1.5 mb-8 border-l border-[var(--atl-rule)]">
          <div className="p-4 border border-[var(--atl-rule)] bg-[var(--atl-canvas-soft)] rounded-lg grid grid-cols-2 gap-6 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-[var(--atl-accent)]"></div>
            <div>
              <div className="text-[var(--atl-ink-soft)] text-[10px] uppercase tracking-wider mb-1">Vector Operation</div>
              <div className="text-[var(--atl-ink)] text-xs font-medium">Query Knowledge Base</div>
              <div className="text-[var(--atl-ink-soft)] text-[10px] mt-2 font-mono truncate">{embeddingModelName}</div>
            </div>
            <div>
              <div className="text-[var(--atl-ink-soft)] text-[10px] uppercase tracking-wider mb-1">Generative Operation</div>
              <div className="text-[var(--atl-ink)] text-xs font-medium">Draft Report & Email</div>
              <div className="text-[var(--atl-ink-soft)] text-[10px] mt-2 font-mono truncate">{secretaryModelName}</div>
            </div>
          </div>
        </div>
      )
      await sleep(1200)
      if (isCancelled) return

      // Slide 3: Execution
      addNode(
        <div key={Date.now()} className="flex items-center gap-2 text-[var(--atl-ink-soft)] text-xs font-mono mb-4 uppercase tracking-wider">
          <span className="w-4 border-t border-[var(--atl-rule)]"></span>
          Execution Log
          <span className="flex-1 border-t border-[var(--atl-rule)]"></span>
        </div>
      )
      await sleep(400)
      if (isCancelled) return

      const steps = [
        'Querying vector space for "marketing data Q3"',
        'Synthesizing key metrics and trends',
        'Drafting team communication',
      ]

      for (const step of steps) {
        if (isCancelled) return
        addNode(
          <div key={Date.now() + step} className="pl-6 ml-1.5 mb-4 border-l border-[var(--atl-rule)] relative">
            <div className="absolute -left-[5px] top-1.5 w-2 h-2 rounded-full bg-[var(--atl-canvas)] border-2 border-[var(--atl-rule)]"></div>
            <div className="flex justify-between items-end mb-1.5">
              <div className="text-[var(--atl-ink)] text-xs font-mono">{step}</div>
              <div className="text-[var(--atl-ink-soft)] text-[10px] font-mono">Running</div>
            </div>
            <div className="h-[3px] w-full bg-[var(--atl-rule)] rounded-full overflow-hidden">
              <div 
                className="h-full bg-[var(--atl-accent)] animate-[progress_1s_ease-in-out_forwards]"
                style={{ width: '0%' }}
              />
            </div>
          </div>
        )
        await sleep(1000)
      }

      await sleep(500)
      if (isCancelled) return

      // Slide 4: Completion
      addNode(
        <div key={Date.now()} className="flex items-center gap-2 text-[var(--atl-ink-soft)] text-xs font-mono mb-4 uppercase tracking-wider mt-8">
          <span className="w-4 border-t border-[var(--atl-rule)]"></span>
          Output Artifacts
          <span className="flex-1 border-t border-[var(--atl-rule)]"></span>
        </div>
      )
      await sleep(600)
      if (isCancelled) return

      addNode(
        <div key={Date.now()} className="pl-6 ml-1.5 mb-8">
          <div className="bg-[var(--atl-canvas)] border border-[var(--atl-rule)] rounded-lg shadow-[var(--atl-shell-shadow)] overflow-hidden transition-all duration-500 animate-in fade-in slide-in-from-bottom-4">
            <div className="bg-[var(--atl-canvas-soft)] px-4 py-2 border-b border-[var(--atl-rule)] flex items-center gap-2">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--atl-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
              <span className="text-xs font-medium text-[var(--atl-ink)]">Draft: Q3 Marketing Update</span>
            </div>
            <div className="p-4 text-[var(--atl-ink)] text-[13px] leading-relaxed font-sans">
              Hi Team,<br/><br/>Based on the Q3 data, our engagement grew by 15% and we are seeing a strong upward trend in our core demographics. The full report is attached for review.
            </div>
          </div>
        </div>
      )

      await sleep(4000)
      if (isCancelled) return
      
      addNode(
        <div key={Date.now()} className="text-[var(--atl-ink-soft)] mt-8 text-xs font-mono flex items-center gap-2 justify-center">
          <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
          Restarting observation loop...
        </div>
      )
      await sleep(3000)
      if (!isCancelled) {
        runScenario()
      }
    }

    runScenario()

    return () => {
      isCancelled = true
    }
  }, [secretaryModelName, embeddingModelName, isLiveWorkflow])

  useEffect(() => {
    if (!isLiveWorkflow && nodes.length > 0) return
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [isLiveWorkflow, nodes.length, workflowSteps.length, workflowEvents.length])

  const succeededCount = workflowSteps.filter((step) => step.status === "succeeded").length
  const totalPhases = workflowRun?.snapshot_json?.phases?.length ?? workflowSteps.length
  const memoryNodeLabel = workflowRun
    ? `${workflowRun.status}${totalPhases > 0 ? ` (${succeededCount}/${totalPhases})` : ""}`
    : "Active (2.4GB)"

  return (
    <div className="ws-bezel h-[calc(100vh-80px)] min-h-[500px] flex flex-col overflow-hidden relative" style={{ background: 'var(--atl-shell-bg)' }}>
      
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes progress {
          0% { width: 0%; }
          100% { width: 100%; }
        }
      `}} />

      {/* Atelier Header */}
      <div className="border-b border-[var(--atl-shell-border)] px-5 py-3 flex justify-between items-center shrink-0">
        <div className="flex gap-4 items-center">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-[var(--atl-success)]"></div>
            <div className="text-[var(--atl-ink)] text-[11px] uppercase tracking-widest font-semibold font-mono">Deeting Engine</div>
          </div>
          <div className="h-3 w-px bg-[var(--atl-rule)]"></div>
          <div className="text-[var(--atl-ink-soft)] text-xs font-mono tabular-nums">{uptime}</div>
        </div>
      </div>

      {/* Status Strip */}
      <div className="flex flex-wrap gap-x-8 gap-y-4 px-5 py-3 border-b border-[var(--atl-rule)] shrink-0 bg-[var(--atl-canvas-soft)]">
        <div>
          <div className="text-[10px] uppercase text-[var(--atl-ink-soft)] tracking-wider mb-1 font-mono">Secretary Model</div>
          <div className="text-[var(--atl-ink)] text-xs font-medium truncate max-w-[200px]" title={secretaryModelName}>{secretaryModelName}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-[var(--atl-ink-soft)] tracking-wider mb-1 font-mono">Embedding Engine</div>
          <div className="text-[var(--atl-ink)] text-xs font-medium truncate max-w-[200px]" title={embeddingModelName}>{embeddingModelName}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-[var(--atl-ink-soft)] tracking-wider mb-1 font-mono">Memory Node</div>
          <div className="text-[var(--atl-success)] text-xs font-medium">{memoryNodeLabel}</div>
        </div>
      </div>

      {/* Atelier Canvas Body */}
      <div 
        ref={containerRef}
        className="flex-1 p-6 overflow-y-auto scroll-smooth bg-[var(--atl-canvas)] relative"
      >
        {/* Subtle grid background */}
        <div className="absolute inset-0 pointer-events-none" style={{
          backgroundImage: 'linear-gradient(var(--atl-grid) 1px, transparent 1px), linear-gradient(90deg, var(--atl-grid) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
          opacity: 0.5
        }}></div>

        <div className="relative z-10 max-w-3xl mx-auto">
          {isLiveWorkflow && workflowRun ? (
            <WorkflowLiveNodes run={workflowRun} steps={workflowSteps} events={workflowEvents} />
          ) : (
            nodes
          )}
        </div>
      </div>
    </div>
  )
}

function WorkflowLiveNodes({
  run,
  steps,
  events,
}: {
  run: WorkflowRun
  steps: WorkflowStepRun[]
  events: WorkflowEvent[]
}) {
  const sortedSteps = [...steps].sort((a, b) => a.phase_index - b.phase_index)
  const recentEvents = [...events].slice(-6)
  const failedStep = [...sortedSteps].reverse().find((step) => step.status === "failed" || step.error)
  const resultStep = [...sortedSteps].reverse().find((step) => step.status === "succeeded")
  const focusStep =
    run.status === "failed" || run.status === "cancelled"
      ? failedStep
      : run.status === "completed" || run.status === "awaiting_plan_edit"
        ? resultStep
        : sortedSteps.find((step) => step.status === "running") ?? resultStep

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-[var(--atl-ink-soft)] mb-6 text-xs font-mono">
        <div className="w-1.5 h-1.5 rounded-full bg-[var(--atl-success)] shadow-[0_0_8px_var(--atl-success)] animate-pulse" />
        [WORKFLOW] {run.title || run.goal}
      </div>

      <div className="mb-6 flex gap-3">
        <div className="shrink-0 mt-0.5 text-[var(--atl-accent)]">&gt;</div>
        <div className="text-[var(--atl-ink)] text-[13px] leading-relaxed">{run.goal}</div>
      </div>

      {isWorkflowTerminal(run.status) ? (
        <>
          <SectionLabel>Result Landing</SectionLabel>
          <div className="mb-8">
            <ViewBlock
              viewType="workflow.result"
              title="Workflow Result"
              payload={buildWorkflowResultPayload(run, sortedSteps)}
              metadata={{ workflow_run_id: run.id }}
            />
          </div>
        </>
      ) : null}

      <SectionLabel>Execution Log</SectionLabel>

      {focusStep && !isWorkflowTerminal(run.status) && (
        <LiveResultFocus
          step={focusStep}
          isFailure={focusStep.status === "failed"}
          isTerminal={false}
        />
      )}

      {sortedSteps.length === 0 ? (
        <div className="text-[var(--atl-ink-soft)] font-mono text-xs pl-6 border-l border-[var(--atl-rule)] ml-1.5">
          Waiting for streamed workflow events...
        </div>
      ) : (
        sortedSteps.map((step) => <LiveStep key={step.id} step={step} />)
      )}

      {sortedSteps.some((step) => step.worker_trace_summary || step.output_artifact_refs.length > 0) ? (
        <>
          <SectionLabel>Output Artifacts</SectionLabel>
          {sortedSteps
            .filter((step) => step.worker_trace_summary || step.output_artifact_refs.length > 0)
            .map((step) => (
              <div key={`${step.id}-result`} className="pl-6 ml-1.5 mb-4">
                <div className="bg-[var(--atl-canvas)] border border-[var(--atl-rule)] rounded-lg shadow-[var(--atl-shell-shadow)] overflow-hidden">
                  <div className="bg-[var(--atl-canvas-soft)] px-4 py-2 border-b border-[var(--atl-rule)] flex items-center gap-2">
                    <span className="text-xs font-medium text-[var(--atl-ink)]">{step.title || step.phase_id}</span>
                    <span className="text-[10px] font-mono text-[var(--atl-ink-soft)]">{step.status}</span>
                  </div>
                  <div className="p-4 text-[var(--atl-ink)] text-[13px] leading-relaxed">
                    {step.worker_trace_summary ? <p>{step.worker_trace_summary}</p> : null}
                    {step.output_artifact_refs.length > 0 ? (
                      <div className="mt-3 space-y-1 font-mono text-[10px] text-[var(--atl-ink-soft)]">
                        {step.output_artifact_refs.map((ref) => <div key={ref}>{formatWorkflowArtifactLabel(ref)}</div>)}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
        </>
      ) : null}

      {recentEvents.length > 0 ? <WorkflowActivityFeed events={recentEvents} /> : null}
    </div>
  )
}

function WorkflowActivityFeed({ events }: { events: WorkflowEvent[] }) {
  return (
    <div className="pt-2">
      <SectionLabel>Live Activity</SectionLabel>
      <div className="space-y-2 font-mono text-[10px] text-[var(--atl-ink-soft)]">
        {events.map((event) => {
          const detail = describeWorkflowEvent(event)
          return (
            <div key={event.id} className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--atl-accent)]" />
              <div className="min-w-0">
                <div className="text-[var(--atl-ink)]">{detail.title}</div>
                {detail.description ? <div className="truncate">{detail.description}</div> : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function describeWorkflowEvent(event: WorkflowEvent): { title: string; description: string | null } {
  const payload = event.payload ?? {}
  const phaseId = typeof payload.phase_id === "string" ? payload.phase_id : null
  const artifactRef = typeof payload.artifact_ref === "string" ? payload.artifact_ref : null
  const workerRef = typeof payload.worker_ref === "string" ? payload.worker_ref : null

  switch (event.event_type) {
    case "step.started":
      return { title: "Phase started", description: phaseId }
    case "step.worker.bound":
      return { title: "Worker selected", description: workerRef }
    case "step.artifact.produced":
      return { title: "Artifact produced", description: artifactRef ? formatWorkflowArtifactLabel(artifactRef) : null }
    case "step.succeeded":
      return { title: "Phase completed", description: phaseId }
    case "step.failed":
      return { title: "Phase failed", description: phaseId }
    case "run.started":
      return { title: "Workflow started", description: null }
    case "run.completed":
      return { title: "Workflow completed", description: null }
    case "run.failed":
      return { title: "Workflow failed", description: null }
    default:
      return { title: event.event_type, description: phaseId ?? artifactRef ?? workerRef }
  }
}

function LiveResultFocus({
  step,
  isFailure,
  isTerminal,
}: {
  step: WorkflowStepRun
  isFailure: boolean
  isTerminal: boolean
}) {
  const title = isFailure ? "Failure" : isTerminal ? "Final Result" : "Current Phase"
  const summary = isFailure
    ? step.error || step.worker_trace_summary || step.goal
    : step.worker_trace_summary || step.goal

  return (
    <div className="pl-6 ml-1.5 mb-6">
      <div className={`bg-[var(--atl-canvas)] border rounded-lg shadow-[var(--atl-shell-shadow)] overflow-hidden ${
        isFailure ? "border-rose-500/40" : "border-[var(--atl-rule)]"
      }`}>
        <div className="bg-[var(--atl-canvas-soft)] px-4 py-2 border-b border-[var(--atl-rule)] flex items-center justify-between gap-3">
          <span className="text-[10px] uppercase tracking-wider font-mono text-[var(--atl-ink-soft)]">{title}</span>
          <span className="text-[10px] font-mono text-[var(--atl-ink-soft)]">{step.status}</span>
        </div>
        <div className="p-4 text-[var(--atl-ink)] text-[13px] leading-relaxed">
          <div className="mb-2 text-xs font-medium">{step.title || step.phase_id}</div>
          {summary ? <p className="whitespace-pre-wrap">{summary}</p> : null}
          {step.output_artifact_refs.length > 0 ? (
            <div className="mt-3 space-y-1 font-mono text-[10px] text-[var(--atl-ink-soft)]">
              {step.output_artifact_refs.map((ref) => <div key={ref}>{formatWorkflowArtifactLabel(ref)}</div>)}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[var(--atl-ink-soft)] text-xs font-mono mb-4 uppercase tracking-wider">
      <span className="w-4 border-t border-[var(--atl-rule)]" />
      {children}
      <span className="flex-1 border-t border-[var(--atl-rule)]" />
    </div>
  )
}

function formatWorkflowArtifactLabel(ref: string): string {
  return ref.split(/[\\/]/).pop() || "Artifact"
}

function LiveStep({ step }: { step: WorkflowStepRun }) {
  const isRunning = step.status === "running"
  const isDone = step.status === "succeeded"
  const isFailed = step.status === "failed"
  const barClass = isFailed
    ? "bg-rose-500"
    : isDone
      ? "bg-[var(--atl-success)]"
      : "bg-[var(--atl-accent)]"
  const width = isDone || isFailed ? "100%" : isRunning ? "65%" : "8%"

  return (
    <div className="pl-6 ml-1.5 mb-4 border-l border-[var(--atl-rule)] relative">
      <div className="absolute -left-[5px] top-1.5 w-2 h-2 rounded-full bg-[var(--atl-canvas)] border-2 border-[var(--atl-rule)]" />
      <div className="flex justify-between items-end gap-3 mb-1.5">
        <div className="text-[var(--atl-ink)] text-xs font-mono truncate">{step.title || step.phase_id}</div>
        <div className="text-[var(--atl-ink-soft)] text-[10px] font-mono shrink-0">{step.status}</div>
      </div>
      {step.goal ? <div className="text-[var(--atl-ink-soft)] text-[11px] leading-5 mb-2 line-clamp-2">{step.goal}</div> : null}
      <div className="h-[3px] w-full bg-[var(--atl-rule)] rounded-full overflow-hidden">
        <div className={`h-full ${barClass} transition-all duration-500`} style={{ width }} />
      </div>
      {step.error ? <div className="mt-2 font-mono text-[10px] text-rose-500">{step.error}</div> : null}
    </div>
  )
}
