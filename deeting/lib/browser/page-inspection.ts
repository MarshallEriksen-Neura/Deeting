import type { BrowserAgentPageSnapshot } from "@/lib/api/browser-agent"

export interface PageInspectionMetric {
  label: string
  value: string
}

export interface PageInspectionFinding {
  level: "info" | "warning" | "critical"
  text: string
}

export interface PageInspectionRecord {
  title: string
  detail: string
}

export interface PageInspectionNextAction {
  label: string
  prompt: string
}

export interface PageInspectionResult {
  page: {
    title: string
    url: string
    module?: string
  }
  summary: string
  keyMetrics: PageInspectionMetric[]
  findings: PageInspectionFinding[]
  records: PageInspectionRecord[]
  nextActions: PageInspectionNextAction[]
}

const INSPECTION_PROMPT_KEYWORDS = [
  "巡检这个页面",
  "巡检当前页面",
  "检查这个页面",
  "检查当前页面",
  "inspect this page",
  "inspect current page",
]

const CRITICAL_KEYWORDS = [
  "异常",
  "失败",
  "错误",
  "超时",
  "error",
  "failed",
  "timeout",
]

const WARNING_KEYWORDS = [
  "待处理",
  "告警",
  "禁用",
  "阻塞",
  "warning",
  "pending",
  "disabled",
  "blocked",
]

function normalizeLines(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    )
  )
}

function detectFindings(lines: string[]): PageInspectionFinding[] {
  const findings: PageInspectionFinding[] = []

  for (const line of lines) {
    const normalized = line.toLowerCase()
    if (CRITICAL_KEYWORDS.some((keyword) => normalized.includes(keyword.toLowerCase()))) {
      findings.push({ level: "critical", text: line })
      continue
    }
    if (WARNING_KEYWORDS.some((keyword) => normalized.includes(keyword.toLowerCase()))) {
      findings.push({ level: "warning", text: line })
    }
  }

  return findings.slice(0, 5)
}

function detectRecords(lines: string[]): PageInspectionRecord[] {
  return lines
    .filter((line) => /\d/.test(line) || CRITICAL_KEYWORDS.some((k) => line.includes(k)) || WARNING_KEYWORDS.some((k) => line.includes(k)))
    .slice(0, 5)
    .map((line) => ({
      title: line,
      detail: "Detected from current page snapshot",
    }))
}

function buildSummary(snapshot: BrowserAgentPageSnapshot, findings: PageInspectionFinding[]): string {
  if (findings.length > 0) {
    return `Inspected "${snapshot.title}" and detected ${findings.length} notable issue(s).`
  }
  return `Inspected "${snapshot.title}" and found no obvious warning states on the current page.`
}

export function buildPageInspectionResult(
  snapshot: BrowserAgentPageSnapshot
): PageInspectionResult {
  const lines = normalizeLines([snapshot.mainText, snapshot.visibleText].filter(Boolean).join("\n"))
  const findings = detectFindings(lines)
  const module = snapshot.headings[0]?.text || undefined

  return {
    page: {
      title: snapshot.title,
      url: snapshot.url,
      module,
    },
    summary: buildSummary(snapshot, findings),
    keyMetrics: [
      { label: "Headings", value: String(snapshot.headings.length) },
      { label: "Links", value: String(snapshot.links.length) },
      { label: "Buttons", value: String(snapshot.buttons.length) },
      { label: "Inputs", value: String(snapshot.inputs.length) },
      { label: "Findings", value: String(findings.length) },
    ],
    findings,
    records: detectRecords(lines),
    nextActions: [
      {
        label: "Focus abnormal items",
        prompt: "继续定位这个页面里的异常项并展开详情",
      },
      {
        label: "Inspect current list",
        prompt: "继续巡检当前页面列表中的重点记录",
      },
      {
        label: "Explain this page",
        prompt: "解释这个后台页面当前最值得注意的状态和下一步建议",
      },
    ],
  }
}

export function isPageInspectionPrompt(input: string): boolean {
  const normalized = input.trim().toLowerCase()
  if (!normalized) return false
  return INSPECTION_PROMPT_KEYWORDS.some((keyword) =>
    normalized.includes(keyword.toLowerCase())
  )
}
