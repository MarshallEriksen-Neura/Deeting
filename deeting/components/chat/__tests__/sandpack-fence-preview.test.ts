jest.mock("@codesandbox/sandpack-react", () => ({
  SandpackLayout: ({ children }: { children: React.ReactNode }) => children,
  SandpackPreview: () => null,
  SandpackProvider: ({ children }: { children: React.ReactNode }) => children,
}))

jest.mock("@/components/chat/code-block", () => ({
  CodeBlock: () => null,
}))

import { supportsSandpackFence } from "@/components/chat/sandpack-fence-preview"

function buildLargeHtmlDocument(lines: number): string {
  const body = Array.from({ length: lines }, (_, index) => `<section>row-${index}</section>`).join("\n")
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Large Preview</title>
  </head>
  <body>
${body}
  </body>
</html>`
}

function buildLargeTsxComponent(lines: number): string {
  const body = Array.from({ length: lines }, (_, index) => `      <li key={${index}}>row-${index}</li>`).join("\n")
  return `export default function HugeList() {
  return (
    <main>
      <ul>
${body}
      </ul>
    </main>
  )
}`
}

describe("supportsSandpackFence", () => {
  it("keeps static html preview enabled for large assistant documents", () => {
    const largeHtml = buildLargeHtmlDocument(700)
    expect(supportsSandpackFence("html", largeHtml)).toBe(true)
  })

  it("still skips oversized reactive sandpack previews", () => {
    const largeTsx = buildLargeTsxComponent(700)
    expect(supportsSandpackFence("tsx", largeTsx)).toBe(false)
  })
})
