import type {
  ActivityTimelineBlock,
  MessageBlock,
  RuntimeActivityEvent,
  ToolCallBlock,
  ToolResultBlock,
} from "@/lib/chat/message-protocol";
import {
  humanizeToolName,
  resolveToolActionPreview,
  resolveToolResultPreview,
} from "@/lib/chat/tool-ux";

export type RuntimeActivityStatusInput = {
  messageId: string;
  stage?: string | null;
  code?: string | null;
  meta?: Record<string, unknown> | null;
  timestamp?: number;
};

const ACTIVITY_TIMELINE_BLOCK_ID = "activity-timeline";

function now(timestamp?: number) {
  return typeof timestamp === "number" && Number.isFinite(timestamp)
    ? timestamp
    : Date.now();
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function eventId(parts: Array<string | null | undefined>) {
  return parts
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(":");
}

function stageFromStatus(stage?: string | null): RuntimeActivityEvent["stage"] {
  switch (stage) {
    case "listen":
    case "remember":
    case "evolve":
    case "render":
      return stage;
    default:
      return "evolve";
  }
}

function isFailureCode(code: string) {
  return code.includes("failed") || code.includes("error");
}

function isCancelledCode(code: string) {
  return code.includes("cancelled") || code.includes("canceled");
}

function statusEventTitle(code: string, meta?: Record<string, unknown> | null): string | null {
  if (code === "approval.required") return "需要你确认";
  if (code === "approval.executing") return "已确认, 继续执行";
  if (code.includes("context.pressure") || code.includes("context_pressure")) return "上下文接近上限";
  if (isCancelledCode(code)) return "执行已取消";
  if (isFailureCode(code)) return "执行阶段失败";

  if (code === "context.loaded" || code === "context.manifest.loaded" || code.startsWith("knowledge.context.")) {
    return "读取上下文";
  }
  if (code === "routing.selected" || code === "runtime.route.selected") return "选择执行路径";
  if (
    code === "summary.empty" ||
    code === "summary.loaded" ||
    code === "persona.loaded" ||
    code === "prompt.variant.selected" ||
    code === "template.rendered" ||
    code === "skills.recipes.injected" ||
    code === "context.manifest.loaded" ||
    code.includes("injection")
  ) {
    return "准备提示";
  }
  if (code === "upstream.request.stream" || code === "upstream.request.batch") return "等待模型响应";
  if (code === "upstream.streaming") return "生成回答";
  if (code === "upstream.response") return "模型响应完成";
  if (code === "tool.call") return "调用工具";

  const requiredArtifact = asString(meta?.required_artifact);
  if (requiredArtifact === "diting_think_preflight") return "校准任务边界";

  return null;
}

function statusEventDetail(code: string, meta?: Record<string, unknown> | null): string | undefined {
  if (code === "context.loaded") {
    const count = Number(meta?.count ?? 0);
    return Number.isFinite(count) && count > 0 ? `${count} 条上下文` : undefined;
  }
  if (code === "context.manifest.loaded") {
    const sources = Array.isArray(meta?.available_sources) ? meta.available_sources.length : 0;
    const tools = Array.isArray(meta?.available_tools) ? meta.available_tools.length : 0;
    if (sources > 0 || tools > 0) return `${sources} 类来源 · ${tools} 个上下文工具`;
  }
  if (code === "routing.selected" || code === "runtime.route.selected") {
    const route = asString(meta?.route) ?? asString(meta?.model_selection_mode);
    const model = asString(meta?.logical_model_key) ?? asString(meta?.model_id);
    return [route, model].filter(Boolean).join(" · ") || undefined;
  }
  if (code === "approval.required" || code === "approval.executing") {
    return asString(meta?.tool_name) ?? asString(meta?.target_name) ?? undefined;
  }
  if (code === "upstream.response") {
    const latency = Number(meta?.total_latency_ms ?? meta?.latency_ms ?? 0);
    return Number.isFinite(latency) && latency > 0 ? `${Math.round(latency)}ms` : undefined;
  }
  return undefined;
}

export function activityEventFromStatus({
  messageId,
  stage,
  code,
  meta,
  timestamp,
}: RuntimeActivityStatusInput): RuntimeActivityEvent | null {
  const normalizedCode = asString(code);
  if (!normalizedCode) return null;
  const title = statusEventTitle(normalizedCode, meta);
  if (!title) return null;

  const level: RuntimeActivityEvent["level"] =
    normalizedCode === "approval.required"
      ? "action"
      : isFailureCode(normalizedCode)
        ? "error"
        : isCancelledCode(normalizedCode) || normalizedCode.includes("context.pressure")
          ? "warning"
          : normalizedCode === "upstream.response"
            ? "success"
            : "info";

  const status: RuntimeActivityEvent["status"] =
    normalizedCode === "approval.required"
      ? "waiting"
      : isFailureCode(normalizedCode)
        ? "failed"
        : isCancelledCode(normalizedCode)
          ? "cancelled"
          : normalizedCode === "upstream.response"
            ? "done"
            : "running";

  return {
    id: eventId(["status", normalizedCode]),
    messageId,
    stage: stageFromStatus(stage),
    level,
    title,
    detail: statusEventDetail(normalizedCode, meta),
    status,
    timestamp: now(timestamp),
    source: normalizedCode.includes("context.pressure") ? "context_pressure" : "status",
    critical: level === "action" || level === "error" || level === "warning",
    collapsible: level === "info" || level === "success",
    debug: { code: normalizedCode, stage, meta },
  };
}

function semanticToolTitle(toolName?: string | null): string {
  const normalized = toolName?.toLowerCase() ?? "";
  if (normalized.includes("browser") || normalized.includes("page_snapshot") || normalized.includes("tab")) {
    return "读取浏览器页面";
  }
  if (normalized.includes("search")) return "搜索资料";
  if (normalized.includes("shell") || normalized.includes("execute") || normalized.includes("code")) return "执行命令";
  if (normalized.includes("scrape") || normalized.includes("crawl") || normalized.includes("fetch") || normalized.includes("read")) {
    return "读取资料";
  }
  if (normalized.includes("delegate")) return "委托执行中";
  return humanizeToolName(toolName) ?? "调用工具";
}

function toolEventId(block: ToolCallBlock | ToolResultBlock) {
  return eventId(["tool", block.callId, block.toolName]) || eventId(["tool", block.id]);
}

export function activityEventFromToolBlock(
  messageId: string,
  block: ToolCallBlock | ToolResultBlock,
  timestamp?: number,
): RuntimeActivityEvent | null {
  const id = toolEventId(block);
  if (!id) return null;
  const isResult = block.type === "tool_result";
  const isError = block.status === "error";
  const isApproval = block.status === "requires_approval";
  const title = isApproval ? "需要你确认" : semanticToolTitle(block.toolName);
  const actionDetail =
    block.type === "tool_call"
      ? resolveToolActionPreview(block.toolName, block.toolArgs, block.status)
      : null;
  const resultDetail =
    block.type === "tool_result"
      ? resolveToolResultPreview({
          name: block.toolName,
          result: block.result,
          isPendingApproval: isApproval,
        })
      : null;

  return {
    id,
    messageId,
    stage: isApproval ? "approval" : "tool",
    level: isApproval ? "action" : isError ? "error" : isResult ? "success" : "info",
    title,
    detail: resultDetail ?? actionDetail ?? humanizeToolName(block.toolName) ?? undefined,
    status: isApproval ? "waiting" : isError ? "failed" : isResult ? "done" : "running",
    timestamp: now(timestamp),
    source: block.type,
    critical: isApproval || isError,
    collapsible: !isApproval && !isError,
    debug: block,
  };
}

export function activityEventsFromBlocks(
  messageId: string,
  blocks: MessageBlock[],
  timestamp?: number,
): RuntimeActivityEvent[] {
  return blocks.flatMap((block) => {
    if (block.type !== "tool_call" && block.type !== "tool_result") return [];
    const event = activityEventFromToolBlock(messageId, block, timestamp);
    return event ? [event] : [];
  });
}

function mergeEvent(existing: RuntimeActivityEvent | undefined, incoming: RuntimeActivityEvent): RuntimeActivityEvent {
  if (!existing) return incoming;
  return {
    ...existing,
    ...incoming,
    timestamp: existing.timestamp,
    detail: incoming.detail ?? existing.detail,
    critical: existing.critical || incoming.critical,
    collapsible: existing.collapsible && incoming.collapsible,
  };
}

export function mergeActivityEvents(
  existing: RuntimeActivityEvent[] | undefined,
  incoming: RuntimeActivityEvent[],
): RuntimeActivityEvent[] {
  const byId = new Map<string, RuntimeActivityEvent>();
  for (const event of existing ?? []) {
    byId.set(event.id, event);
  }
  for (const event of incoming) {
    byId.set(event.id, mergeEvent(byId.get(event.id), event));
  }
  return Array.from(byId.values()).sort((left, right) => left.timestamp - right.timestamp);
}

export function createActivityTimelineBlock(
  messageId: string,
  events: RuntimeActivityEvent[],
): ActivityTimelineBlock | null {
  if (events.length === 0) return null;
  return {
    id: `${messageId}-${ACTIVITY_TIMELINE_BLOCK_ID}`,
    type: "activity_timeline",
    displayMode: "bubble",
    streamState: "completed",
    events,
  };
}

export function mergeActivityTimelineBlock(
  existing: ActivityTimelineBlock | undefined,
  incoming: ActivityTimelineBlock,
): ActivityTimelineBlock {
  return {
    ...existing,
    ...incoming,
    id: existing?.id || incoming.id,
    events: mergeActivityEvents(existing?.events, incoming.events),
    collapsed: incoming.collapsed ?? existing?.collapsed,
    summary: incoming.summary ?? existing?.summary,
  };
}

export type ActivityTimelineViewModel = {
  visible: boolean;
  collapsed: boolean;
  summary: string | null;
  events: RuntimeActivityEvent[];
  hiddenCount: number;
};

function hasToolEvent(events: RuntimeActivityEvent[]) {
  return events.some((event) => event.source === "tool_call" || event.source === "tool_result");
}

function hasCriticalEvent(events: RuntimeActivityEvent[]) {
  return events.some((event) => event.critical || event.level === "error" || event.level === "action" || event.status === "failed");
}

function summarizeDoneEvents(events: RuntimeActivityEvent[]) {
  const labels: string[] = [];
  for (const event of events) {
    if (event.status !== "done" && event.status !== "failed") continue;
    if (labels.includes(event.title)) continue;
    labels.push(event.title);
    if (labels.length >= 3) break;
  }
  return labels.length > 0 ? `完成 · ${labels.join("、")}` : "完成";
}

export function buildActivityTimelineViewModel(
  block: ActivityTimelineBlock,
  options: { isActive: boolean; maxVisible?: number },
): ActivityTimelineViewModel {
  const events = Array.isArray(block.events) ? block.events : [];
  if (events.length === 0) {
    return { visible: false, collapsed: false, summary: null, events: [], hiddenCount: 0 };
  }

  const critical = hasCriticalEvent(events);
  const toolHeavy = hasToolEvent(events);
  const visible = options.isActive || critical || toolHeavy;
  if (!visible) {
    return { visible: false, collapsed: false, summary: null, events: [], hiddenCount: 0 };
  }

  const collapsed = !options.isActive && !critical;
  if (collapsed) {
    return {
      visible: true,
      collapsed: true,
      summary: block.summary ?? summarizeDoneEvents(events),
      events: [],
      hiddenCount: events.length,
    };
  }

  const maxVisible = Math.max(1, options.maxVisible ?? 5);
  const important = events.filter((event) => event.critical || event.status === "running" || event.status === "waiting");
  const tail = events.slice(-maxVisible);
  const visibleEvents = mergeActivityEvents([], [...tail, ...important]).slice(-maxVisible);

  return {
    visible: true,
    collapsed: false,
    summary: null,
    events: visibleEvents,
    hiddenCount: Math.max(0, events.length - visibleEvents.length),
  };
}
