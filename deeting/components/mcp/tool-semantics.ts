import type { MCPToolIndexStatus, MCPToolStatus } from "@/types/mcp"

type McpUiToolLike = {
  desiredEnabled?: boolean
  desired_enabled?: boolean
  enabled?: boolean
  runtimeReady?: boolean
  runtime_ready?: boolean
  runtimeStatusReason?: string | null
  runtime_status_reason?: string | null
  recommendedAction?: string | null
  recommended_action?: string | null
  installRequired?: boolean
  install_required?: boolean
  indexStatus?: MCPToolIndexStatus
  index_status?: MCPToolIndexStatus
  status?: MCPToolStatus
}

export type McpUiToggleMode = "runtime" | "desired"
export type McpUiPlatform = "desktop" | "cloud"
export type McpRuntimeHintKey = "disabled" | "startRequired" | "waiting" | "review"
type McpSharedActionIntent = "blocked_install" | "blocked_runtime" | "review"
export type McpPrimaryActionIntent =
  | "blocked_install"
  | "blocked_runtime"
  | "review"
  | "sync_server"
  | "enable_server"
  | "toggle_tool"
export type McpToggleActionIntent =
  | "toggle_remote_tool"
  | "stop_tool"
  | "blocked_install"
  | "blocked_runtime"
  | "review"
  | "enable_skill"
  | "start_tool"

const ACTION_LABEL_KEYS = {
  enable_skill: "actions.enableSkill",
  enable_server: "actions.enable",
  review: "actions.review",
  start_tool: "actions.start",
  sync_server: "actions.sync",
} as const

const getRecommendedAction = (tool: McpUiToolLike) => tool.recommendedAction ?? tool.recommended_action ?? undefined

const getRuntimeStatusReason = (tool: McpUiToolLike) => tool.runtimeStatusReason ?? tool.runtime_status_reason ?? undefined

const getInstallRequired = (tool: McpUiToolLike) => tool.installRequired ?? tool.install_required ?? false

const getIndexStatus = (tool: McpUiToolLike) => tool.indexStatus ?? tool.index_status

const shouldAllowDesktopRecoveryStart = (tool: McpUiToolLike) =>
  tool.status === "error" || tool.status === "crashed"

const getSharedActionIntent = (tool: McpUiToolLike): McpSharedActionIntent | null => {
  if (getInstallRequired(tool)) {
    return "blocked_install"
  }

  const action = getRecommendedAction(tool)

  if (action === "wait_for_runtime") {
    return "blocked_runtime"
  }

  if (action === "review") {
    return "review"
  }

  return null
}

export const getMcpDesiredEnabled = (tool: McpUiToolLike) => tool.desiredEnabled ?? tool.desired_enabled ?? tool.enabled ?? false

export const isMcpRuntimeTransitioning = (tool: McpUiToolLike) => tool.status === "starting" || tool.status === "updating"

export const isMcpRuntimeLive = (tool: McpUiToolLike) => {
  const runtimeReady = tool.runtimeReady ?? tool.runtime_ready
  if (runtimeReady !== undefined) {
    return runtimeReady
  }
  return tool.status === "healthy" || tool.status === "degraded"
}

export const getMcpPrimaryActionLabelKey = (tool: McpUiToolLike) => {
  if (getInstallRequired(tool)) {
    return null
  }
  const action = getRecommendedAction(tool)
  if (!action) {
    return null
  }
  return ACTION_LABEL_KEYS[action as keyof typeof ACTION_LABEL_KEYS] ?? null
}

export const getMcpPrimaryActionIntent = (
  tool: McpUiToolLike,
  platform: McpUiPlatform
): McpPrimaryActionIntent => {
  const sharedIntent = getSharedActionIntent(tool)
  if (sharedIntent) {
    return sharedIntent
  }

  const action = getRecommendedAction(tool)

  if (platform === "cloud") {
    if (action === "sync_server") {
      return "sync_server"
    }
    return "enable_server"
  }

  return "toggle_tool"
}

export const getMcpToggleActionIntent = (
  tool: McpUiToolLike,
  enabled: boolean,
  platform: McpUiPlatform
): McpToggleActionIntent => {
  if (platform === "cloud") {
    return "toggle_remote_tool"
  }

  if (!enabled) {
    return "stop_tool"
  }

  if (platform === "desktop" && shouldAllowDesktopRecoveryStart(tool)) {
    return "start_tool"
  }

  const sharedIntent = getSharedActionIntent(tool)
  if (sharedIntent) {
    return sharedIntent
  }

  if (getRecommendedAction(tool) === "enable_skill") {
    return "enable_skill"
  }

  return "start_tool"
}

export const getMcpRuntimeHintKey = (tool: McpUiToolLike): McpRuntimeHintKey | null => {
  const desiredEnabled = getMcpDesiredEnabled(tool)
  const action = getRecommendedAction(tool)
  const runtimeStatusReason = getRuntimeStatusReason(tool)

  if (!desiredEnabled || action === "enable_skill" || action === "enable_server") {
    return "disabled"
  }
  if (action === "start_tool") {
    return "startRequired"
  }
  if (action === "wait_for_runtime" || runtimeStatusReason === "server_disabled") {
    return "waiting"
  }
  if (action === "review") {
    return "review"
  }
  return null
}

export const getMcpRuntimeLabelKey = (tool: McpUiToolLike) => {
  const runtimeHintKey = getMcpRuntimeHintKey(tool)
  if (runtimeHintKey) {
    return `tool.runtime.${runtimeHintKey}`
  }
  if (isMcpRuntimeLive(tool)) {
    return "server.edit.tools.runtimeReady"
  }
  return "tool.status.stopped"
}

export const getMcpIndexLabelKey = (tool: McpUiToolLike) => {
  const indexStatus = getIndexStatus(tool)
  if (indexStatus === "missing") {
    return "tool.runtime.indexMissing"
  }
  if (indexStatus === "indexed") {
    return "server.edit.tools.indexIndexed"
  }
  return "server.edit.tools.indexUnknown"
}

export const isMcpIndexMissing = (tool: McpUiToolLike) => getIndexStatus(tool) === "missing"

export const isMcpToolSwitchChecked = (tool: McpUiToolLike, mode: McpUiToggleMode) => {
  const desiredEnabled = tool.desiredEnabled ?? tool.desired_enabled ?? tool.enabled
  if (mode === "desired") {
    return desiredEnabled ?? (isMcpRuntimeLive(tool) || tool.status === "starting")
  }
  if (desiredEnabled === false) {
    return false
  }
  return isMcpRuntimeLive(tool) || tool.status === "starting"
}

export const isMcpToolSwitchDisabled = (tool: McpUiToolLike, mode: McpUiToggleMode) => {
  if (tool.status === "updating") {
    return true
  }
  if (getInstallRequired(tool)) {
    return true
  }
  return mode === "runtime" && getRecommendedAction(tool) === "wait_for_runtime"
}
