"use client"

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import {
  SandpackLayout,
  SandpackPreview,
  SandpackProvider,
  type SandpackFiles,
  type SandpackPredefinedTemplate,
  type SandpackSetup,
} from "@codesandbox/sandpack-react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { CodeBlock } from "@/components/chat/code-block"
import { cn } from "@/lib/utils"
import { Eye, Code2, Columns3, Expand, Shrink } from "lucide-react"

const STATIC_PREVIEW_MAX_PREVIEW_CHARS = 200000
const STATIC_PREVIEW_MAX_PREVIEW_LINES = 4000

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
  if (language === "html") {
    return {
      maxChars: STATIC_PREVIEW_MAX_PREVIEW_CHARS,
      maxLines: STATIC_PREVIEW_MAX_PREVIEW_LINES,
    }
  }

  return {
    maxChars: 0,
    maxLines: 0,
  }
}

function shouldSkipPreview(language: string, source: string): boolean {
  const limits = getPreviewLimits(language)
  if (limits.maxChars <= 0 || limits.maxLines <= 0) {
    return true
  }
  return source.length > limits.maxChars || countLines(source) > limits.maxLines
}

function looksLikeCompleteHtmlDocument(source: string): boolean {
  const hasHtmlRoot = /<html[\s>][\s\S]*<\/html>/i.test(source)
  const hasDocumentSection =
    /<body[\s>][\s\S]*<\/body>/i.test(source) || /<head[\s>][\s\S]*<\/head>/i.test(source)
  return hasHtmlRoot && hasDocumentSection
}

function buildHtmlDocument(source: string): string {
  if (/<!doctype\s+html/i.test(source)) {
    return source
  }

  return `<!doctype html>\n${source}`
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

  if (normalizedLanguage === "html" && looksLikeCompleteHtmlDocument(trimmedSource)) {
    return {
      template: "static",
      files: {
        "/index.html": buildHtmlDocument(trimmedSource),
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
  const shouldReduceMotion = useReducedMotion()
  const tabIndicatorId = useId()
  const motionTransition = shouldReduceMotion
    ? { duration: 0 }
    : { type: "spring" as const, stiffness: 220, damping: 28, mass: 0.82 }

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
  const showFullscreenRail = fs && viewMode !== "code"

  const tabs = [
    { mode: "preview" as const, icon: Eye, label: "Preview" },
    { mode: "code" as const, icon: Code2, label: "Code" },
    { mode: "split" as const, icon: Columns3, label: "Split" },
  ]

  return (
    <motion.div
      ref={containerRef}
      layout
      transition={motionTransition}
      className={cn(
        "atelier-shell",
        fs && "atelier-shell-fullscreen flex h-full w-full flex-col max-h-none max-w-none rounded-none"
      )}
      data-fullscreen={fs ? "true" : "false"}
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
      <AnimatePresence>
        {fs ? (
          <motion.div
            key="fullscreen-ambient"
            aria-hidden="true"
            className="atelier-fullscreen-ambient"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.28 }}
          >
            <motion.div
              className="atelier-fullscreen-orbit atelier-fullscreen-orbit-a"
              animate={shouldReduceMotion ? undefined : { y: [0, -10, 0], opacity: [0.36, 0.56, 0.36] }}
              transition={{ duration: 7.2, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div
              className="atelier-fullscreen-orbit atelier-fullscreen-orbit-b"
              animate={shouldReduceMotion ? undefined : { y: [0, 12, 0], opacity: [0.28, 0.46, 0.28] }}
              transition={{ duration: 8.4, repeat: Infinity, ease: "easeInOut" }}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
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
            <motion.button
              key={mode}
              layout
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
                <motion.span
                  layoutId={`sandpack-active-tab-${tabIndicatorId}`}
                  className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-[var(--atl-accent)]"
                  transition={motionTransition}
                />
              )}
            </motion.button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <motion.button
            type="button"
            onClick={toggleFullscreen}
            className="flex items-center justify-center rounded-md p-1 text-[var(--atl-ink-soft)] hover:text-[var(--atl-ink)] hover:bg-[var(--atl-accent-soft)] transition-colors"
            aria-label={fs ? "Exit fullscreen" : "Enter fullscreen"}
            whileHover={shouldReduceMotion ? undefined : { scale: 1.06 }}
            whileTap={shouldReduceMotion ? undefined : { scale: 0.94 }}
            transition={motionTransition}
          >
            {fs ? <Shrink className="h-3.5 w-3.5" /> : <Expand className="h-3.5 w-3.5" />}
          </motion.button>
          <motion.span layout className="atelier-chip" data-tone="accent" transition={motionTransition}>
            {config.codeLanguage}
          </motion.span>
        </div>
      </div>

      {/* Preview section */}
      <AnimatePresence initial={false} mode={viewMode === "split" ? "sync" : "wait"}>
        {showPreview && (
          <motion.div
            key="preview"
            layout
            initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: shouldReduceMotion ? 0 : -6 }}
            transition={motionTransition}
            className={cn(
              "relative bg-[var(--atl-canvas)] transition-all",
              showCode && !fs && "border-b border-[var(--atl-shell-border)]",
              fs && "flex min-h-0 flex-1 flex-col overflow-hidden"
            )}
          >
            {showFullscreenRail ? (
              <motion.div
                aria-hidden="true"
                className="atelier-fullscreen-rail"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={motionTransition}
              >
                <span />
                <span />
                <span />
              </motion.div>
            ) : null}
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
          </motion.div>
        )}
      </AnimatePresence>

      {/* Code section */}
      <AnimatePresence initial={false}>
        {showCode && (
          <motion.div
            key="code"
            layout
            initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: shouldReduceMotion ? 0 : 6 }}
            transition={motionTransition}
            className={cn(fs && "flex-1 min-h-0 overflow-auto")}
          >
            <CodeBlock className={className} language={language}>
              {source}
            </CodeBlock>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
})
