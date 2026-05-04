"use client";

import { useEffect, useMemo, useRef } from "react";
import type { Message } from "@/lib/chat/message-types";
import type { MessageBlock } from "@/lib/chat/message-protocol";
import { useBrowserModeStore } from "@/store/browser-mode-store";
import { useWorkspaceStore } from "@/store/workspace-store";

function normalizeBrowserToolName(
  value: string | null | undefined,
): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return null;
  return trimmed.startsWith("core.") ? trimmed.slice("core.".length) : trimmed;
}

function isBrowserToolName(value: string | null | undefined): boolean {
  const normalized = normalizeBrowserToolName(value);
  return Boolean(normalized && normalized.startsWith("browser_"));
}

function parseToolArgs(
  raw: string | null | undefined,
): Record<string, unknown> | null {
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function hostFromUrl(url: string | null): string {
  if (!url) return "";
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function describeToolCall(toolName: string): {
  phase: "waiting" | "acting" | "verifying" | "recovering";
  label: string;
} {
  switch (toolName) {
    case "browser_wait_for_element":
      return { phase: "waiting", label: "Waiting for target element" };
    case "browser_wait":
      return { phase: "waiting", label: "Waiting for browser condition" };
    case "browser_wait_for_navigation":
      return { phase: "verifying", label: "Waiting for navigation" };
    case "browser_retry_with_relocate":
      return {
        phase: "recovering",
        label: "Retrying after re-locating target",
      };
    case "browser_get_page_snapshot":
    case "browser_find_element":
    case "browser_extract":
    case "browser_region_screenshot":
    case "browser_full_page_screenshot":
    case "browser_get_active_page":
    case "browser_console_log":
    case "browser_network_log":
    case "browser_storage_read":
    case "browser_accessibility_audit":
      return { phase: "verifying", label: "Inspecting browser page" };
    case "browser_upload_file":
      return { phase: "acting", label: "Uploading file in browser" };
    case "browser_downloads":
      return { phase: "verifying", label: "Checking browser downloads" };
    case "browser_dialog":
      return { phase: "acting", label: "Handling browser dialog" };
    case "browser_tabs":
      return { phase: "acting", label: "Managing browser tabs" };
    default:
      return { phase: "acting", label: "Executing browser action" };
  }
}

function applyBrowserToolResult(
  toolName: string,
  result: Record<string, unknown>,
  update: ReturnType<typeof useBrowserModeStore.getState>,
  toolArgs: Record<string, unknown> | null,
) {
  if (toolName === "browser_retry_with_relocate") {
    const retryCount =
      typeof result.attempts === "number" ? result.attempts : 0;
    const recoveryReason =
      asString(result.recovery_reason) ??
      asString(result.final_error) ??
      "Recovered after re-locating target";
    if (result.recovered === true || result.ok === false) {
      update.markRecovery(recoveryReason, retryCount);
    }
    update.appendTimelineEvent({
      kind: "tool_result",
      phase: "recovering",
      label:
        asString(result.status) === "REQUIRES_APPROVAL"
          ? "Fresh approval required after recovery"
          : result.ok === true
            ? "Recovered browser action after re-locating target"
            : recoveryReason,
    });
    update.setLastAction({
      kind: toolName,
      summary:
        asString(result.status) === "REQUIRES_APPROVAL"
          ? "Fresh approval required after recovery"
          : result.ok === true
            ? "Recovered browser action after re-locating target"
            : recoveryReason,
    });
    const snapshot = toRecord(result.last_snapshot_summary);
    const url = asString(snapshot?.url);
    const title = asString(snapshot?.title);
    update.mergePage({
      url: url ?? "",
      title: title ?? "",
      host: hostFromUrl(url),
    });
    return;
  }

  if (asString(result.status) === "REQUIRES_APPROVAL") {
    update.setExecutionState("waiting", "Approval required");
    update.appendTimelineEvent({
      kind: "tool_result",
      phase: "waiting",
      label: "Approval required",
    });
    update.setLastAction({ kind: toolName, summary: "Approval required" });
    return;
  }

  if (
    [
      "browser_get_page_snapshot",
      "browser_find_element",
      "browser_extract",
      "browser_region_screenshot",
      "browser_full_page_screenshot",
      "browser_get_active_page",
      "browser_console_log",
      "browser_network_log",
      "browser_storage_read",
      "browser_accessibility_audit",
    ].includes(toolName)
  ) {
    update.setExecutionState("verifying", "Browser inspection completed");
    update.appendTimelineEvent({
      kind: "tool_result",
      phase: "verifying",
      label: "Browser inspection completed",
    });
    update.setLastAction({
      kind: toolName,
      summary: "Browser inspection completed",
    });
    const url = asString(result.url);
    const title = asString(result.title);
    if (url || title) {
      update.mergePage({
        url: url ?? "",
        title: title ?? "",
        host: hostFromUrl(url),
      });
    }
    return;
  }

  if (
    [
      "browser_navigate_tab",
      "browser_tabs",
      "browser_fill",
      "browser_key",
      "browser_select",
      "browser_upload_file",
      "browser_downloads",
      "browser_dialog",
      "browser_storage_write",
      "browser_eval",
      "browser_highlight",
    ].includes(toolName)
  ) {
    update.setExecutionState("acting", "Browser action completed");
    update.appendTimelineEvent({
      kind: "tool_result",
      phase: "acting",
      label: "Browser action completed",
    });
    update.setLastAction({
      kind: toolName,
      summary: "Browser action completed",
    });
    const url = asString(result.url);
    const title = asString(result.title);
    if (url || title) {
      update.mergePage({
        url: url ?? "",
        title: title ?? "",
        host: hostFromUrl(url),
      });
    }
    return;
  }
  if (toolName === "browser_wait_for_element") {
    update.setExecutionState("waiting", "Target element located");
    update.appendTimelineEvent({
      kind: "tool_result",
      phase: "waiting",
      label: "Target element located",
    });
    update.setLastAction({ kind: toolName, summary: "Target element located" });
    const url = asString(result.url);
    const title = asString(result.title);
    update.mergePage({
      url: url ?? "",
      title: title ?? "",
      host: hostFromUrl(url),
    });
    return;
  }

  if (toolName === "browser_wait_for_navigation") {
    update.setExecutionState("verifying", "Navigation confirmed");
    update.appendTimelineEvent({
      kind: "tool_result",
      phase: "verifying",
      label: "Navigation confirmed",
    });
    update.setLastAction({ kind: toolName, summary: "Navigation confirmed" });
    const url = asString(result.url);
    const title = asString(result.title);
    update.mergePage({
      url: url ?? "",
      title: title ?? "",
      host: hostFromUrl(url),
    });
    return;
  }

  if (toolName === "browser_scroll_into_view") {
    update.setExecutionState("acting", "Scrolled target into view");
    update.appendTimelineEvent({
      kind: "tool_result",
      phase: "acting",
      label: "Scrolled target into view",
    });
    update.setLastAction({
      kind: toolName,
      summary: "Scrolled target into view",
    });
    return;
  }

  if (toolName === "browser_click") {
    update.setExecutionState("acting", "Clicked browser element");
    update.appendTimelineEvent({
      kind: "tool_result",
      phase: "acting",
      label: "Clicked browser element",
    });
    update.setLastAction({
      kind: toolName,
      summary: "Clicked browser element",
    });
    return;
  }

  if (toolName === "browser_type") {
    const text = asString(toolArgs?.text);
    update.setExecutionState("acting", "Typed into browser element");
    update.appendTimelineEvent({
      kind: "tool_result",
      phase: "acting",
      label: text
        ? `Typed "${text}" into browser element`
        : "Typed into browser element",
    });
    update.setLastAction({
      kind: toolName,
      summary: text
        ? `Typed "${text}" into browser element`
        : "Typed into browser element",
    });
  }
}

function findLatestBrowserBlock(messages: Message[]) {
  for (
    let messageIndex = messages.length - 1;
    messageIndex >= 0;
    messageIndex -= 1
  ) {
    const message = messages[messageIndex];
    if (message.role !== "assistant" || !Array.isArray(message.blocks))
      continue;
    for (
      let blockIndex = message.blocks.length - 1;
      blockIndex >= 0;
      blockIndex -= 1
    ) {
      const block = message.blocks[blockIndex];
      const toolName =
        block.type === "tool_call" || block.type === "tool_result"
          ? normalizeBrowserToolName(block.toolName)
          : null;
      if (toolName && isBrowserToolName(toolName)) {
        return { message, block, toolName };
      }
    }
  }
  return null;
}

export function useBrowserModeToolActivity(messages: Message[]) {
  const lastProcessedRef = useRef<string | null>(null);
  const browserModeStore = useBrowserModeStore.getState();
  const workspaceStore = useWorkspaceStore.getState();

  const latest = useMemo(() => findLatestBrowserBlock(messages), [messages]);

  useEffect(() => {
    if (!latest) return;
    const { block, toolName } = latest;
    const blockStatus =
      block.type === "tool_call" || block.type === "tool_result"
        ? (block.status ?? "")
        : "";
    const key = `${latest.message.id}:${block.id}:${block.type}:${toolName}:${blockStatus}`;
    if (lastProcessedRef.current === key) return;
    lastProcessedRef.current = key;

    workspaceStore.openView({
      id: "browser-mode",
      type: "browser-mode",
      title: "Browser Mode",
      content: { source: "chat-browser-mode" },
    });

    if (block.type === "tool_call") {
      const next = describeToolCall(toolName);
      browserModeStore.setExecutionState(next.phase, next.label);
      browserModeStore.appendTimelineEvent({
        kind: "tool_call",
        phase: next.phase,
        label: next.label,
      });
      return;
    }

    if (block.type === "tool_result") {
      const result = toRecord(block.result);
      const relatedCall = latest.message.blocks?.find(
        (candidate) =>
          candidate.type === "tool_call" &&
          candidate.callId &&
          candidate.callId === block.callId,
      );
      const toolArgs =
        relatedCall?.type === "tool_call"
          ? parseToolArgs(relatedCall.toolArgs)
          : null;
      if (result) {
        applyBrowserToolResult(toolName, result, browserModeStore, toolArgs);
      }
    }
  }, [browserModeStore, latest, workspaceStore]);
}
