"use client"

import { invoke } from "@tauri-apps/api/core"

export interface ToolApprovalRule {
  key: string
  action: "allow_once" | "allow_always" | "deny_always"
  tool_name: string
  tool_fingerprint: string
  risk_level?: string | null
  auto_promoted: boolean
  created_at_unix_ms: number
  updated_at_unix_ms: number
  expires_at_unix_ms?: number | null
  approve_count: number
  reject_count: number
  last_approved_at_unix_ms?: number | null
  last_rejected_at_unix_ms?: number | null
  half_life_days: number
  operation_class: string
  target_class: string
  boundary_class: string
  display_label: string
}

export interface ToolApprovalLearningSummaryRow {
  operation_class: string
  target_class: string
  boundary_class: string
  observed_approvals: number
  observed_rejections: number
  auto_promoted_rules: number
  explicit_allow_rules: number
  explicit_deny_rules: number
  last_approved_at_unix_ms?: number | null
  last_rejected_at_unix_ms?: number | null
}

function ensureDesktopRuntime() {
  if (
    typeof window === "undefined" ||
    process.env.NEXT_PUBLIC_IS_TAURI !== "true" ||
    !("__TAURI__" in window || "__TAURI_INTERNALS__" in window)
  ) {
    throw new Error("Approval rules are only available in desktop runtime")
  }
}

export async function listToolApprovalRules(): Promise<ToolApprovalRule[]> {
  ensureDesktopRuntime()
  return invoke<ToolApprovalRule[]>("list_tool_approval_rules")
}

export async function deleteToolApprovalRule(key: string): Promise<boolean> {
  ensureDesktopRuntime()
  return invoke<boolean>("delete_tool_approval_rule", { key })
}

export async function clearToolApprovalRules(
  mode?: "allow" | "all"
): Promise<number> {
  ensureDesktopRuntime()
  return invoke<number>("clear_tool_approval_rules", { mode })
}

export async function resetToolApprovalLearning(): Promise<number> {
  ensureDesktopRuntime()
  return invoke<number>("reset_tool_approval_learning")
}

export async function getToolApprovalLearningSummary(): Promise<
  ToolApprovalLearningSummaryRow[]
> {
  ensureDesktopRuntime()
  return invoke<ToolApprovalLearningSummaryRow[]>(
    "get_tool_approval_learning_summary"
  )
}
