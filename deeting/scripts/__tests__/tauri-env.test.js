/** @jest-environment node */

const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const originalApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL
const originalTauriFlag = process.env.NEXT_PUBLIC_IS_TAURI
const originalProtoc = process.env.PROTOC

describe("tauri env helpers", () => {
  afterEach(() => {
    if (originalApiBaseUrl === undefined) {
      delete process.env.NEXT_PUBLIC_API_BASE_URL
    } else {
      process.env.NEXT_PUBLIC_API_BASE_URL = originalApiBaseUrl
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

  it("loads NEXT_PUBLIC_API_BASE_URL from the desktop .env file", async () => {
    delete process.env.NEXT_PUBLIC_API_BASE_URL

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tauri-env-"))
    fs.writeFileSync(
      path.join(tempRoot, ".env"),
      "NEXT_PUBLIC_API_BASE_URL=http://192.168.199.128:8000\n",
      "utf8"
    )

    const { loadDesktopEnv } = require("../tauri-env.cjs")

    loadDesktopEnv(tempRoot, { dev: true, forceReload: true })

    expect(process.env.NEXT_PUBLIC_API_BASE_URL).toBe("http://192.168.199.128:8000")
  })

  it("builds the tauri child env while preserving loaded values", () => {
    const { buildTauriEnv } = require("../tauri-env.cjs")

    const tauriEnv = buildTauriEnv(
      {
        NEXT_PUBLIC_API_BASE_URL: "https://api.example.com",
        CUSTOM_FLAG: "enabled",
      },
      "/tmp/protoc"
    )

    expect(tauriEnv).toMatchObject({
      NEXT_PUBLIC_API_BASE_URL: "https://api.example.com",
      NEXT_PUBLIC_IS_TAURI: "true",
      PROTOC: "/tmp/protoc",
      CUSTOM_FLAG: "enabled",
    })
  })
})
