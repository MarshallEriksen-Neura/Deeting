/** @jest-environment node */
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const originalLocalFlag = process.env.DEETING_DESKTOP_LOCAL_ONLY
const originalTauriFlag = process.env.NEXT_PUBLIC_IS_TAURI
const originalProtoc = process.env.PROTOC

describe("tauri env helpers", () => {
  afterEach(() => {
    if (originalLocalFlag === undefined) {
      delete process.env.DEETING_DESKTOP_LOCAL_ONLY
    } else {
      process.env.DEETING_DESKTOP_LOCAL_ONLY = originalLocalFlag
    }

    if (originalTauriFlag === undefined) {
      delete process.env.NEXT_PUBLIC_IS_TAURI
    } else {
      process.env.NEXT_PUBLIC_IS_TAURI = originalTauriFlag
    }

    if (originalProtoc === undefined) {
      delete process.env.PROTOC
    } else {
      process.env.PROTOC = originalProtoc
    }
  })

  it("loads local desktop flags from the desktop .env file", async () => {
    delete process.env.DEETING_DESKTOP_LOCAL_ONLY

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tauri-env-"))
    fs.writeFileSync(
      path.join(tempRoot, ".env"),
      "DEETING_DESKTOP_LOCAL_ONLY=true\n",
      "utf8"
    )

    const { loadDesktopEnv } = require("../tauri-env.cjs")

    loadDesktopEnv(tempRoot, { dev: true, forceReload: true })

    expect(process.env.DEETING_DESKTOP_LOCAL_ONLY).toBe("true")
  })

  it("builds the tauri child env while preserving loaded values", () => {
    const { buildTauriEnv } = require("../tauri-env.cjs")

    const tauriEnv = buildTauriEnv(
      {
        CUSTOM_FLAG: "enabled",
      },
      "/tmp/protoc"
    )

    expect(tauriEnv).toMatchObject({
      NEXT_PUBLIC_IS_TAURI: "true",
      PROTOC: "/tmp/protoc",
      CUSTOM_FLAG: "enabled",
    })
  })
})
