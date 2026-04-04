import type {
  MessageBlock,
  ToolResultBlock as MessageToolResultBlock,
  UIBlock as MessageUIBlock,
} from "@/lib/chat/message-protocol";

const INTERNAL_TOOL_NAMES = new Set([
  "search_sdk",
  "execute_code_plan",
  "consult_expert_network",
  "attach_capability",
  "detach_capability",
  "sys_submit_onboarding_request",
  "shell_execute",
]);

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  search_sdk: "SDK Search",
  execute_code_plan: "Code Execution",
  consult_expert_network: "Expert Consult",
  attach_capability: "Activate Skill",
  detach_capability: "Deactivate Skill",
  sys_submit_onboarding_request: "Onboarding",
  shell_execute: "Shell Execute",
  "shell.exec": "Shell Execute",
};

const TOOL_NAMESPACE_STOP_WORDS = new Set([
  "skill",
  "skills",
  "official",
  "system",
  "local",
  "mcp",
  "tool",
  "tools",
  "server",
  "servers",
  "runtime",
  "desktop",
  "assistant",
  "agent",
]);

const UPPERCASE_TOKENS = new Set([
  "sdk",
  "mcp",
  "api",
  "ui",
  "url",
  "http",
  "https",
  "html",
  "json",
  "csv",
  "sql",
  "pdf",
  "docx",
  "pptx",
  "xlsx",
  "xml",
  "cli",
]);

type ToolSubjectKind = "search" | "url" | "file" | "command" | "generic";

type ToolSubjectHint = {
  kind: ToolSubjectKind;
  value: string;
  count?: number;
};

type ResultCountHint = {
  count: number;
  noun:
    | "result"
    | "row"
    | "document"
    | "file"
    | "page"
    | "item"
    | "match"
    | "record";
};

type ResolveToolPreviewOptions = {
  name?: string;
  status?: string;
  args?: string;
  result?: unknown;
  uiBlocks?: MessageUIBlock[];
  isPendingApproval?: boolean;
  preferredPreview?: string | null;
};

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function titleCaseToken(token: string): string {
  const normalized = token.trim().toLowerCase();
  if (!normalized) return "";
  if (UPPERCASE_TOKENS.has(normalized)) return normalized.toUpperCase();
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
}

function splitToolNameTokens(name?: string | null): string[] {
  if (!name) return [];
  const normalized = name
    .replace(/^skill__system\./, "")
    .replace(/^skill\.official\.skills\./, "")
    .replace(/^official\.skills\./, "")
    .replace(/^skill\./, "");

  const tokens = normalized
    .split(/[./:_-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  const filtered = tokens.filter(
    (token) => !TOOL_NAMESPACE_STOP_WORDS.has(token.toLowerCase()),
  );

  return filtered.length > 0 ? filtered : tokens;
}

function toInlinePreview(value: string, maxLength = 96): string | null {
  const normalized = value
    .replace(/```json/gi, " ")
    .replace(/```/g, " ")
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function parseToolArgs(args?: string): Record<string, unknown> | null {
  if (typeof args !== "string" || !args.trim()) return null;
  try {
    return toRecord(JSON.parse(args));
  } catch {
    return null;
  }
}

function pickFirstString(
  record: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function pickFirstStringArray(
  record: Record<string, unknown>,
  keys: string[],
): string[] {
  for (const key of keys) {
    const value = record[key];
    if (!Array.isArray(value)) continue;
    const items = value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    if (items.length > 0) {
      return items;
    }
  }
  return [];
}

function extractPathLeaf(path: string): string {
  const parts = path.split(/[\\/]/).filter((part) => part.trim().length > 0);
  return parts.at(-1)?.trim() || path.trim();
}

function humanizeUrlForPreview(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.host}${path}`.replace(/\/$/, "");
  } catch {
    return toInlinePreview(rawUrl, 64) ?? rawUrl;
  }
}

function extractToolSubject(args?: string): ToolSubjectHint | null {
  const parsedArgs = parseToolArgs(args);
  if (!parsedArgs) return null;

  const searchText = pickFirstString(parsedArgs, [
    "query",
    "q",
    "keyword",
    "keywords",
    "search",
    "prompt",
    "question",
  ]);
  if (searchText) {
    return {
      kind: "search",
      value: toInlinePreview(searchText, 64) ?? searchText,
    };
  }

  const url = pickFirstString(parsedArgs, ["url", "href", "page", "website"]);
  if (url) {
    return { kind: "url", value: humanizeUrlForPreview(url) };
  }

  const urls = pickFirstStringArray(parsedArgs, ["urls", "pages", "websites"]);
  if (urls.length > 0) {
    return { kind: "url", value: `${urls.length} URLs`, count: urls.length };
  }

  const filePath = pickFirstString(parsedArgs, [
    "file",
    "file_path",
    "path",
    "document",
    "filename",
    "file_name",
  ]);
  if (filePath) {
    return { kind: "file", value: extractPathLeaf(filePath) };
  }

  const files = pickFirstStringArray(parsedArgs, [
    "files",
    "paths",
    "documents",
    "file_paths",
  ]);
  if (files.length > 0) {
    return {
      kind: "file",
      value: `${files.length} files`,
      count: files.length,
    };
  }

  const command = pickFirstString(parsedArgs, ["command", "cmd", "script"]);
  if (command) {
    return {
      kind: "command",
      value: toInlinePreview(command, 64) ?? command,
    };
  }

  const firstUsefulString = Object.values(parsedArgs).find(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0,
  );
  if (firstUsefulString) {
    return {
      kind: "generic",
      value: toInlinePreview(firstUsefulString, 64) ?? firstUsefulString,
    };
  }

  return null;
}

function pluralize(count: number, noun: string): string {
  return count === 1 ? noun : `${noun}s`;
}

function extractResultCount(value: unknown): ResultCountHint | null {
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return { count: value.length, noun: "result" };
  }

  const record = toRecord(value);
  if (!record) return null;

  const arrayKeys: Array<[string, ResultCountHint["noun"]]> = [
    ["results", "result"],
    ["items", "item"],
    ["rows", "row"],
    ["documents", "document"],
    ["files", "file"],
    ["pages", "page"],
    ["matches", "match"],
    ["records", "record"],
    ["data", "item"],
  ];

  for (const [key, noun] of arrayKeys) {
    const candidate = record[key];
    if (!Array.isArray(candidate) || candidate.length === 0) continue;
    return { count: candidate.length, noun };
  }

  const numericKeys: Array<[string, ResultCountHint["noun"]]> = [
    ["count", "result"],
    ["total", "result"],
    ["row_count", "row"],
    ["document_count", "document"],
    ["file_count", "file"],
    ["page_count", "page"],
    ["match_count", "match"],
    ["record_count", "record"],
  ];

  for (const [key, noun] of numericKeys) {
    const candidate = toNumber(record[key]);
    if (candidate === null || candidate <= 0) continue;
    return { count: candidate, noun };
  }

  return null;
}

function hasReadableContent(value: unknown): boolean {
  const record = toRecord(value);
  if (!record) return false;
  return [
    "content",
    "text",
    "markdown",
    "html",
    "body",
    "summary",
    "overview",
    "answer",
  ].some((key) => {
    const candidate = record[key];
    return typeof candidate === "string" && candidate.trim().length > 0;
  });
}

function looksLikeStructuredString(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function summarizeUnknownValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return toInlinePreview(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return toInlinePreview(
      value
        .slice(0, 3)
        .map((item) => summarizeUnknownValue(item) ?? String(item))
        .join(" · "),
    );
  }
  const record = toRecord(value);
  if (record) {
    for (const key of [
      "summary",
      "message",
      "title",
      "status",
      "text",
      "content",
      "error",
    ]) {
      const nextValue = record[key];
      if (typeof nextValue === "string" && nextValue.trim()) {
        return toInlinePreview(nextValue);
      }
    }
    try {
      return toInlinePreview(JSON.stringify(record));
    } catch {
      return null;
    }
  }
  try {
    return toInlinePreview(JSON.stringify(value));
  } catch {
    return toInlinePreview(String(value));
  }
}

export function humanizeToolName(name?: string | null): string | null {
  if (!name) return null;
  if (TOOL_DISPLAY_NAMES[name]) return TOOL_DISPLAY_NAMES[name];
  const tokens = splitToolNameTokens(name);
  if (tokens.length === 0) return name;
  return tokens.map(titleCaseToken).join(" ");
}

export function isInternalTool(name?: string | null): boolean {
  return !!name && INTERNAL_TOOL_NAMES.has(name);
}

export function summarizeToolCalls(parts: MessageBlock[]) {
  const toolNames: string[] = [];
  for (const part of parts) {
    if (part.type !== "tool_call") continue;
    if (typeof part.toolName === "string" && part.toolName.trim().length > 0) {
      toolNames.push(part.toolName.trim());
    } else {
      toolNames.push("tool");
    }
  }
  if (toolNames.length === 0) return null;

  const counter = new Map<string, number>();
  toolNames.forEach((name) => {
    counter.set(name, (counter.get(name) ?? 0) + 1);
  });

  const sorted = Array.from(counter.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([name, count]) => {
      const display = humanizeToolName(name) ?? name;
      return count > 1 ? `${display}×${count}` : display;
    });

  return {
    totalCalls: toolNames.length,
    highlights: sorted.join(" · "),
    allInternal: toolNames.every((name) => isInternalTool(name)),
  };
}

export function resolveToolActionPreview(
  name?: string | null,
  args?: string,
  status?: string,
): string | null {
  const title = humanizeToolName(name) ?? "Tool";
  const normalizedStatus = (status ?? "").trim().toLowerCase();
  if (normalizedStatus === "requires_approval") {
    return `Waiting for approval to continue with ${title}`;
  }

  const subject = extractToolSubject(args);
  if (subject?.kind === "search") {
    return `Searching for "${subject.value}"`;
  }
  if (subject?.kind === "url") {
    return `Reading ${subject.value}`;
  }
  if (subject?.kind === "file") {
    return subject.count
      ? `Reading ${subject.value}`
      : `Reading file ${subject.value}`;
  }
  if (subject?.kind === "command") {
    return `Running ${subject.value}`;
  }
  if (subject?.kind === "generic") {
    return `Working with ${subject.value}`;
  }

  const normalizedName = name?.toLowerCase() ?? "";
  if (normalizedName.includes("search")) return `Searching with ${title}`;
  if (
    normalizedName.includes("fetch") ||
    normalizedName.includes("read") ||
    normalizedName.includes("crawl")
  ) {
    return `Reading with ${title}`;
  }
  if (
    normalizedName.includes("write") ||
    normalizedName.includes("save") ||
    normalizedName.includes("create")
  ) {
    return `Creating output with ${title}`;
  }

  return `Running ${title}`;
}

export function resolveToolResultPreview({
  name,
  result,
  uiBlocks = [],
  isPendingApproval = false,
}: Pick<
  ResolveToolPreviewOptions,
  "name" | "result" | "uiBlocks" | "isPendingApproval"
>): string | null {
  const title = humanizeToolName(name) ?? "Tool";
  if (isPendingApproval) {
    return `Waiting for approval to continue with ${title}`;
  }

  if (uiBlocks.length > 0) {
    return "Prepared an interactive result view";
  }

  const countHint = extractResultCount(result);
  if (countHint) {
    const normalizedName = name?.toLowerCase() ?? "";
    if (countHint.noun === "result" && normalizedName.includes("search")) {
      return `Found ${countHint.count} ${pluralize(countHint.count, "result")}`;
    }
    return `Returned ${countHint.count} ${pluralize(countHint.count, countHint.noun)}`;
  }

  if (hasReadableContent(result)) {
    return "Extracted readable content";
  }

  if (typeof result === "string") {
    const inline = toInlinePreview(result, 88);
    if (inline && !looksLikeStructuredString(inline)) {
      return inline;
    }
  }

  if (result !== null && result !== undefined) {
    return "Returned structured data";
  }

  return null;
}

export function resolveToolPreview({
  name,
  status,
  args,
  result,
  uiBlocks = [],
  isPendingApproval = false,
  preferredPreview = null,
}: ResolveToolPreviewOptions): string | null {
  for (const uiBlock of uiBlocks) {
    if (typeof uiBlock.title === "string" && uiBlock.title.trim()) {
      const viewTitle = toInlinePreview(uiBlock.title);
      if (viewTitle) {
        return `Prepared ${viewTitle}`;
      }
    }
  }

  if (preferredPreview) return preferredPreview;

  const resultPreview =
    resolveToolResultPreview({ name, result, uiBlocks, isPendingApproval }) ??
    summarizeUnknownValue(result);
  if (resultPreview) return resultPreview;

  return resolveToolActionPreview(name, args, status);
}

export function resolveToolStatusDetail(
  statusCode: string | null,
  statusMeta: Record<string, unknown> | null,
  translate?: (key: string, values?: Record<string, unknown>) => string,
): string | null {
  const toolName = humanizeToolName(
    typeof statusMeta?.tool_name === "string" ? statusMeta.tool_name : null,
  );
  const targetName =
    typeof statusMeta?.target_name === "string" &&
    statusMeta.target_name.trim().length > 0
      ? statusMeta.target_name.trim()
      : null;

  if (statusCode === "approval.required" && toolName) {
    return translate
      ? translate("island.toolStatus.pendingApproval", { name: toolName })
      : `Waiting for approval to continue with ${toolName}`;
  }
  if (statusCode === "approval.executing" && toolName) {
    return translate
      ? translate("island.toolStatus.running", { name: toolName })
      : `Running ${toolName}`;
  }
  if (statusCode === "tool.call" && toolName) {
    return translate
      ? translate("island.toolStatus.using", { name: toolName })
      : `Using ${toolName}`;
  }
  if (statusCode === "execution.running" && targetName) {
    return translate
      ? translate("island.toolStatus.running", { name: targetName })
      : `Running ${targetName}`;
  }

  return null;
}

export function resolveToolResultTitle(
  name?: string | null,
  callId?: string | null,
): string {
  return humanizeToolName(name) ?? callId ?? "tool_result";
}
