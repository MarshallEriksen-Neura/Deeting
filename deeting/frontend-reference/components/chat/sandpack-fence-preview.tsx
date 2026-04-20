"use client"

import { memo, useMemo } from "react"
import {
  SandpackLayout,
  SandpackPreview,
  SandpackProvider,
  type SandpackFiles,
  type SandpackPredefinedTemplate,
  type SandpackSetup,
} from "@codesandbox/sandpack-react"
import { CodeBlock } from "@/components/chat/code-block"

const MAX_PREVIEW_CHARS = 12000
const MAX_PREVIEW_LINES = 400
const BARE_IMPORT_REGEX =
  /\bimport\s+(?:[\w*\s{},]*?\s+from\s+)?["'](@?[^"'./][^"']*)["']/g
const REQUIRE_REGEX = /\brequire\(\s*["'](@?[^"'./][^"']*)["']\s*\)/g
const DYNAMIC_IMPORT_REGEX = /\bimport\(\s*["'](@?[^"'./][^"']*)["']\s*\)/g

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

function shouldSkipPreview(source: string): boolean {
  return source.length > MAX_PREVIEW_CHARS || countLines(source) > MAX_PREVIEW_LINES
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

  if (!normalizedLanguage || !trimmedSource || shouldSkipPreview(trimmedSource)) {
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

  if (!config) {
    return (
      <CodeBlock className={className} language={language}>
        {source}
      </CodeBlock>
    )
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-lg border border-border bg-background/80">
        <div className="border-b border-border/60 px-3 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
          <span className="font-medium">Sandpack preview</span>
        </div>
        <div className="bg-background">
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
            <SandpackLayout>
              <SandpackPreview
                data-testid="sandpack-preview"
                aria-label={`sandpack-preview-${config.codeLanguage}`}
                showNavigator={false}
                showOpenInCodeSandbox={false}
                showOpenNewtab={false}
                showRefreshButton
                showRestartButton={false}
                showSandpackErrorOverlay
                style={{ height: `${config.previewHeight}px` }}
              />
            </SandpackLayout>
          </SandpackProvider>
        </div>
      </div>

      <CodeBlock className={className} language={language}>
        {source}
      </CodeBlock>
    </div>
  )
})

