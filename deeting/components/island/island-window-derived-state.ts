"use client";

import { deriveAssistantActivityState } from "@/lib/chat/assistant-activity";
import { extractAssistantTextFromBlocks } from "@/lib/chat/message-blocks";
import type { Message } from "@/lib/chat/message-types";
import { findLatestUnresolvedToolApproval } from "@/lib/chat/tool-approval";

import type { IslandApproval, IslandRecentMessage } from "./island-store";

const DEFAULT_LAST_REPLY = "No replies yet.";
const DEFAULT_SUMMARY = "Open a conversation to keep Deeting nearby.";
const ISLAND_TRANSCRIPT_MAX_MESSAGES = 8;

type IslandChatSnapshotLike = {
  messages: Message[];
  isLoading: boolean;
  globalLoading: boolean;
  statusCode: string | null;
  errorMessage: string | null;
};

export type IslandWindowDerivedState = {
  statusLabel: string;
  summaryText: string;
  lastReplyText: string;
  lastReplyAt: number | null;
  recentMessages: IslandRecentMessage[];
  pendingApproval: IslandApproval | null;
  errorMessage: string | null;
};

export function truncateIslandText(value: string, maxChars: number) {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function messagePreview(message: Message | undefined): string | null {
  if (!message) return null;
  const fromBlocks = extractAssistantTextFromBlocks(message.blocks).trim();
  if (fromBlocks.length > 0) {
    return fromBlocks;
  }

  const content = typeof message.content === "string" ? message.content.trim() : "";
  return content.length > 0 ? content : null;
}

function findLatestAssistantMessage(messages: Message[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    if (messagePreview(message)) return message;
  }
  return undefined;
}

function findLatestUserMessage(messages: Message[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") continue;
    const content = typeof message.content === "string" ? message.content.trim() : "";
    if (content.length > 0) return message;
  }
  return undefined;
}

function derivePendingApproval(messages: Message[]): IslandApproval | null {
  const approval = findLatestUnresolvedToolApproval(messages);
  if (!approval) return null;

  return {
    id: approval.approval_token,
    title: approval.tool_name,
    desc: approval.description ?? "Approval is required before the task can continue.",
    approvalToken: approval.approval_token,
    toolName: approval.tool_name,
    callId: approval.meta.call_id,
  };
}

function deriveSummaryText(messages: Message[]): string {
  const latestUser = findLatestUserMessage(messages);
  const latestUserPreview = latestUser
    ? typeof latestUser.content === "string"
      ? latestUser.content.trim()
      : ""
    : "";
  if (latestUserPreview.length > 0) {
    return truncateIslandText(latestUserPreview, 52);
  }

  return DEFAULT_SUMMARY;
}

function deriveLastReplyText(messages: Message[]): string {
  const latestAssistant = findLatestAssistantMessage(messages);
  const preview = messagePreview(latestAssistant);
  return preview ? truncateIslandText(preview, 220) : DEFAULT_LAST_REPLY;
}

function deriveRecentMessages(messages: Message[]): IslandRecentMessage[] {
  const recent: IslandRecentMessage[] = [];
  for (let i = messages.length - 1; i >= 0 && recent.length < ISLAND_TRANSCRIPT_MAX_MESSAGES; i -= 1) {
    const msg = messages[i];
    if (msg.role === "system") continue;
    const preview =
      msg.role === "assistant"
        ? messagePreview(msg)
        : typeof msg.content === "string"
          ? msg.content.trim()
          : null;
    if (!preview) continue;
    recent.unshift({
      role: msg.role as "user" | "assistant",
      content: preview,
      createdAt: msg.createdAt,
    });
  }
  return recent;
}

function deriveStatusLabel(
  snapshot: IslandChatSnapshotLike,
  pendingApproval: IslandApproval | null
): string {
  if (pendingApproval) return "Pending approval";
  if (snapshot.errorMessage) return "Needs attention";
  if (snapshot.globalLoading || snapshot.isLoading) return "Working...";

  const latestAssistant = findLatestAssistantMessage(snapshot.messages);
  const activity = deriveAssistantActivityState(latestAssistant?.blocks);

  if (activity.statusCode === "approval.required") return "Pending approval";
  if (activity.isActive) return "Working...";
  if (snapshot.statusCode) return "Working...";
  if (snapshot.messages.length > 0) return "Ready";
  return "Idle";
}

export function buildIslandWindowDerivedState(
  snapshot: IslandChatSnapshotLike
): IslandWindowDerivedState {
  const latestAssistant = findLatestAssistantMessage(snapshot.messages);
  const pendingApproval = derivePendingApproval(snapshot.messages);

  return {
    statusLabel: deriveStatusLabel(snapshot, pendingApproval),
    summaryText: deriveSummaryText(snapshot.messages),
    lastReplyText: deriveLastReplyText(snapshot.messages),
    lastReplyAt: latestAssistant?.createdAt ?? null,
    recentMessages: deriveRecentMessages(snapshot.messages),
    pendingApproval,
    errorMessage: snapshot.errorMessage,
  };
}
