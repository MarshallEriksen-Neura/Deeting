"use client"

import { type ReactNode, useMemo, useState } from "react"
import { Copy, Terminal } from "lucide-react"

import { Button } from "@/components/ui/shadcn/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/shadcn/tabs"
import { cn } from "@/lib/utils"
import type { GatewayLogDTO } from "@/types/gateway_log"

import {
  formatCurrency,
  formatDateTime,
  shortId,
} from "./logs-shared"

interface LogsDetailPanelProps {
  log: GatewayLogDTO | null
}

export function LogsDetailPanel({ log }: LogsDetailPanelProps) {
  const [copied, setCopied] = useState(false)
  const meta = useMemo(
    () => (log?.meta && typeof log.meta === "object" ? (log.meta as Record<string, unknown>) : null),
    [log]
  )
  const requestPayload = meta?.request_payload ?? null
  const upstreamRequest = meta?.upstream_request ?? null
  const isError = log ? log.status_code >= 400 : false

  async function handleCopy() {
    if (!log || typeof navigator === "undefined" || !navigator.clipboard?.writeText) return
    await navigator.clipboard.writeText(JSON.stringify(log, null, 2))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  if (!log) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center bg-[var(--panel-bg-inset)] font-mono">
        <div className="max-w-xs space-y-4">
          <Terminal className="mx-auto size-6 text-[var(--ink-4)]" />
          <p className="text-[11px] uppercase tracking-widest text-[var(--ink-3)]">Waiting For Selection...</p>
          <div className="h-px w-full bg-[var(--hairline)]" />
          <p className="text-[10px] text-[var(--ink-4)] leading-relaxed italic">
            Pick a request from the left to inspect raw telemetry, headers, and payloads.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--panel-bg)] font-mono">
      {/* Detail Header */}
      <header className="flex h-10 flex-none items-center justify-between border-b border-[var(--hairline)] bg-[var(--background)] px-4">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase text-[var(--ink-3)]">INSPECT:</span>
          <span className="text-[11px] font-bold text-[var(--ink)] uppercase">{shortId(log.id)}</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 rounded-none border border-[var(--hairline)] bg-transparent px-2 text-[10px] text-[var(--ink-3)] hover:bg-[var(--panel-bg-inset)] hover:text-[var(--ink)] uppercase font-mono shadow-none"
          onClick={() => void handleCopy()}
        >
          <Copy className="mr-1 size-3" />
          {copied ? "COPIED" : "COPY_JSON"}
        </Button>
      </header>

      <Tabs defaultValue="overview" className="flex min-h-0 flex-1 flex-col">
        {/* Metric Bar */}
        <div className="grid grid-cols-2 gap-px border-b border-[var(--hairline)] bg-[var(--hairline)]">
          <MetricBox label="STATUS" value={log.status_code.toString()} tone={isError ? "red" : "green"} />
          <MetricBox label="MODEL" value={log.model} />
          <MetricBox label="LATENCY" value={`${log.duration_ms}ms`} />
          <MetricBox label="COST" value={`$${formatCurrency(log.cost_user)}`} tone="green" />
        </div>

        <TabsList className="h-9 w-full justify-start gap-px rounded-none border-b border-[var(--hairline)] bg-[var(--hairline)] p-0">
          <DetailTab value="overview" label="OVERVIEW" />
          <DetailTab value="request" label="REQUEST" />
          <DetailTab value="upstream" label="UPSTREAM" />
          <DetailTab value="raw" label="RAW" />
        </TabsList>

        <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar-brutalist p-4 bg-[var(--panel-bg)]">
          <TabsContent value="overview" className="mt-0 space-y-6">
            <InfoGroup title="IDENTIFICATION">
              <Row label="ID" value={log.id} />
              <Row label="TIMESTAMP" value={formatDateTime(log.created_at, true)} />
              <Row label="USER_ID" value={log.user_id ?? "N/A"} />
            </InfoGroup>

            <InfoGroup title="TELEMETRY">
              <Row label="INPUT_TOKENS" value={log.input_tokens.toLocaleString()} />
              <Row label="OUTPUT_TOKENS" value={log.output_tokens.toLocaleString()} />
              <Row label="TOTAL_TOKENS" value={log.total_tokens.toLocaleString()} />
              <Row label="TTFT" value={log.ttft_ms ? `${log.ttft_ms}ms` : "N/A"} />
              <Row label="CACHED" value={log.is_cached ? "TRUE" : "FALSE"} tone={log.is_cached ? "cyan" : "gray"} />
            </InfoGroup>

            {log.error_code && (
              <InfoGroup title="EXCEPTION" tone="red">
                <div className="text-[11px] text-[var(--danger)] uppercase font-bold break-all">
                  {log.error_code}
                </div>
              </InfoGroup>
            )}
          </TabsContent>

          <TabsContent value="request" className="mt-0">
            <JsonTerminal value={requestPayload} />
          </TabsContent>

          <TabsContent value="upstream" className="mt-0">
            <JsonTerminal value={upstreamRequest} />
          </TabsContent>

          <TabsContent value="raw" className="mt-0">
            <JsonTerminal value={meta} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  )
}

function MetricBox({ label, value, tone = "gray" }: { label: string; value: string; tone?: "gray" | "green" | "red" }) {
  return (
    <div className="bg-[var(--background)] px-4 py-2">
      <div className="text-[9px] font-bold text-[var(--ink-4)] uppercase tracking-tighter">{label}</div>
      <div className={cn(
        "text-[12px] font-bold mt-0.5 uppercase truncate",
        tone === "green" ? "text-[var(--ok)]" : tone === "red" ? "text-[var(--danger)]" : "text-[var(--ink)]"
      )}>
        {value}
      </div>
    </div>
  )
}

function DetailTab({ value, label }: { value: string; label: string }) {
  return (
    <TabsTrigger
      value={value}
      className="h-full rounded-none px-4 text-[10px] font-bold uppercase tracking-tight data-[state=active]:bg-[var(--panel-bg)] data-[state=active]:text-[var(--accent-strong)] text-[var(--ink-3)] hover:text-[var(--ink)] shadow-none"
    >
      {label}
    </TabsTrigger>
  )
}

function InfoGroup({ title, children, tone = "gray" }: { title: string; children: ReactNode; tone?: "gray" | "red" }) {
  return (
    <div className="space-y-2">
      <div className={cn(
        "text-[10px] font-bold uppercase border-b pb-1",
        tone === "red" ? "border-[var(--danger-border)] text-[var(--danger)]" : "border-[var(--hairline)] text-[var(--ink-4)]"
      )}>
        {title}
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

function Row({ label, value, tone = "gray" }: { label: string; value: string; tone?: "gray" | "cyan" }) {
  return (
    <div className="flex items-center justify-between gap-4 text-[11px]">
      <span className="text-[var(--ink-3)] font-bold tracking-tight">{label}</span>
      <span className={cn(
        "font-bold truncate text-[var(--ink-2)]",
        tone === "cyan" && "text-[var(--info)]"
      )}>{value}</span>
    </div>
  )
}

function JsonTerminal({ value }: { value: unknown }) {
  if (value == null) {
    return (
      <div className="py-8 text-center text-[10px] text-[var(--ink-4)] uppercase italic">
        [ NO_DATA_RECORDED ]
      </div>
    )
  }

  return (
    <pre className="text-[11px] leading-relaxed text-[var(--ink-2)] whitespace-pre-wrap break-all font-mono">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}
