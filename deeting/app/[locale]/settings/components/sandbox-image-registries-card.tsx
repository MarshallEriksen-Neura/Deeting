"use client"

import * as React from "react"
import { Image as ImageIcon, Plus, RotateCw, Save } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useI18n } from "@/hooks/use-i18n"
import {
  repairLocalSandbox,
  setLocalSandboxImageRegistries,
} from "@/lib/api/sandbox"
import { useSandboxImageRegistries } from "@/lib/swr/use-sandbox-status"

interface SandboxImageRegistriesCardProps {
  isTauriRuntime: boolean
}

const PRESET_MIRRORS: { label: string; host: string }[] = [
  { label: "DaoCloud", host: "docker.m.daocloud.io" },
  { label: "USTC", host: "docker.mirrors.ustc.edu.cn" },
  { label: "SJTU", host: "docker.mirrors.sjtug.sjtu.edu.cn" },
  { label: "NJU", host: "docker.nju.edu.cn" },
  { label: "1Panel", host: "docker.1panel.live" },
  { label: "docker.io", host: "docker.io" },
]

function parseLines(raw: string): string[] {
  return raw
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function dedupePreservingOrder(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const key = value.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      out.push(value)
    }
  }
  return out
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  return a.every((value, index) => value === b[index])
}

export function SandboxImageRegistriesCard({
  isTauriRuntime,
}: SandboxImageRegistriesCardProps) {
  const t = useI18n("settings")
  const { data, isLoading, mutate } = useSandboxImageRegistries({
    enabled: isTauriRuntime,
  })
  const [draft, setDraft] = React.useState<string>("")
  const [isSaving, setIsSaving] = React.useState(false)
  const [isApplying, setIsApplying] = React.useState(false)

  // Initialize textarea when server data arrives, but don't clobber
  // in-progress edits.
  const hydratedOnce = React.useRef(false)
  React.useEffect(() => {
    if (data === undefined) return
    if (hydratedOnce.current) return
    setDraft(data.join("\n"))
    hydratedOnce.current = true
  }, [data])

  if (!isTauriRuntime) {
    return null
  }

  const parsed = dedupePreservingOrder(parseLines(draft))
  const saved = data ?? []
  const isDirty = !arraysEqual(parsed, saved)

  const handleAddPreset = (host: string) => {
    const next = dedupePreservingOrder([...parseLines(draft), host])
    setDraft(next.join("\n"))
  }

  const handleReset = () => {
    setDraft(saved.join("\n"))
  }

  const handleSave = async (): Promise<string[] | null> => {
    try {
      setIsSaving(true)
      const canonical = await setLocalSandboxImageRegistries(parsed)
      await mutate(canonical, { revalidate: false })
      setDraft(canonical.join("\n"))
      toast.success(t("agent.sandbox.imageRegistries.saveSuccess"))
      return canonical
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : String(err ?? t("agent.sandbox.actionFailed"))
      toast.error(message)
      return null
    } finally {
      setIsSaving(false)
    }
  }

  const handleSaveAndApply = async () => {
    const canonical = await handleSave()
    if (canonical === null) return
    try {
      setIsApplying(true)
      await repairLocalSandbox()
      toast.success(t("agent.sandbox.imageRegistries.applySuccess"))
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : String(err ?? t("agent.sandbox.actionFailed"))
      toast.error(message)
    } finally {
      setIsApplying(false)
    }
  }

  const anyBusy = isSaving || isApplying

  return (
    <div className="rounded-2xl border border-border/40 bg-card/50 transition-colors hover:bg-card/70 dark:bg-card/30 dark:hover:bg-card/40">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/30 px-6 py-5">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:bg-emerald-400/10 dark:text-emerald-400">
            <ImageIcon className="h-4.5 w-4.5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {t("agent.sandbox.imageRegistries.title")}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("agent.sandbox.imageRegistries.description")}
            </p>
          </div>
        </div>
        <Badge variant="outline" className="text-[11px]">
          {saved.length > 0
            ? t("agent.sandbox.imageRegistries.countLabel", {
                count: String(saved.length),
              })
            : t("agent.sandbox.imageRegistries.noneConfigured")}
        </Badge>
      </div>

      {/* Content */}
      <div className="space-y-4 px-6 py-5 text-sm">
        <div className="space-y-2">
          <label className="block text-xs font-medium text-foreground">
            {t("agent.sandbox.imageRegistries.listLabel")}
          </label>
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t("agent.sandbox.imageRegistries.placeholder")}
            className="min-h-[120px] font-mono text-xs"
            spellCheck={false}
            disabled={isLoading || anyBusy}
          />
          <p className="text-[11px] text-muted-foreground">
            {t("agent.sandbox.imageRegistries.listHelp")}
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {t("agent.sandbox.imageRegistries.presetsLabel")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {PRESET_MIRRORS.map((preset) => {
              const alreadyAdded = parsed.some(
                (item) => item.toLowerCase() === preset.host.toLowerCase()
              )
              return (
                <Button
                  key={preset.host}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 text-[11px]"
                  onClick={() => handleAddPreset(preset.host)}
                  disabled={alreadyAdded || anyBusy}
                  title={preset.host}
                >
                  <Plus className="h-3 w-3" />
                  {preset.label}
                </Button>
              )
            })}
          </div>
        </div>

        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-3 text-[11px] text-amber-700 dark:border-amber-400/15 dark:bg-amber-400/[0.06] dark:text-amber-300">
          {t("agent.sandbox.imageRegistries.restartNotice")}
        </div>
      </div>

      {/* Footer */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/30 px-6 py-3.5">
        <p className="text-[11px] text-muted-foreground/60">
          {t("agent.sandbox.imageRegistries.footerHint")}
        </p>
        <div className="flex flex-wrap justify-end gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleReset}
            disabled={!isDirty || anyBusy}
            className="h-7 text-xs"
          >
            {t("agent.sandbox.imageRegistries.reset")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => handleSave()}
            disabled={!isDirty || anyBusy}
            className="h-7 text-xs"
          >
            <Save className="mr-1 h-3 w-3" />
            {isSaving
              ? t("agent.sandbox.imageRegistries.saving")
              : t("agent.sandbox.imageRegistries.save")}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSaveAndApply}
            disabled={anyBusy}
            className="h-7 text-xs"
          >
            <RotateCw className="mr-1 h-3 w-3" />
            {isApplying
              ? t("agent.sandbox.imageRegistries.applying")
              : t("agent.sandbox.imageRegistries.saveAndApply")}
          </Button>
        </div>
      </div>
    </div>
  )
}
