import { runScanReviewAction, runScanReviewActions, scanDirectoryReview, scanFileReview } from "@/lib/api/local-scan"
import { invoke } from "@tauri-apps/api/core"

jest.mock("@tauri-apps/api/core", () => ({
  invoke: jest.fn(),
}))

const mockInvoke = invoke as jest.MockedFunction<typeof invoke>
const originalTauriFlag = process.env.NEXT_PUBLIC_IS_TAURI
const windowWithTauri = window as Window & {
  __TAURI__?: unknown
  __TAURI_INTERNALS__?: unknown
}

const mockRun = {
  run_id: "run-1",
  trigger: "manual",
  target_kind: "directory",
  target_path: "/tmp/skills",
  started_at: "2026-03-11T00:00:00Z",
  finished_at: "2026-03-11T00:00:01Z",
  summary: {
    document_count: 1,
    finding_count: 2,
    warning_count: 2,
    error_count: 0,
    skill_bundle_count: 1,
    index_missing_count: 1,
    install_missing_count: 1,
    security_warning_count: 2,
    high_risk_script_count: 1,
    missing_skill_doc_count: 0,
  },
  documents: [],
  findings: [],
}

describe("local scan api", () => {
  afterEach(() => {
    mockInvoke.mockReset()
    process.env.NEXT_PUBLIC_IS_TAURI = originalTauriFlag
    delete windowWithTauri.__TAURI__
    delete windowWithTauri.__TAURI_INTERNALS__
  })

  it("invokes scan_directory in tauri runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue(mockRun as unknown)

    const result = await scanDirectoryReview({ path: "/tmp/skills" })

    expect(result?.summary.skill_bundle_count).toBe(1)
    expect(mockInvoke).toHaveBeenCalledWith("scan_directory", {
      path: "/tmp/skills",
    })
  })

  it("invokes scan_file in tauri runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue({
      ...mockRun,
      target_kind: "file",
      target_path: "/tmp/skills/SKILL.md",
    } as unknown)

    const result = await scanFileReview(" /tmp/skills/SKILL.md ")

    expect(result?.target_kind).toBe("file")
    expect(mockInvoke).toHaveBeenCalledWith("scan_file", {
      path: "/tmp/skills/SKILL.md",
    })
  })

  it("invokes run_scan_review_action in tauri runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue({
      kind: "reindex_bundle",
      status: "applied",
      message: "Rebuilt local asset index for demo.skill",
      bundle_id: "demo.skill",
      path: "/tmp/skills/demo-skill",
    } as unknown)

    const result = await runScanReviewAction({
      kind: "reindex_bundle",
      bundle_id: "demo.skill",
      path: "/tmp/skills/demo-skill",
      destructive: false,
    })

    expect(result?.status).toBe("applied")
    expect(mockInvoke).toHaveBeenCalledWith("run_scan_review_action", {
      request: {
        kind: "reindex_bundle",
        bundle_id: "demo.skill",
        path: "/tmp/skills/demo-skill",
      },
    })
  })

  it("normalizes tauri invoke errors for scan review actions", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockRejectedValue({ message: "Embedding request failed: 400 Bad Request" } as unknown)

    await expect(
      runScanReviewAction({
        kind: "reindex_bundle",
        bundle_id: "demo.skill",
        path: "/tmp/skills/demo-skill",
        destructive: false,
      })
    ).rejects.toThrow("Embedding request failed: 400 Bad Request")
  })

  it("invokes run_scan_review_actions in tauri runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue({ total: 2, applied: 1, failed: 0, skipped: 1, results: [] } as unknown)

    const result = await runScanReviewActions([
      { kind: "register_bundle", bundle_id: "demo.skill", path: "/tmp/skills/demo-skill", destructive: false },
      { kind: "register_bundle", bundle_id: "demo.skill", path: "/tmp/skills/demo-skill", destructive: false },
    ])

    expect(result?.skipped).toBe(1)
    expect(mockInvoke).toHaveBeenCalledWith("run_scan_review_actions", {
      request: {
        actions: [
          { kind: "register_bundle", bundle_id: "demo.skill", path: "/tmp/skills/demo-skill" },
          { kind: "register_bundle", bundle_id: "demo.skill", path: "/tmp/skills/demo-skill" },
        ],
      },
    })
  })
})
