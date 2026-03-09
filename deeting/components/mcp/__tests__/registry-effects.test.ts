import { appendMcpRegistryLogEntry } from "@/components/mcp/registry-effects"

describe("registry effects", () => {
  it("appends log entries below the cap", () => {
    const existing = [{ timestamp: "1", stream: "stdout" as const, message: "a" }]
    const next = { timestamp: "2", stream: "stderr" as const, message: "b" }

    expect(appendMcpRegistryLogEntry(existing, next, 3)).toEqual([
      { timestamp: "1", stream: "stdout", message: "a" },
      { timestamp: "2", stream: "stderr", message: "b" },
    ])
  })

  it("drops the oldest entry when the cap is reached", () => {
    const existing = [
      { timestamp: "1", stream: "stdout" as const, message: "a" },
      { timestamp: "2", stream: "stdout" as const, message: "b" },
    ]
    const next = { timestamp: "3", stream: "event" as const, message: "c" }

    expect(appendMcpRegistryLogEntry(existing, next, 2)).toEqual([
      { timestamp: "2", stream: "stdout", message: "b" },
      { timestamp: "3", stream: "event", message: "c" },
    ])
  })
})