import { getMcpPrimaryActionIntent, getMcpToggleActionIntent } from "@/components/mcp/tool-semantics"

describe("tool semantics primary action intent", () => {
  it("blocks install-required tools before checking platform behavior", () => {
    expect(getMcpPrimaryActionIntent({ installRequired: true }, "desktop")).toBe("blocked_install")
    expect(getMcpPrimaryActionIntent({ install_required: true }, "cloud")).toBe("blocked_install")
  })

  it("blocks wait-for-runtime actions before dispatch", () => {
    expect(getMcpPrimaryActionIntent({ recommendedAction: "wait_for_runtime" }, "desktop")).toBe("blocked_runtime")
  })

  it("routes desktop review separately and otherwise falls back to tool toggles", () => {
    expect(getMcpPrimaryActionIntent({ recommendedAction: "review" }, "desktop")).toBe("review")
    expect(getMcpPrimaryActionIntent({ recommendedAction: "enable_skill" }, "desktop")).toBe("toggle_tool")
  })

  it("routes cloud review and sync explicitly", () => {
    expect(getMcpPrimaryActionIntent({ recommendedAction: "review" }, "cloud")).toBe("review")
    expect(getMcpPrimaryActionIntent({ recommendedAction: "sync_server" }, "cloud")).toBe("sync_server")
  })

  it("falls back to enable_server for cloud primary actions", () => {
    expect(getMcpPrimaryActionIntent({ recommendedAction: "enable_server" }, "cloud")).toBe("enable_server")
    expect(getMcpPrimaryActionIntent({}, "cloud")).toBe("enable_server")
  })
})

describe("tool semantics toggle action intent", () => {
  it("routes cloud toggles through remote tool updates", () => {
    expect(getMcpToggleActionIntent({}, true, "cloud")).toBe("toggle_remote_tool")
    expect(getMcpToggleActionIntent({}, false, "cloud")).toBe("toggle_remote_tool")
  })

  it("routes desktop disable actions to stop_tool", () => {
    expect(getMcpToggleActionIntent({}, false, "desktop")).toBe("stop_tool")
  })

  it("reuses desktop blocking intents before start", () => {
    expect(getMcpToggleActionIntent({ installRequired: true }, true, "desktop")).toBe("blocked_install")
    expect(getMcpToggleActionIntent({ recommendedAction: "wait_for_runtime" }, true, "desktop")).toBe("blocked_runtime")
  })

  it("routes desktop review and enable_skill explicitly", () => {
    expect(getMcpToggleActionIntent({ recommendedAction: "review" }, true, "desktop")).toBe("review")
    expect(getMcpToggleActionIntent({ recommendedAction: "enable_skill" }, true, "desktop")).toBe("enable_skill")
  })

  it("falls back to start_tool for desktop enable flows", () => {
    expect(getMcpToggleActionIntent({ recommendedAction: "start_tool" }, true, "desktop")).toBe("start_tool")
    expect(getMcpToggleActionIntent({}, true, "desktop")).toBe("start_tool")
  })
})