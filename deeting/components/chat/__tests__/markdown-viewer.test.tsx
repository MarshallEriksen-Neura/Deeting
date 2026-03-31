import React from "react"
import { render, screen } from "@testing-library/react"

jest.mock("@/hooks/use-i18n", () => ({
  useI18n: () => (key: string) => key,
}))

jest.mock("remark-gfm", () => ({
  __esModule: true,
  default: () => undefined,
}))

jest.mock("remark-breaks", () => ({
  __esModule: true,
  default: () => undefined,
}))

jest.mock("react-markdown", () => ({
  __esModule: true,
  default: ({
    children,
    components,
  }: {
    children: React.ReactNode
    components: {
      pre: (props: { children: React.ReactNode }) => React.ReactElement
      code: (props: {
        className?: string
        children?: React.ReactNode
      }) => React.ReactElement
    }
  }) => {
    const source = typeof children === "string" ? children : ""
    const fencedMatch = source.match(/^```([^\n]+)\n([\s\S]*?)\n```$/)

    if (!fencedMatch) {
      return <div>{source}</div>
    }

    const [, language, code] = fencedMatch
    const codeElement = components.code({
      className: `language-${language}`,
      children: code,
    })

    return components.pre({ children: codeElement })
  },
}))

const { MarkdownViewer } = require("@/components/chat/markdown-viewer")

describe("MarkdownViewer", () => {
  it("renders a preview for fenced svg code blocks", () => {
    render(
      <MarkdownViewer
        content={[
          "```svg",
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">',
          '  <circle cx="5" cy="5" r="4" fill="#2563eb" />',
          "</svg>",
          "```",
        ].join("\n")}
      />
    )

    const preview = screen.getByAltText("codeBlock.svgPreviewAlt")
    expect(preview).toBeInTheDocument()
    expect(preview).toHaveAttribute("src", expect.stringContaining("data:image/svg+xml"))
    expect(screen.getByText("codeBlock.svgPreview")).toBeInTheDocument()
  })

  it("does not render a preview for non-svg fenced code blocks", () => {
    render(
      <MarkdownViewer
        content={["```html", "<div>plain html block</div>", "```"].join("\n")}
      />
    )

    expect(
      screen.queryByAltText("codeBlock.svgPreviewAlt")
    ).not.toBeInTheDocument()
  })
})
