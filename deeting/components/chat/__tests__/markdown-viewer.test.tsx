import React from "react"
import { render, screen } from "@testing-library/react"
import { MarkdownViewer } from "@/components/chat/markdown-viewer"

jest.mock("@/hooks/use-i18n", () => ({
  useI18n: () => (key: string) => key,
}))

jest.mock("@/components/chat/sandpack-fence-preview", () => ({
  SandpackFencePreview: ({
    language,
    source,
  }: {
    language?: string
    source: string
  }) => <div data-testid="sandpack-preview">{`${language}:${source}`}</div>,
  supportsSandpackFence: (language?: string, source?: string) => {
    const normalizedLanguage = language?.trim().toLowerCase()
    const trimmedSource = source?.trim() ?? ""
    return (
      normalizedLanguage === "html" ||
      (normalizedLanguage === "svg" && trimmedSource.includes("<svg"))
    )
  },
}))

jest.mock("@/components/chat/runnable-code-fence", () => ({
  RunnableCodeFence: ({
    language,
    source,
  }: {
    language?: string
    source: string
  }) => <div data-testid="runnable-code-fence">{`${language}:${source}`}</div>,
  supportsRunnableFence: (language?: string, source?: string) => {
    const normalizedLanguage = language?.trim().toLowerCase()
    const trimmedSource = source?.trim() ?? ""
    return (
      ["python", "go", "rust", "java"].includes(normalizedLanguage ?? "") &&
      trimmedSource.length > 0
    )
  },
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
    const CodeRenderer = (props: {
      className?: string
      children?: React.ReactNode
    }) => components.code(props)
    const codeElement = <CodeRenderer className={`language-${language}`}>{code}</CodeRenderer>

    return components.pre({ children: codeElement })
  },
}))

describe("MarkdownViewer", () => {
  it("renders a Sandpack preview for assistant fenced html blocks", () => {
    render(
      <MarkdownViewer
        content={["```html", "<div>plain html block</div>", "```"].join("\n")}
        className="chat-markdown chat-markdown-assistant"
      />
    )

    expect(screen.getByTestId("sandpack-preview")).toHaveTextContent(
      "html:<div>plain html block</div>"
    )
  })

  it("renders a Sandpack preview for assistant fenced svg blocks", () => {
    render(
      <MarkdownViewer
        content={[
          "```svg",
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">',
          '  <circle cx="5" cy="5" r="4" fill="#2563eb" />',
          "</svg>",
          "```",
        ].join("\n")}
        className="chat-markdown chat-markdown-assistant"
      />
    )

    expect(screen.getByTestId("sandpack-preview")).toHaveTextContent("svg:")
  })

  it("does not render a Sandpack preview for user fenced html blocks", () => {
    render(
      <MarkdownViewer
        content={["```html", "<div>plain html block</div>", "```"].join("\n")}
        className="chat-markdown chat-markdown-user"
      />
    )

    expect(screen.queryByTestId("sandpack-preview")).not.toBeInTheDocument()
    expect(screen.getByText("html")).toBeInTheDocument()
  })

  it("does not render a Sandpack preview for unsupported fenced code blocks", () => {
    render(
      <MarkdownViewer
        content={["```python", "print('hi')", "```"].join("\n")}
        className="chat-markdown chat-markdown-assistant"
      />
    )

    expect(screen.queryByTestId("sandpack-preview")).not.toBeInTheDocument()
    expect(screen.getByText("python")).toBeInTheDocument()
  })

  it("renders a runnable fence for supported assistant code blocks when enabled", () => {
    render(
      <MarkdownViewer
        content={["```python", "print('hi')", "```"].join("\n")}
        className="chat-markdown chat-markdown-assistant"
        messageId="assistant-1"
        enableRunnableFences
      />
    )

    expect(screen.getByTestId("runnable-code-fence")).toHaveTextContent(
      "python:print('hi')"
    )
  })
})
