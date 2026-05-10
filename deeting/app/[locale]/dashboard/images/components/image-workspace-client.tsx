"use client"

import { memo, useCallback, useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { usePathname, useRouter } from "next/navigation"
import {
  Clock3,
  Filter,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  RefreshCcw,
  Sparkles,
} from "lucide-react"
import { toast } from "sonner"

import ImageResultPanel, {
  type ImageResultPanelPayload,
} from "@/components/image/image-result-panel"
import {
  fetchConversationSessions,
  updateConversationAssistantMetaInfo,
  type ConversationMessage,
} from "@/lib/api/conversations"
import type { ImageGenerationTaskListItem, ImageOutputItem } from "@/lib/api/image-generation"
import { prepareDesktopObjectStorageRead } from "@/lib/api/desktop-object-storage"
import { loadConversationHistoryPage } from "@/lib/chat/history-loader"
import type { MessageBlock } from "@/lib/chat/message-protocol"
import { isTauriRuntime } from "@/lib/runtime/tauri"
import { Badge } from "@/ui/shadcn/badge"
import { Button } from "@/ui/shadcn/button"
import { Input } from "@/ui/shadcn/input"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/shadcn/alert-dialog"
import { cn } from "@/lib/utils"

type ImageWorkspaceClientProps = {
  initialSessionId: string | null
  initialTaskId: string | null
  source: string | null
}

type TaskGroup = {
  label: string
  items: ImageGenerationTaskListItem[]
}

type LocalHistoryRun = {
  item: ImageGenerationTaskListItem
  outputs: NonNullable<ImageResultPanelPayload["outputs"]>
  locator: {
    sessionId: string
    turnIndex: number
    blockId: string | null
    blockIndex: number
    metaInfo: Record<string, unknown>
  }
}

type PendingDeleteOutput = {
  taskId: string
  historyRun: LocalHistoryRun
  output: ImageOutputItem
  outputPosition: number
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function formatRelativeBucket(
  value: string | null | undefined,
  labels: {
    today: string
    yesterday: string
    last7Days: string
    earlier: string
  }
) {
  if (!value) return labels.earlier
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return labels.earlier

  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfYesterday = new Date(startOfToday)
  startOfYesterday.setDate(startOfYesterday.getDate() - 1)
  const startOfLast7Days = new Date(startOfToday)
  startOfLast7Days.setDate(startOfLast7Days.getDate() - 7)

  if (date >= startOfToday) return labels.today
  if (date >= startOfYesterday) return labels.yesterday
  if (date >= startOfLast7Days) return labels.last7Days
  return labels.earlier
}

function statusTone(status: string) {
  switch (status) {
    case "succeeded":
      return "border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-700 dark:text-emerald-300"
    case "failed":
      return "border-rose-500/25 bg-rose-500/[0.08] text-rose-700 dark:text-rose-300"
    case "canceled":
      return "border-zinc-500/20 bg-zinc-500/[0.08] text-zinc-700 dark:text-zinc-300"
    case "running":
      return "border-sky-500/25 bg-sky-500/[0.08] text-sky-700 dark:text-sky-300"
    default:
      return "border-amber-500/25 bg-amber-500/[0.08] text-amber-700 dark:text-amber-300"
  }
}

function trimPrompt(prompt: string | null | undefined) {
  if (!prompt) return ""
  return prompt.replace(/\s+/g, " ").trim()
}

function buildPayload(
  task: ImageGenerationTaskListItem | null,
  outputs: ImageResultPanelPayload["outputs"]
): ImageResultPanelPayload {
  if (!task) {
    return { outputs: [] }
  }

  const normalizedOutputs =
    outputs && outputs.length > 0
      ? outputs
      : task.preview
        ? [task.preview]
        : []

  return {
    preview: normalizedOutputs[0] ?? task.preview ?? null,
    outputs: normalizedOutputs,
    prompt: task.prompt ?? null,
    model: task.model ?? null,
  }
}

function isImageResultBlock(block: unknown): block is MessageBlock & {
  type: "ui"
  viewType: "image.result"
  payload?: Record<string, unknown>
  metadata?: Record<string, unknown>
} {
  const record = asRecord(block)
  return record?.type === "ui" && record.viewType === "image.result"
}

function normalizeImageOutputs(
  payload: Record<string, unknown> | null
): NonNullable<ImageResultPanelPayload["outputs"]> {
  if (!payload) return []

  const outputs = Array.isArray(payload.outputs)
    ? payload.outputs.filter(
        (
          item
        ): item is NonNullable<ImageResultPanelPayload["outputs"]>[number] =>
          Boolean(item && typeof item === "object")
      )
    : []

  if (outputs.length > 0) return outputs
  if (payload.preview && typeof payload.preview === "object") {
    return [payload.preview as NonNullable<ImageResultPanelPayload["outputs"]>[number]]
  }

  return []
}

function extractLocalHistoryRuns(
  sessionId: string,
  messages: ConversationMessage[]
): LocalHistoryRun[] {
  const runs: LocalHistoryRun[] = []

  messages.forEach((message) => {
    if (message.role !== "assistant" || typeof message.turn_index !== "number") {
      return
    }

    const metaInfo = asRecord(message.meta_info)
    const blocks = Array.isArray(metaInfo?.blocks) ? metaInfo.blocks : []
    if (!metaInfo || blocks.length === 0) return

    const turnIndex = message.turn_index

    blocks.forEach((block, blockIndex) => {
      if (!isImageResultBlock(block)) return

      const payload =
        block.payload && typeof block.payload === "object"
          ? (block.payload as Record<string, unknown>)
          : null
      const outputs = normalizeImageOutputs(payload)
      if (outputs.length === 0) return

      const metadata =
        block.metadata && typeof block.metadata === "object"
          ? (block.metadata as Record<string, unknown>)
          : null
      const createdAt =
        typeof message.created_at === "string" && message.created_at.trim().length > 0
          ? message.created_at
          : new Date().toISOString()
      const blockId = typeof block.id === "string" && block.id.trim().length > 0 ? block.id : null
      const taskId = `${sessionId}:${turnIndex}:${blockId ?? blockIndex}`
      const prompt =
        typeof payload?.prompt === "string" && payload.prompt.trim().length > 0
          ? payload.prompt.trim()
          : null
      const model =
        typeof payload?.model === "string" && payload.model.trim().length > 0
          ? payload.model.trim()
          : typeof metadata?.providerModelId === "string" &&
              metadata.providerModelId.trim().length > 0
            ? metadata.providerModelId.trim()
            : "image.result"

      runs.push({
        item: {
          task_id: taskId,
          status: "succeeded",
          model,
          session_id: sessionId,
          prompt,
          prompt_encrypted: false,
          negative_prompt: null,
          aspect_ratio: null,
          steps: null,
          cfg_scale: null,
          seed: typeof outputs[0]?.seed === "number" ? outputs[0].seed : null,
          provider_model_id:
            typeof metadata?.providerModelId === "string"
              ? metadata.providerModelId
              : null,
          created_at: createdAt,
          updated_at: createdAt,
          completed_at: createdAt,
          error_code: null,
          error_message: null,
          preview: outputs[0] ?? null,
        },
        outputs,
        locator: {
          sessionId,
          turnIndex,
          blockId,
          blockIndex,
          metaInfo,
        },
      })
    })
  })

  return runs
}

const TimelineThumb = memo(function TimelineThumb({
  item,
}: {
  item: ImageGenerationTaskListItem
}) {
  const [imgSrc, setImgSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const url =
    item.preview?.source_url?.trim() ||
    item.preview?.asset_url?.trim() ||
    ""

  useEffect(() => {
    if (!url) return
    if (url.startsWith("http://") || url.startsWith("https://")) {
      setImgSrc(url)
      return
    }
    if (url.startsWith("asset://")) {
      const key = url.slice("asset://".length).replace(/^\/+/, "")
      if (!key) {
        setFailed(true)
        return
      }
      prepareDesktopObjectStorageRead({ object_key: key, expires_seconds: 300 })
        .then((ticket) => setImgSrc(ticket.asset_url))
        .catch(() => setFailed(true))
      return
    }
    if (url.startsWith("local-asset://")) {
      const sha256 = url.slice("local-asset://".length).replace(/^\/+/, "")
      if (!sha256) {
        setFailed(true)
        return
      }
      import("@tauri-apps/api/core")
        .then(({ invoke }) =>
          invoke<{ data_url: string }>("read_local_chat_asset", {
            payload: {
              sha256,
              content_type: item.preview?.content_type ?? "image/png",
            },
          })
        )
        .then((result) => setImgSrc(result.data_url))
        .catch(() => setFailed(true))
      return
    }
    setFailed(true)
  }, [item.preview?.content_type, url])

  if (!url || failed) {
    return (
      <div className="flex size-[48px] shrink-0 items-center justify-center rounded-[12px] border border-[var(--hairline)] bg-[var(--panel-bg)] text-[var(--ink-3)]">
        <ImageIcon className="size-4" />
      </div>
    )
  }
  if (!imgSrc) {
    return (
      <div className="flex size-[48px] shrink-0 items-center justify-center rounded-[12px] border border-[var(--hairline)] bg-[var(--panel-bg)] text-[var(--ink-3)]">
        <Loader2 className="size-3.5 animate-spin" />
      </div>
    )
  }
  return (
    <div className="size-[48px] shrink-0 overflow-hidden rounded-[12px] border border-[var(--hairline)] bg-[var(--panel-bg-inset)]">
      <img
        src={imgSrc}
        alt=""
        className="h-full w-full object-cover"
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </div>
  )
})

export function ImageWorkspaceClient({
  initialSessionId,
  initialTaskId,
  source,
}: ImageWorkspaceClientProps) {
  const t = useTranslations("dashboard.imageWorkspace")
  const router = useRouter()
  const pathname = usePathname()
  const desktopRuntime = isTauriRuntime()
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(
    initialTaskId
  )
  const [historyFallback, setHistoryFallback] = useState<LocalHistoryRun[]>([])
  const [isHistoryFallbackLoading, setIsHistoryFallbackLoading] = useState(false)
  const [historyFallbackError, setHistoryFallbackError] = useState<string | null>(
    null
  )
  const [showMetadata, setShowMetadata] = useState(true)
  const [deletingOutputKey, setDeletingOutputKey] = useState<string | null>(null)
  const [pendingDeleteOutput, setPendingDeleteOutput] =
    useState<PendingDeleteOutput | null>(null)
  const [historyReloadToken, setHistoryReloadToken] = useState(0)

  const shouldLoadHistoryFallback = desktopRuntime

  useEffect(() => {
    if (!shouldLoadHistoryFallback) {
      setHistoryFallback([])
      setIsHistoryFallbackLoading(false)
      setHistoryFallbackError(null)
      return
    }

    let cancelled = false

    const loadFallback = async () => {
      setIsHistoryFallbackLoading(true)
      setHistoryFallbackError(null)
      try {
        const sessions = initialSessionId
          ? [{ session_id: initialSessionId }]
          : (await fetchConversationSessions({ size: 12, status: "active" }))
              .items

        const settled = await Promise.allSettled(
          sessions.map(async (session) => {
            const page = await loadConversationHistoryPage(session.session_id, {
              limit: 200,
              isTauriRuntime: true,
            })
            return extractLocalHistoryRuns(session.session_id, page.raw.messages)
          })
        )

        if (cancelled) return

        const extracted = settled.flatMap((result) =>
          result.status === "fulfilled" ? result.value : []
        )

        extracted.sort((left, right) => {
          const leftTime = Date.parse(
            left.item.completed_at ?? left.item.updated_at ?? left.item.created_at
          )
          const rightTime = Date.parse(
            right.item.completed_at ?? right.item.updated_at ?? right.item.created_at
          )
          return rightTime - leftTime
        })

        setHistoryFallback(extracted)
        if (settled.every((result) => result.status !== "fulfilled")) {
          setHistoryFallbackError(t("historyFallbackLoadFailed"))
        }
      } catch (nextError) {
        if (cancelled) return
        const message =
          nextError instanceof Error ? nextError.message : t("historyFallbackLoadFailed")
        setHistoryFallback([])
        setHistoryFallbackError(message)
      } finally {
        if (!cancelled) {
          setIsHistoryFallbackLoading(false)
        }
      }
    }

    void loadFallback()

    return () => {
      cancelled = true
    }
  }, [historyReloadToken, initialSessionId, shouldLoadHistoryFallback, t])

  const historyFallbackItems = useMemo(
    () => historyFallback.map((entry) => entry.item),
    [historyFallback]
  )
  const historyOutputsByTaskId = useMemo(() => {
    const nextMap = new Map<string, NonNullable<ImageResultPanelPayload["outputs"]>>()
    historyFallback.forEach((entry) => {
      nextMap.set(entry.item.task_id, entry.outputs)
    })
    return nextMap
  }, [historyFallback])
  const sourceItems = historyFallbackItems

  useEffect(() => {
    if (selectedTaskId) {
      const match = sourceItems.find((item) => item.task_id === selectedTaskId)
      if (match) return
    }
    setSelectedTaskId(sourceItems[0]?.task_id ?? null)
  }, [selectedTaskId, sourceItems])

  const selectedTask = useMemo(
    () => sourceItems.find((item) => item.task_id === selectedTaskId) ?? null,
    [selectedTaskId, sourceItems]
  )

  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return sourceItems
    return sourceItems.filter((item) => {
      const prompt = trimPrompt(item.prompt).toLowerCase()
      const model = item.model.toLowerCase()
      const providerModelId = (item.provider_model_id ?? "").toLowerCase()
      return (
        prompt.includes(query) ||
        model.includes(query) ||
        providerModelId.includes(query)
      )
    })
  }, [searchQuery, sourceItems])

  const groupedItems = useMemo<TaskGroup[]>(() => {
    const labels = {
      today: t("groups.today"),
      yesterday: t("groups.yesterday"),
      last7Days: t("groups.last7Days"),
      earlier: t("groups.earlier"),
    }
    const order = [
      labels.today,
      labels.yesterday,
      labels.last7Days,
      labels.earlier,
    ]
    const buckets = new Map<string, ImageGenerationTaskListItem[]>()

    filteredItems.forEach((item) => {
      const label = formatRelativeBucket(
        item.completed_at ?? item.updated_at ?? item.created_at,
        labels
      )
      const bucket = buckets.get(label) ?? []
      bucket.push(item)
      buckets.set(label, bucket)
    })

    return order
      .map((label) => {
        const groupItems = buckets.get(label) ?? []
        return groupItems.length > 0 ? { label, items: groupItems } : null
      })
      .filter((group): group is TaskGroup => Boolean(group))
  }, [filteredItems, t])

  const selectedPayload = useMemo(
    () =>
      buildPayload(
        selectedTask,
        historyOutputsByTaskId.get(selectedTaskId ?? "") ?? []
      ),
    [historyOutputsByTaskId, selectedTask, selectedTaskId]
  )

  const activeSessionLabel = initialSessionId
    ? `${initialSessionId.slice(0, 8)}...`
    : null
  const selectedPrompt = selectedTask?.prompt_encrypted
    ? t("promptEncrypted")
    : trimPrompt(selectedTask?.prompt) || t("promptEmpty")
  const selectedDimensions =
    selectedPayload.outputs && selectedPayload.outputs.length > 0
      ? (() => {
          const first = selectedPayload.outputs[0]
          if (!first?.width || !first?.height) return t("unknown")
          return `${first.width} × ${first.height}`
        })()
      : t("unknown")

  const clearSessionFilter = useCallback(() => {
    const params = new URLSearchParams()
    if (selectedTaskId) {
      params.set("task", selectedTaskId)
    }
    const next = params.toString()
    router.push(next ? `${pathname}?${next}` : pathname)
  }, [pathname, router, selectedTaskId])

  const openSourceSession = useCallback(() => {
    if (!selectedTask?.session_id) return
    router.push(`/chat?session=${encodeURIComponent(selectedTask.session_id)}`)
  }, [router, selectedTask?.session_id])

  const selectedHistoryRun = useMemo(
    () => historyFallback.find((entry) => entry.item.task_id === selectedTaskId) ?? null,
    [historyFallback, selectedTaskId]
  )

  const requestDeleteSelectedOutput = useCallback(
    (output: ImageOutputItem, outputPosition: number) => {
      if (!selectedHistoryRun || !selectedTaskId) return
      setPendingDeleteOutput({
        taskId: selectedTaskId,
        historyRun: selectedHistoryRun,
        output,
        outputPosition,
      })
    },
    [selectedHistoryRun, selectedTaskId]
  )

  const confirmDeleteSelectedOutput = useCallback(async () => {
      if (!pendingDeleteOutput) return

      const { historyRun, output, outputPosition, taskId } = pendingDeleteOutput
      const outputIndex = output.output_index
      const actionKey = `${taskId}:${outputIndex}`
      setDeletingOutputKey(actionKey)
      try {
        const { locator } = historyRun
        const blocks = Array.isArray(locator.metaInfo.blocks)
          ? [...locator.metaInfo.blocks]
          : []
        const blockIndex = locator.blockId
          ? blocks.findIndex((block) => asRecord(block)?.id === locator.blockId)
          : locator.blockIndex
        const block = asRecord(blocks[blockIndex])
        const payload = asRecord(block?.payload)
        const currentOutputs = Array.isArray(payload?.outputs)
          ? payload.outputs.filter((item) => item && typeof item === "object")
          : []
        const removeAt = currentOutputs.findIndex(
          (item) => asRecord(item)?.output_index === outputIndex
        )
        const targetIndex = removeAt >= 0 ? removeAt : outputPosition
        if (!block || !payload || targetIndex < 0 || targetIndex >= currentOutputs.length) {
          throw new Error(t("deleteOutputFailed"))
        }

        const nextOutputs = currentOutputs.filter((_, index) => index !== targetIndex)
        if (nextOutputs.length === 0) {
          blocks.splice(blockIndex, 1)
        } else {
          blocks[blockIndex] = {
            ...block,
            payload: {
              ...payload,
              outputs: nextOutputs,
              preview: nextOutputs[0] ?? null,
            },
          }
        }

        await updateConversationAssistantMetaInfo(locator.sessionId, locator.turnIndex, {
          ...locator.metaInfo,
          blocks,
        })
        setPendingDeleteOutput(null)
        setHistoryReloadToken((value) => value + 1)
        toast.success(t("deleteOutputSucceeded"))
      } catch (deleteError) {
        const message =
          deleteError instanceof Error ? deleteError.message : t("deleteOutputFailed")
        toast.error(message)
      } finally {
        setDeletingOutputKey((current) => (current === actionKey ? null : current))
      }
    },
    [pendingDeleteOutput, t]
  )

  const showLoadSkeleton =
    !historyFallbackError &&
    filteredItems.length === 0 &&
    isHistoryFallbackLoading

  return (
    <section className="flex min-h-[calc(100dvh-var(--shell-toolbar-h)-80px)] flex-col gap-5">
      <AlertDialog
        open={Boolean(pendingDeleteOutput)}
        onOpenChange={(open) => {
          if (!open && !deletingOutputKey) {
            setPendingDeleteOutput(null)
          }
        }}
      >
        <AlertDialogContent className="rounded-[20px] border border-[var(--hairline)] bg-[var(--panel-bg)] text-[var(--ink)] shadow-[0_24px_70px_-34px_rgba(15,23,42,0.55)]">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteOutputTitle")}</AlertDialogTitle>
            <AlertDialogDescription className="text-[var(--ink-3)]">
              {t("deleteOutputConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(deletingOutputKey)}>
              {t("deleteOutputCancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-[var(--danger)] text-white hover:bg-[var(--danger)]/90"
              disabled={Boolean(deletingOutputKey)}
              onClick={(event) => {
                event.preventDefault()
                void confirmDeleteSelectedOutput()
              }}
            >
              {deletingOutputKey ? (
                <>
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  {t("deleteOutputConfirmAction")}
                </>
              ) : (
                t("deleteOutputConfirmAction")
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <header className="flex flex-col gap-3 rounded-[20px] border border-[var(--hairline)] bg-[var(--panel-bg)] px-5 py-4 shadow-[0_18px_38px_-30px_rgba(15,23,42,0.35)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--ink-3)]">
              <Sparkles className="size-3.5 text-[var(--accent-strong)]" />
              <h1 className="text-lg font-semibold tracking-[-0.02em] text-[var(--ink)] lowercase">
                {t("title")}
              </h1>
            </div>
            {source === "chat" ? (
              <Badge
                variant="outline"
                className="h-5 rounded-full border-[var(--accent-border)] bg-[var(--accent-soft)] px-2 text-[10px] font-medium text-[var(--accent-ink)]"
              >
                {t("sourceChat")}
              </Badge>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            {initialSessionId ? (
              <>
                <Badge
                  variant="outline"
                  className="h-7 rounded-full border-[var(--accent-border)] bg-[var(--accent-soft)] px-2.5 text-[10px] font-medium text-[var(--accent-ink)]"
                >
                  <Filter className="mr-1 size-3" />
                  {t("sessionFilter", { session: activeSessionLabel ?? initialSessionId })}
                </Badge>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-7 rounded-full border border-[var(--hairline)] px-2.5 text-[11px]"
                  onClick={clearSessionFilter}
                >
                  {t("clearSessionFilter")}
                </Button>
              </>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              className="h-7 rounded-full border border-[var(--hairline)] px-2.5 text-[11px]"
              onClick={() => setHistoryReloadToken((value) => value + 1)}
            >
              <RefreshCcw className="mr-1 size-3" />
              {t("refresh")}
            </Button>
          </div>
        </div>

        {historyFallback.length > 0 ? (
          <div className="rounded-[12px] border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 py-1.5 text-[11px] text-[var(--accent-ink)]">
            {t("historyFallbackNotice")}
          </div>
        ) : null}

        {historyFallbackError ? (
          <div className="rounded-[12px] border border-[var(--warn-border)] bg-[var(--warn-soft)] px-3 py-1.5 text-[11px] text-[var(--warn)]">
            {historyFallbackError}
          </div>
        ) : null}

        <div className="flex items-center gap-3">
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={t("searchPlaceholder")}
            className="h-9 flex-1 rounded-[12px] border-[var(--hairline)] bg-[var(--panel-bg-inset)] text-[13px]"
          />
          <div className="flex h-9 shrink-0 items-center gap-2 rounded-[12px] border border-[var(--hairline)] bg-[var(--panel-bg-inset)] px-3 text-[12px] text-[var(--ink-3)]">
            <span>{t("runCountLabel")}</span>
            <span className="font-medium text-[var(--ink)]">{filteredItems.length}</span>
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="min-h-0 overflow-hidden rounded-[20px] border border-[var(--hairline)] bg-[var(--panel-bg)]">
          <div className="border-b border-[var(--hairline)] px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-[var(--ink)]">
                  {t("timelineTitle")}
                </div>
                <div className="mt-0.5 text-[11px] text-[var(--ink-3)]">
                  {t("timelineDescription")}
                </div>
              </div>
              {isHistoryFallbackLoading ? (
                <Loader2 className="size-3.5 animate-spin text-[var(--ink-3)]" />
              ) : null}
            </div>
          </div>

          <div className="max-h-[calc(100dvh-var(--shell-toolbar-h)-220px)] overflow-y-auto px-3 py-3">
            {historyFallbackError ? (
              <div className="rounded-[16px] border border-[var(--danger-border)] bg-[var(--danger-soft)] px-4 py-4 text-sm text-[var(--danger)]">
                <div className="font-medium">{t("loadFailed")}</div>
                <div className="mt-1 text-xs opacity-85">{historyFallbackError}</div>
              </div>
            ) : null}

            {showLoadSkeleton ? (
              <div className="space-y-2.5">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div
                    key={`image-run-skeleton-${index}`}
                    className="h-[72px] animate-pulse rounded-[14px] bg-[var(--panel-bg-inset)]"
                  />
                ))}
              </div>
            ) : null}

            {!showLoadSkeleton && filteredItems.length === 0 ? (
              <div className="rounded-[16px] border border-dashed border-[var(--hairline)] bg-[var(--panel-bg-inset)] px-4 py-6 text-sm text-[var(--ink-3)]">
                <div className="font-medium text-[var(--ink)]">{t("emptyTitle")}</div>
                <div className="mt-2 leading-6">
                  {searchQuery.trim()
                    ? t("emptyFilteredDescription")
                    : initialSessionId
                      ? t("emptySessionDescription")
                      : t("emptyDescription")}
                </div>
              </div>
            ) : null}

            {groupedItems.map((group) => (
              <div key={group.label} className="mb-4 last:mb-0">
                <div className="mb-2 flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-3)]">
                  <Clock3 className="size-3" />
                  <span>{group.label}</span>
                </div>
                <div className="space-y-1.5">
                  {group.items.map((item) => {
                    const isActive = item.task_id === selectedTaskId

                    return (
                      <button
                        key={item.task_id}
                        type="button"
                        className={cn(
                          "w-full rounded-[16px] border px-3 py-2.5 text-left transition-[border-color,background-color,transform] duration-[var(--dur-fast)] ease-[var(--ease-decel)] hover:-translate-y-[0.5px]",
                          isActive
                            ? "border-[var(--accent-border)] bg-[var(--accent-soft)]"
                            : "border-[var(--hairline)] bg-[var(--panel-bg-inset)] hover:border-[var(--hairline-strong)]"
                        )}
                        onClick={() => setSelectedTaskId(item.task_id)}
                      >
                        <div className="flex gap-2.5">
                          <TimelineThumb item={item} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-1.5">
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium text-[var(--ink)]">
                                  {item.prompt_encrypted
                                    ? t("promptEncrypted")
                                    : trimPrompt(item.prompt) || t("promptEmpty")}
                                </div>
                                <div className="mt-0.5 flex items-center gap-2 truncate text-[11px] text-[var(--ink-3)]">
                                  <span className="truncate">{item.model}</span>
                                  <span className="shrink-0 select-none">·</span>
                                  <span className="shrink-0">
                                    {formatTimestamp(
                                      item.completed_at ?? item.updated_at ?? item.created_at
                                    ) ?? t("unknown")}
                                  </span>
                                </div>
                              </div>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "mt-0.5 h-5 shrink-0 rounded-full border px-1.5 text-[9px] font-medium",
                                  statusTone(item.status)
                                )}
                              >
                                {t(`status.${item.status}`)}
                              </Badge>
                            </div>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}

          </div>
        </aside>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-[20px] border border-[var(--hairline)] bg-[var(--panel-bg)]">
          {/* Detail header with collapsible toggle */}
          <div className="flex items-center justify-between border-b border-[var(--hairline)] px-5 py-3.5">
            <div>
              <div className="text-sm font-semibold text-[var(--ink)]">
                {selectedTask ? t("detailTitle") : t("detailEmptyTitle")}
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--ink-3)]">
                {selectedTask ? t("detailDescription") : t("detailEmptyDescription")}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {selectedTask?.session_id ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-8 rounded-full border border-[var(--hairline)] px-2.5 text-[11px]"
                  onClick={openSourceSession}
                >
                  <MessageSquare className="mr-1 size-3.5" />
                  {t("openSourceSession")}
                </Button>
              ) : null}
              <button
                type="button"
                className={cn(
                  "group flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]",
                  showMetadata
                    ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-ink)]"
                    : "border-[var(--hairline)] bg-transparent text-[var(--ink-3)] hover:border-[var(--hairline-strong)] hover:text-[var(--ink)]"
                )}
                onClick={() => setShowMetadata((prev) => !prev)}
              >
                <span className="transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]" style={{ transform: showMetadata ? 'rotate(0deg)' : 'rotate(180deg)' }}>
                  {showMetadata ? (
                    <PanelRightClose className="size-3.5" />
                  ) : (
                    <PanelRightOpen className="size-3.5" />
                  )}
                </span>
                <span className="transition-opacity duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]">
                  {showMetadata ? "Details" : "Details"}
                </span>
              </button>
            </div>
          </div>

          {/* Body: image + optional metadata */}
          <div
            className={cn(
              "flex min-h-0 flex-1",
              showMetadata && "xl:grid xl:grid-cols-[minmax(0,1fr)_280px]"
            )}
          >
            {/* Image Area */}
            <div
              className={cn(
                "flex min-h-0 flex-col",
                showMetadata && "border-b border-[var(--hairline)] xl:border-b-0 xl:border-r"
              )}
            >
              <div className="flex-1 overflow-y-auto p-5">
                {selectedTask ? (
                  <div className="space-y-4">
                    <ImageResultPanel
                      payload={selectedPayload}
                      outputAction={
                        selectedHistoryRun && selectedTaskId
                          ? {
                              deleteLabel: t("deleteOutput"),
                              onDeleteOutput: requestDeleteSelectedOutput,
                              isDeletingOutput: (output) =>
                                deletingOutputKey ===
                                `${selectedTaskId}:${output.output_index}`,
                            }
                          : null
                      }
                    />
                  </div>
                ) : (
                  <div className="flex h-[420px] items-center justify-center rounded-[20px] border border-dashed border-[var(--hairline)] bg-[var(--panel-bg-inset)] text-sm text-[var(--ink-3)]">
                    {t("detailEmptyDescription")}
                  </div>
                )}
              </div>
            </div>

            {/* Metadata Panel (collapsible) */}
            {showMetadata && selectedTask ? (
              <aside className="min-h-0 overflow-y-auto bg-[var(--panel-bg-inset)] p-4">
                <div className="space-y-4">
                  {/* Prompt */}
                  <section className="rounded-[16px] border border-[var(--hairline)] bg-[var(--panel-bg)] p-3.5">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-3)]">
                      {t("recipeTitle")}
                    </div>
                    <div className="mt-2.5 rounded-[12px] bg-[var(--panel-bg-inset)] px-3 py-2.5 text-[13px] leading-6 text-[var(--ink)]">
                      {selectedPrompt}
                    </div>
                  </section>

                  {/* Metadata Vertical */}
                  <section className="rounded-[16px] border border-[var(--hairline)] bg-[var(--panel-bg)] p-3.5">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-3)]">
                      {t("metadataTitle")}
                    </div>
                    <dl className="mt-2.5 space-y-2 text-[12px]">
                      <div className="flex items-center justify-between gap-3">
                        <dt className="shrink-0 text-[var(--ink-3)]">{t("fields.model")}</dt>
                        <dd className="truncate text-right font-medium text-[var(--ink)]">{selectedTask.model}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <dt className="shrink-0 text-[var(--ink-3)]">{t("fields.status")}</dt>
                        <dd>
                          <Badge
                            variant="outline"
                            className={cn("h-5 rounded-full border px-1.5 text-[9px] font-medium", statusTone(selectedTask.status))}
                          >
                            {t(`status.${selectedTask.status}`)}
                          </Badge>
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <dt className="shrink-0 text-[var(--ink-3)]">{t("fields.dimensions")}</dt>
                        <dd className="text-right font-medium text-[var(--ink)]">{selectedDimensions}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <dt className="shrink-0 text-[var(--ink-3)]">{t("fields.seed")}</dt>
                        <dd className="text-right font-medium text-[var(--ink)]">{selectedTask.seed ?? t("unknown")}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <dt className="shrink-0 text-[var(--ink-3)]">{t("fields.steps")}</dt>
                        <dd className="text-right font-medium text-[var(--ink)]">{selectedTask.steps ?? t("unknown")}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <dt className="shrink-0 text-[var(--ink-3)]">{t("fields.cfgScale")}</dt>
                        <dd className="text-right font-medium text-[var(--ink)]">{selectedTask.cfg_scale ?? t("unknown")}</dd>
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <dt className="shrink-0 text-[var(--ink-3)]">{t("fields.session")}</dt>
                        <dd className="break-all text-right font-mono text-[12px] text-[var(--ink)] max-w-[60%]">{selectedTask.session_id ?? t("none")}</dd>
                      </div>
                    </dl>
                  </section>

                  {/* Timeline Vertical */}
                  <section className="rounded-[16px] border border-[var(--hairline)] bg-[var(--panel-bg)] p-3.5">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-3)]">
                      {t("timelineMetaTitle")}
                    </div>
                    <dl className="mt-2.5 space-y-2 text-[12px]">
                      <div className="flex items-center justify-between gap-3">
                        <dt className="shrink-0 text-[var(--ink-3)]">{t("fields.createdAt")}</dt>
                        <dd className="text-right font-medium text-[var(--ink)]">{formatTimestamp(selectedTask.created_at) ?? t("unknown")}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <dt className="shrink-0 text-[var(--ink-3)]">{t("fields.updatedAt")}</dt>
                        <dd className="text-right font-medium text-[var(--ink)]">{formatTimestamp(selectedTask.updated_at) ?? t("unknown")}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <dt className="shrink-0 text-[var(--ink-3)]">{t("fields.completedAt")}</dt>
                        <dd className="text-right font-medium text-[var(--ink)]">{formatTimestamp(selectedTask.completed_at) ?? t("none")}</dd>
                      </div>
                    </dl>
                  </section>
                </div>
              </aside>
            ) : null}
          </div>
        </section>
      </div>
    </section>
  )
}
