"use client"

import { useTheme } from "next-themes"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkBreaks from "remark-breaks"
import rehypePrism from "rehype-prism-plus"
import { cn } from "@/lib/utils"

export function MarkdownViewer({
  content,
  className,
}: {
  content: string
  className?: string
}) {
  const { resolvedTheme } = useTheme()
  const dataTheme = resolvedTheme === "dark" ? "dark" : "light"

  return (
    <div
      data-theme={dataTheme}
      className={cn("markdown-body chat-markdown break-words", className)}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[rehypePrism]}
        components={{
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline underline-offset-4"
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
          pre: ({ children }) => (
            <pre className="mt-3 overflow-auto rounded-lg border border-border bg-muted/60 p-3 text-xs font-mono">
              {children}
            </pre>
          ),
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
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
