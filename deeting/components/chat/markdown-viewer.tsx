"use client"

import { isValidElement } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkBreaks from "remark-breaks"
import { cn } from "@/lib/utils"
import { CodeBlock } from "@/components/chat/code-block"
import { CopyablePre, extractTextFromNode } from "@/components/chat/copyable-pre"
import {
  SandpackFencePreview,
  supportsSandpackFence,
} from "@/components/chat/sandpack-fence-preview"
import { RunnableCodeFence, supportsRunnableFence } from "@/components/chat/runnable-code-fence"
import { ImageLightbox } from "@/components/ui/image-lightbox"
import styles from "./markdown-viewer.module.css"

const INLINE_FENCE_REGEX = /```([a-zA-Z0-9_-]+)?\s+([^\n`]+?)```/g
const FENCE_DELIMITER_REGEX = /```/g
const MARKDOWN_MARKER_CLASS_REGEX = /\bchat-markdown(?:-(?:assistant|user))?\b/g

function getFencedCodeProps(
  child: React.ReactNode
): { className?: string; children?: React.ReactNode } | null {
  if (!isValidElement(child)) {
    return null
  }

  const props =
    child.props && typeof child.props === "object"
      ? (child.props as { className?: string; children?: React.ReactNode })
      : null
  if (!props) {
    return null
  }

  const rawCode = extractTextFromNode(props.children)
  if (!rawCode.trim()) {
    return null
  }

  return props
}

function normalizeInlineFences(raw: string) {
  return raw.replace(INLINE_FENCE_REGEX, (_match, lang, code) => {
    const language = typeof lang === "string" && lang.length > 0 ? lang : ""
    const content = typeof code === "string" ? code.trim() : ""
    return `\`\`\`${language}\n${content}\n\`\`\``
  })
}

function normalizeMarkdownContent(raw: string) {
  const normalizedLineBreaks = raw.replace(/\r\n?/g, "\n")
  let normalized = normalizeInlineFences(normalizedLineBreaks)

  // Some upstream payloads store escaped newlines as "\\n", which causes one-line rendering.
  if (!normalized.includes("\n") && normalized.includes("\\n")) {
    normalized = normalized.replace(/\\n/g, "\n")
  }

  const fenceCount = normalized.match(FENCE_DELIMITER_REGEX)?.length ?? 0
  if (fenceCount % 2 !== 0) {
    normalized = `${normalized}\n\`\`\``
  }

  return normalized
}

export function MarkdownViewer({
  content,
  className,
  messageId,
  enableRunnableFences = false,
}: {
  content: string
  className?: string
  messageId?: string
  enableRunnableFences?: boolean
}) {
  const normalizedContent = normalizeMarkdownContent(content)
  const isUser = className?.includes("chat-markdown-user") ?? false
  const isAssistant = className?.includes("chat-markdown-assistant") ?? false
  const normalizedClassName =
    className?.replace(MARKDOWN_MARKER_CLASS_REGEX, " ").trim() || undefined
  let runnableFenceIndex = 0

  return (
    <div
      className={cn(
        styles.markdown,
        isUser ? styles.user : undefined,
        !isUser && isAssistant ? styles.assistant : undefined,
        "break-words",
        normalizedClassName
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4"
            >
              {children}
            </a>
          ),
          code: ({ className: codeClassName, children, ...props }) => {
            const isInline = !codeClassName
            return (
              <code
                className={cn(
                  "font-mono",
                  isInline
                    ? "rounded bg-muted px-1 py-0.5 text-[0.85em]"
                    : "text-[0.85em]",
                  codeClassName
                )}
                {...props}
              >
                {children}
              </code>
            )
          },
          pre: ({ children }) => {
            const child = Array.isArray(children) ? children[0] : children
            const codeProps = getFencedCodeProps(child)
            if (codeProps) {
              const codeClassName = codeProps.className
              const languageMatch = codeClassName?.match(/language-([\w-]+)/)
              const language = languageMatch?.[1]
              const rawCode = extractTextFromNode(codeProps.children)

              if (isAssistant && supportsSandpackFence(language, rawCode)) {
                return (
                  <SandpackFencePreview
                    className={codeClassName}
                    language={language}
                    source={rawCode}
                  />
                )
              }

              if (
                enableRunnableFences &&
                isAssistant &&
                messageId &&
                supportsRunnableFence(language, rawCode)
              ) {
                const fenceId = `runnable-fence-${runnableFenceIndex++}`
                return (
                  <RunnableCodeFence
                    className={codeClassName}
                    language={language}
                    source={rawCode}
                    messageId={messageId}
                    fenceId={fenceId}
                  />
                )
              }

              return (
                <CodeBlock className={codeClassName} language={language}>
                  {codeProps.children}
                </CodeBlock>
              )
            }
            return <CopyablePre>{children}</CopyablePre>
          },
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-border pl-3 text-muted-foreground">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="my-4 overflow-x-auto">
              <table className="w-full border-collapse text-sm">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-border bg-muted px-2 py-1 text-left">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-border px-2 py-1">{children}</td>
          ),
          img: ({ src, alt }) => (
            <div className="my-2 max-w-sm">
              <ImageLightbox
                src={typeof src === "string" ? src : ""}
                alt={alt || ""}
                className="max-w-full max-h-80 rounded-lg border border-border/50"
              />
            </div>
          ),
        }}
      >
        {normalizedContent}
      </ReactMarkdown>
    </div>
  )
}
