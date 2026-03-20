/** @jest-environment node */

const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const {
  readDesktopDefaultLocale,
  mirrorDefaultLocaleExport,
  postprocessDesktopExport,
} = require("../desktop-export-postprocess.cjs")

describe("desktop export postprocess", () => {
  it("reads the default locale from routing.ts", () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-export-routing-"))
    const i18nDir = path.join(projectRoot, "i18n")

    fs.mkdirSync(i18nDir, { recursive: true })
    fs.writeFileSync(
      path.join(i18nDir, "routing.ts"),
      'export const routing = { defaultLocale: "zh-CN" }\n',
      "utf8"
    )

    expect(readDesktopDefaultLocale(projectRoot)).toBe("zh-CN")
  })

  it("mirrors missing default-locale files into unprefixed output paths", () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-export-out-"))

    fs.mkdirSync(path.join(outDir, "zh-CN", "dashboard"), { recursive: true })
    fs.mkdirSync(path.join(outDir, "en"), { recursive: true })
    fs.writeFileSync(path.join(outDir, "zh-CN", "index.html"), "home", "utf8")
    fs.writeFileSync(
      path.join(outDir, "zh-CN", "dashboard", "index.html"),
      "dashboard",
      "utf8"
    )
    fs.writeFileSync(path.join(outDir, "en", "index.html"), "english", "utf8")

    const copiedPaths = mirrorDefaultLocaleExport(outDir, "zh-CN")

    expect(copiedPaths.sort()).toEqual(["dashboard/index.html", "index.html"])
    expect(fs.readFileSync(path.join(outDir, "index.html"), "utf8")).toBe("home")
    expect(
      fs.readFileSync(path.join(outDir, "dashboard", "index.html"), "utf8")
    ).toBe("dashboard")
    expect(fs.existsSync(path.join(outDir, "market", "index.html"))).toBe(false)
  })

  it("does not overwrite explicit root output and also supports zh-CN.html exports", () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-export-root-"))

    fs.mkdirSync(path.join(outDir, "zh-CN", "settings"), { recursive: true })
    fs.mkdirSync(path.join(outDir, "settings"), { recursive: true })
    fs.writeFileSync(path.join(outDir, "index.html"), "existing-root", "utf8")
    fs.writeFileSync(path.join(outDir, "zh-CN.html"), "locale-root", "utf8")
    fs.writeFileSync(
      path.join(outDir, "zh-CN", "settings", "index.html"),
      "locale-settings",
      "utf8"
    )
    fs.writeFileSync(path.join(outDir, "settings", "index.html"), "existing-settings", "utf8")

    const copiedPaths = mirrorDefaultLocaleExport(outDir, "zh-CN")

    expect(copiedPaths).toEqual([])
    expect(fs.readFileSync(path.join(outDir, "index.html"), "utf8")).toBe("existing-root")
    expect(fs.readFileSync(path.join(outDir, "settings", "index.html"), "utf8")).toBe(
      "existing-settings"
    )
  })

  it("maps a root locale html export into index.html when needed", () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-export-html-"))

    fs.writeFileSync(path.join(outDir, "zh-CN.html"), "locale-root", "utf8")

    const copiedPaths = mirrorDefaultLocaleExport(outDir, "zh-CN")

    expect(copiedPaths).toEqual(["index.html"])
    expect(fs.readFileSync(path.join(outDir, "index.html"), "utf8")).toBe("locale-root")
  })

  it("postprocesses the built desktop export using the configured default locale", () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-export-project-"))
    const i18nDir = path.join(projectRoot, "i18n")
    const outDir = path.join(projectRoot, "out")

    fs.mkdirSync(path.join(i18nDir), { recursive: true })
    fs.mkdirSync(path.join(outDir, "zh-CN"), { recursive: true })
    fs.writeFileSync(
      path.join(i18nDir, "routing.ts"),
      'export const routing = { defaultLocale: "zh-CN" }\n',
      "utf8"
    )
    fs.writeFileSync(path.join(outDir, "zh-CN", "index.html"), "desktop-home", "utf8")

    const result = postprocessDesktopExport(projectRoot)

    expect(result).toEqual({
      defaultLocale: "zh-CN",
      copiedPaths: ["index.html"],
    })
    expect(fs.readFileSync(path.join(outDir, "index.html"), "utf8")).toBe("desktop-home")
  })
})
