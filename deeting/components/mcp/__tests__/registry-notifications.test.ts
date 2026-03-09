import {
  getMcpRegistryCountNotification,
  getMcpRegistryErrorNotification,
  getMcpRegistryNotification,
} from "@/components/mcp/registry-notifications"

const t = (key: string) => key

describe("registry notifications", () => {
  it("maps blocked action notifications to the expected toast keys", () => {
    expect(getMcpRegistryNotification(t, "blocked_install")).toMatchObject({
      type: "warning",
      title: "toast.actionUnavailable",
      description: "toast.installRequired",
    })

    expect(getMcpRegistryNotification(t, "blocked_runtime")).toMatchObject({
      type: "warning",
      title: "toast.runtimeBusy",
      description: "toast.runtimeBusyDesc",
    })
  })

  it("maps shared success and warning notifications", () => {
    expect(getMcpRegistryNotification(t, "desktop_only")).toMatchObject({
      type: "warning",
      title: "toast.desktopOnly",
      description: "toast.desktopOnly",
    })

    expect(getMcpRegistryNotification(t, "enable_skill_success")).toMatchObject({
      type: "success",
      title: "toast.enableSkillSuccess",
      description: "toast.enableSkillSuccessDesc",
    })

    expect(getMcpRegistryNotification(t, "invalid_config")).toMatchObject({
      type: "warning",
      title: "toast.invalidConfig",
      description: "addServer.errors.invalidConfig",
    })
  })

  it("maps count-based import notifications", () => {
    expect(getMcpRegistryCountNotification(t, "import_success", 2)).toMatchObject({
      type: "success",
      title: "toast.saveSuccess",
      description: "toast.importSummary",
    })

    expect(getMcpRegistryCountNotification(t, "import_failed", 1)).toMatchObject({
      type: "warning",
      title: "toast.saveFailed",
      description: "toast.importFailed",
    })
  })

  it("maps missing server and toggle support notifications", () => {
    expect(getMcpRegistryNotification(t, "missing_server")).toMatchObject({
      type: "error",
      title: "toast.missingServer",
      description: "",
    })

    expect(getMcpRegistryNotification(t, "toggle_unsupported")).toMatchObject({
      type: "warning",
      title: "toast.toggleUnsupported",
      description: "",
    })
  })

  it("maps error notifications to the expected failure title", () => {
    expect(getMcpRegistryErrorNotification(t, "start", new Error("boom"))).toMatchObject({
      type: "error",
      title: "toast.startFailed",
      description: "Error: boom",
    })

    expect(getMcpRegistryErrorNotification(t, "update", "bad update")).toMatchObject({
      type: "error",
      title: "toast.updateFailed",
      description: "bad update",
    })

    expect(getMcpRegistryErrorNotification(t, "load", "warn load", "warning")).toMatchObject({
      type: "warning",
      title: "toast.loadFailed",
      description: "warn load",
    })
  })
})