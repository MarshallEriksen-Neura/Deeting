import type { NotificationItem } from "@/components/notifications/notification-center"

type McpRegistryNotification = Pick<NotificationItem, "type" | "title" | "description"> & {
  timestamp: number
}

type McpRegistryNotificationKind =
  | "blocked_install"
  | "blocked_runtime"
  | "delete_success"
  | "desktop_only"
  | "enable_skill_missing_id"
  | "enable_skill_success"
  | "invalid_config"
  | "missing_server"
  | "no_remote_servers"
  | "review"
  | "sync_success"
  | "toggle_unsupported"
  | "update_success"

type McpRegistryCountNotificationKind = "import_failed" | "import_success"
type McpRegistryErrorKind = "delete" | "enable_skill" | "load" | "save" | "start" | "stop" | "sync" | "update"
type McpTranslate = (key: string, values?: Record<string, string | number>) => string

const createNotification = (
  type: NotificationItem["type"],
  title: string,
  description = ""
): McpRegistryNotification => ({
  type,
  title,
  description,
  timestamp: Date.now(),
})

export const getMcpRegistryNotification = (
  t: McpTranslate,
  kind: McpRegistryNotificationKind
): McpRegistryNotification => {
  switch (kind) {
    case "blocked_install":
      return createNotification("warning", t("toast.actionUnavailable"), t("toast.installRequired"))
    case "blocked_runtime":
      return createNotification("warning", t("toast.runtimeBusy"), t("toast.runtimeBusyDesc"))
    case "delete_success":
      return createNotification("success", t("toast.deleteSuccess"))
    case "desktop_only":
      return createNotification("warning", t("toast.desktopOnly"), t("toast.desktopOnly"))
    case "enable_skill_missing_id":
      return createNotification("error", t("toast.enableSkillFailed"), t("toast.enableSkillMissingId"))
    case "enable_skill_success":
      return createNotification("success", t("toast.enableSkillSuccess"), t("toast.enableSkillSuccessDesc"))
    case "invalid_config":
      return createNotification("warning", t("toast.invalidConfig"), t("addServer.errors.invalidConfig"))
    case "missing_server":
      return createNotification("error", t("toast.missingServer"))
    case "no_remote_servers":
      return createNotification("warning", t("toast.syncFailed"), t("toast.noRemoteServers"))
    case "review":
      return createNotification("warning", t("toast.actionUnavailable"), t("tool.runtime.review"))
    case "sync_success":
      return createNotification("success", t("toast.syncSuccess"), t("toast.syncSuccessDesc"))
    case "toggle_unsupported":
      return createNotification("warning", t("toast.toggleUnsupported"))
    case "update_success":
      return createNotification("success", t("toast.updateSuccess"))
  }
}

export const getMcpRegistryCountNotification = (
  t: McpTranslate,
  kind: McpRegistryCountNotificationKind,
  count: number
): McpRegistryNotification => {
  switch (kind) {
    case "import_failed":
      return createNotification("warning", t("toast.saveFailed"), t("toast.importFailed", { count }))
    case "import_success":
      return createNotification("success", t("toast.saveSuccess"), t("toast.importSummary", { count }))
  }
}

export const getMcpRegistryErrorNotification = (
  t: McpTranslate,
  kind: McpRegistryErrorKind,
  error: unknown,
  type: NotificationItem["type"] = "error"
): McpRegistryNotification => {
  const titleKeyByKind: Record<McpRegistryErrorKind, string> = {
    delete: "toast.deleteFailed",
    enable_skill: "toast.enableSkillFailed",
    load: "toast.loadFailed",
    save: "toast.saveFailed",
    start: "toast.startFailed",
    stop: "toast.stopFailed",
    sync: "toast.syncFailed",
    update: "toast.updateFailed",
  }

  return createNotification(type, t(titleKeyByKind[kind]), String(error))
}