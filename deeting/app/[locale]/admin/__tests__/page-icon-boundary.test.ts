import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"

const adminRoot = path.join(process.cwd(), "app", "[locale]", "admin")

function collectPageFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      return collectPageFiles(fullPath)
    }

    return entry.isFile() && entry.name === "page.tsx" ? [fullPath] : []
  })
}

describe("admin page icon boundary", () => {
  it("does not pass icon component functions into AdminPageShell", () => {
    const pageFiles = collectPageFiles(adminRoot)
    const pagesUsingFunctionIcons = pageFiles.filter((pageFile) => {
      const source = readFileSync(pageFile, "utf8")

      return source.includes("<AdminPageShell") && /icon=\{[A-Z][A-Za-z0-9_]*\}/.test(source)
    })

    expect(pagesUsingFunctionIcons).toEqual([])
  })
})
