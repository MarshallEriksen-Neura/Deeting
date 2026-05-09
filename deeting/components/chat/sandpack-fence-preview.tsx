"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  SandpackLayout,
  SandpackPreview,
  SandpackProvider,
  type SandpackFiles,
  type SandpackPredefinedTemplate,
  type SandpackSetup,
} from "@codesandbox/sandpack-react"
import { CodeBlock } from "@/components/chat/code-block"
import { cn } from "@/lib/utils"
import { Eye, Code2, Columns3, Expand, Shrink } from "lucide-react"

const DEFAULT_MAX_PREVIEW_CHARS = 12000
const DEFAULT_MAX_PREVIEW_LINES = 400
const STATIC_PREVIEW_MAX_PREVIEW_CHARS = 200000
const STATIC_PREVIEW_MAX_PREVIEW_LINES = 4000
const BARE_IMPORT_REGEX =
  /\bimport\s+(?:[\w*\s{},]*?\s+from\s+)?["'](@?[^"'./][^"']*)["']/g
const REQUIRE_REGEX = /\brequire\(\s*["'](@?[^"'./][^"']*)["']\s*\)/g
const DYNAMIC_IMPORT_REGEX = /\bimport\(\s*["'](@?[^"'./][^"']*)["']\s*\)/g

type ViewMode = "preview" | "code" | "split"

interface SandpackPreviewConfig {
  codeLanguage: string
  customSetup?: SandpackSetup
  files: SandpackFiles
  previewHeight: number
  template: SandpackPredefinedTemplate
}

function normalizeFenceLanguage(language?: string): string {
  return language?.trim().toLowerCase() ?? ""
}

function countLines(source: string): number {
  if (!source) return 0
  return source.split("\n").length
}

function getPreviewLimits(language: string): { maxChars: number; maxLines: number } {
  if (language === "html" || language === "svg") {
    return {
      maxChars: STATIC_PREVIEW_MAX_PREVIEW_CHARS,
      maxLines: STATIC_PREVIEW_MAX_PREVIEW_LINES,
    }
  }

  return {
    maxChars: DEFAULT_MAX_PREVIEW_CHARS,
    maxLines: DEFAULT_MAX_PREVIEW_LINES,
  }
}

function shouldSkipPreview(language: string, source: string): boolean {
  const limits = getPreviewLimits(language)
  return source.length > limits.maxChars || countLines(source) > limits.maxLines
}

function looksLikeHtmlDocument(source: string): boolean {
  return /<!doctype\s+html/i.test(source) || /<html[\s>]/i.test(source)
}

function looksLikeReactSource(source: string): boolean {
  return (
    /from\s+["']react["']/.test(source) ||
    /export\s+default\s+function\s+[A-Z]/.test(source) ||
    /return\s*\(\s*</.test(source) ||
    /<[A-Z][A-Za-z0-9]*/.test(source) ||
    /ReactDOM\./.test(source)
  )
}

function looksLikeDomScript(source: string): boolean {
  return (
    /\bdocument\./.test(source) ||
    /\bwindow\./.test(source) ||
    /\bquerySelector\(/.test(source) ||
    /\bgetElementById\(/.test(source) ||
    /\baddEventListener\(/.test(source) ||
    /\bcreateElement\(/.test(source)
  )
}

function ensureDefaultReactExport(source: string): string {
  if (/export\s+default\s+/m.test(source)) {
    return source
  }

  const namedMatch =
    source.match(/\bfunction\s+([A-Z][A-Za-z0-9_]*)\s*\(/) ||
    source.match(/\bconst\s+([A-Z][A-Za-z0-9_]*)\s*=/) ||
    source.match(/\blet\s+([A-Z][A-Za-z0-9_]*)\s*=/) ||
    source.match(/\bclass\s+([A-Z][A-Za-z0-9_]*)\s+/)

  if (!namedMatch?.[1]) {
    return source
  }

  return `${source.trim()}\n\nexport default ${namedMatch[1]};\n`
}

function buildHtmlDocument(source: string): string {
  if (looksLikeHtmlDocument(source)) {
    return source
  }

  return [
    "<!doctype html>",
    '<html lang="en">',
    "  <head>",
    '    <meta charset="utf-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
    "    <title>Preview</title>",
    "  </head>",
    "  <body>",
    source,
    "  </body>",
    "</html>",
  ].join("\n")
}

function buildSvgDocument(source: string): string {
  return buildHtmlDocument(`
<style>
  body {
    margin: 0;
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 24px;
    background:
      radial-gradient(circle at top, rgba(148, 163, 184, 0.18), transparent 52%),
      linear-gradient(180deg, #ffffff, #f8fafc);
  }
  svg {
    max-width: 100%;
    max-height: 70vh;
  }
</style>
${source}
  `.trim())
}

function inferDependencies(source: string): Record<string, string> | undefined {
  const dependencies = new Set<string>()

  for (const pattern of [BARE_IMPORT_REGEX, REQUIRE_REGEX, DYNAMIC_IMPORT_REGEX]) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(source)) !== null) {
      const dependency = match[1]?.trim()
      if (!dependency || dependency === "react" || dependency === "react-dom") {
        continue
      }
      dependencies.add(dependency)
    }
  }

  if (dependencies.size === 0) {
    return undefined
  }

  return Object.fromEntries(Array.from(dependencies).map((dependency) => [dependency, "latest"]))
}

function buildSandpackPreviewConfig(
  language: string | undefined,
  source: string
): SandpackPreviewConfig | null {
  const normalizedLanguage = normalizeFenceLanguage(language)
  const trimmedSource = source.trim()

  if (!normalizedLanguage || !trimmedSource || shouldSkipPreview(normalizedLanguage, trimmedSource)) {
    return null
  }

  if (normalizedLanguage === "html") {
    return {
      template: "static",
      files: {
        "/index.html": buildHtmlDocument(trimmedSource),
      },
      codeLanguage: normalizedLanguage,
      previewHeight: 320,
    }
  }

  if (normalizedLanguage === "svg" && /<svg[\s>]/i.test(trimmedSource)) {
    return {
      template: "static",
      files: {
        "/index.html": buildSvgDocument(trimmedSource),
      },
      codeLanguage: normalizedLanguage,
      previewHeight: 320,
    }
  }

  if (normalizedLanguage === "jsx" || normalizedLanguage === "tsx") {
    const isTypeScript = normalizedLanguage === "tsx"
    return {
      template: isTypeScript ? "react-ts" : "react",
      files: {
        [isTypeScript ? "/App.tsx" : "/App.js"]: ensureDefaultReactExport(trimmedSource),
      },
      customSetup: {
        dependencies: inferDependencies(trimmedSource),
      },
      codeLanguage: normalizedLanguage,
      previewHeight: 360,
    }
  }

  if (
    (normalizedLanguage === "javascript" || normalizedLanguage === "js") &&
    looksLikeReactSource(trimmedSource)
  ) {
    return {
      template: "react",
      files: {
        "/App.js": ensureDefaultReactExport(trimmedSource),
      },
      customSetup: {
        dependencies: inferDependencies(trimmedSource),
      },
      codeLanguage: normalizedLanguage,
      previewHeight: 360,
    }
  }

  if (
    (normalizedLanguage === "typescript" || normalizedLanguage === "ts") &&
    looksLikeReactSource(trimmedSource)
  ) {
    return {
      template: "react-ts",
      files: {
        "/App.tsx": ensureDefaultReactExport(trimmedSource),
      },
      customSetup: {
        dependencies: inferDependencies(trimmedSource),
      },
      codeLanguage: normalizedLanguage,
      previewHeight: 360,
    }
  }

  if (
    normalizedLanguage === "javascript" ||
    normalizedLanguage === "js" ||
    normalizedLanguage === "typescript" ||
    normalizedLanguage === "ts"
  ) {
    if (!looksLikeDomScript(trimmedSource)) {
      return null
    }

    const isTypeScript = normalizedLanguage === "typescript" || normalizedLanguage === "ts"
    return {
      template: isTypeScript ? "vanilla-ts" : "vanilla",
      files: {
        [isTypeScript ? "/index.ts" : "/index.js"]: trimmedSource,
      },
      customSetup: {
        dependencies: inferDependencies(trimmedSource),
      },
      codeLanguage: normalizedLanguage,
      previewHeight: 320,
    }
  }

  return null
}

export function supportsSandpackFence(language: string | undefined, source: string): boolean {
  return buildSandpackPreviewConfig(language, source) !== null
}

function CornerAccent({ pos }: { pos: "tl" | "tr" | "bl" | "br" }) {
  return <div className="atelier-corner" data-pos={pos} />
}

export const SandpackFencePreview = memo(function SandpackFencePreview({
  source,
  language,
  className,
}: {
  source: string
  language?: string
  className?: string
}) {
  const config = useMemo(
    () => buildSandpackPreviewConfig(language, source),
    [language, source]
  )
  const [viewMode, setViewMode] = useState<ViewMode>("preview")
  const containerRef = useRef<HTMLDivElement>(null)
  const [fs, setFs] = useState(false)

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {})
    } else {
      document.exitFullscreen().catch(() => {})
    }
  }, [])

  useEffect(() => {
    const handler = () => setFs(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", handler)
    return () => document.removeEventListener("fullscreenchange", handler)
  }, [])

  if (!config) {
    return (
      <CodeBlock className={className} language={language}>
        {source}
      </CodeBlock>
    )
  }

  const showPreview = viewMode === "preview" || viewMode === "split"
  const showCode = viewMode === "code" || viewMode === "split"

  const tabs = [
    { mode: "preview" as const, icon: Eye, label: "Preview" },
    { mode: "code" as const, icon: Code2, label: "Code" },
    { mode: "split" as const, icon: Columns3, label: "Split" },
  ]

  return (
    <div
      ref={containerRef}
      className={cn(
        "atelier-shell",
        fs && "atelier-shell-fullscreen flex h-full w-full flex-col max-h-none max-w-none rounded-none"
      )}
    >
      {fs && (
        <style>{`
          .atelier-shell-fullscreen {
            height: 100dvh !important;
            width: 100vw !important;
          }

          .atelier-shell-fullscreen .sp-wrapper,
          .atelier-shell-fullscreen .sp-stack,
          .atelier-shell-fullscreen .sp-preview,
          .atelier-shell-fullscreen .sp-layout,
          .atelier-shell-fullscreen .sp-layout > div,
          .atelier-shell-fullscreen .sp-layout .sp-content,
          .atelier-shell-fullscreen .sp-layout .sp-preview-container,
          .atelier-shell-fullscreen .sp-preview-container,
          .atelier-shell-fullscreen .sp-preview-iframe {
            height: 100% !important;
            min-height: 0 !important;
            max-height: none !important;
          }

          .atelier-shell-fullscreen .sp-wrapper,
          .atelier-shell-fullscreen .sp-stack,
          .atelier-shell-fullscreen .sp-preview,
          .atelier-shell-fullscreen .sp-layout,
          .atelier-shell-fullscreen .sp-layout > div,
          .atelier-shell-fullscreen .sp-layout .sp-content,
          .atelier-shell-fullscreen .sp-layout .sp-preview-container,
          .atelier-shell-fullscreen .sp-preview-container {
            display: flex !important;
            flex: 1 1 auto !important;
          }

          .atelier-shell-fullscreen .sp-preview-container {
            overflow: hidden !important;
          }
        `}</style>
      )}
      {/* Top edge gradient line */}
      <div className="absolute inset-x-0 top-0 h-px bg-[var(--atl-edge)] pointer-events-none z-10" />

      {/* Corner accent brackets */}
      <CornerAccent pos="tl" />
      <CornerAccent pos="tr" />
      <CornerAccent pos="bl" />
      <CornerAccent pos="br" />

      {/* Header with tab bar */}
      <div className="atelier-header shrink-0">
        <div className="flex items-center gap-1">
          {tabs.map(({ mode, icon: Icon, label }) => (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              className={cn(
                "relative flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors",
                viewMode === mode
                  ? "text-[var(--atl-accent)]"
                  : "text-[var(--atl-ink-soft)] hover:text-[var(--atl-ink)]"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
              {viewMode === mode && (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-[var(--atl-accent)]" />
              )}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleFullscreen}
            className="flex items-center justify-center rounded-md p-1 text-[var(--atl-ink-soft)] hover:text-[var(--atl-ink)] hover:bg-[var(--atl-accent-soft)] transition-colors"
            aria-label={fs ? "Exit fullscreen" : "Enter fullscreen"}
          >
            {fs ? <Shrink className="h-3.5 w-3.5" /> : <Expand className="h-3.5 w-3.5" />}
          </button>
          <span className="atelier-chip" data-tone="accent">
            {config.codeLanguage}
          </span>
        </div>
      </div>

      {/* Preview section */}
      {showPreview && (
        <div
          className={cn(
            "bg-[var(--atl-canvas)] transition-all",
            showCode && !fs && "border-b border-[var(--atl-shell-border)]",
            fs && "flex min-h-0 flex-1 flex-col overflow-hidden"
          )}
        >
          <div className={cn("bg-[var(--atl-canvas)]", fs && "flex h-full min-h-0 flex-1 flex-col")}>
            <SandpackProvider
              template={config.template}
              files={config.files}
              customSetup={config.customSetup}
              theme="auto"
              options={{
                autorun: true,
                autoReload: true,
                initMode: "lazy",
                recompileMode: "immediate",
                recompileDelay: 0,
              }}
            >
              <SandpackLayout className={fs ? "flex h-full min-h-0 flex-1 flex-col" : undefined}>
                <SandpackPreview
                  data-testid="sandpack-preview"
                  aria-label={`sandpack-preview-${config.codeLanguage}`}
                  showNavigator={false}
                  showOpenInCodeSandbox={false}
                  showOpenNewtab={false}
                  showRefreshButton
                  showRestartButton={false}
                  showSandpackErrorOverlay
                  style={{ height: fs ? "100%" : `${config.previewHeight}px` }}
                />
              </SandpackLayout>
            </SandpackProvider>
          </div>
        </div>
      )}

      {/* Code section */}
      {showCode && (
        <div className={cn(fs && "flex-1 min-h-0 overflow-auto")}>
          <CodeBlock className={className} language={language}>
            {source}
          </CodeBlock>
        </div>
      )}
    </div>
  )
})
