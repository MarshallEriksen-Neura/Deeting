"use client";

import { useEffect, useMemo, useCallback, useRef, memo } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { useImageGenerationStore } from "@/store/image-generation-store";
import { useImageGenerationTasks } from "@/lib/swr/use-image-generation-tasks";
import { normalizeSessionId } from "@/lib/chat/session-id";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { MarkdownViewer } from "@/components/chat/markdown-viewer";
import type { ImageGenerationTaskItem } from "@/lib/api/image-generation";

type StatusTone = "default" | "secondary" | "destructive" | "outline";

const PromptBubble = memo<{ content: string }>(({ content }) => {
  return (
    <div className="flex justify-end w-full">
      <div className="max-w-[88%] rounded-2xl px-5 py-3 text-sm leading-relaxed shadow-sm bg-primary text-primary-foreground rounded-tr-sm">
        <MarkdownViewer content={content} className="chat-markdown chat-markdown-user" />
      </div>
    </div>
  );
});

PromptBubble.displayName = "PromptBubble";

const ImageResultBubble = memo<{
  previewUrl: string | null;
  status: string;
  statusLabel: string;
  statusTone: StatusTone;
  aspectRatio: string;
  imageAlt: string;
}>(({ previewUrl, status, statusLabel, statusTone, aspectRatio, imageAlt }) => {
  const showBadge = status !== "succeeded" && Boolean(statusLabel);

  return (
    <div className="flex justify-start w-full">
      <GlassCard
        blur="sm"
        theme="surface"
        hover="none"
        padding="sm"
        className="w-full max-w-[460px]"
        shine={true}
        innerBorder={true}
      >
        {showBadge ? (
          <div className="mb-3 flex items-center gap-2">
            <Badge variant={statusTone}>{statusLabel}</Badge>
          </div>
        ) : null}
        {previewUrl ? (
          <ImageLightbox src={previewUrl} alt={imageAlt}>
            <div className="relative w-full max-h-[45vh]" style={{ aspectRatio }}>
              <Image
                src={previewUrl}
                alt={imageAlt}
                fill
                sizes="(max-width: 768px) 90vw, 640px"
                className="rounded-xl object-contain bg-slate-50/60 dark:bg-white/5"
              />
            </div>
          </ImageLightbox>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-xs">{statusLabel}</span>
          </div>
        )}
      </GlassCard>
    </div>
  );
});

ImageResultBubble.displayName = "ImageResultBubble";

/**
 * 图像仪表板组件
 *
 * 功能：
 * - 图像生成历史展示
 * - 聊天式展示提示词与生成结果
 * - 画布滚动与 HUD/控制条避让
 */
export default function ImageDashboard() {
  const t = useI18n("chat");
  const searchParams = useSearchParams();
  const { sessionId, setSessionId, ratio } = useImageGenerationStore();
  const containerRef = useRef<HTMLDivElement>(null);

  const querySessionId = useMemo(
    () => normalizeSessionId(searchParams?.get("session") ?? null),
    [searchParams]
  );

  useEffect(() => {
    if (!querySessionId) return;
    if (querySessionId !== sessionId) {
      setSessionId(querySessionId);
    }
  }, [querySessionId, sessionId, setSessionId]);

  const { items: sessionTasks } = useImageGenerationTasks(
    {
      size: 12,
      include_outputs: true,
      session_id: sessionId ?? undefined,
    },
    { enabled: Boolean(sessionId) }
  );

  const hasConversation = sessionTasks.length > 0;

  useEffect(() => {
    if (!hasConversation) return;
    const container = containerRef.current;
    if (!container) return;

    const hud = document.querySelector<HTMLElement>("[data-chat-hud]");
    const controls = document.querySelector<HTMLElement>("[data-chat-controls]");
    const fallbackTop = 112;
    const fallbackBottom = 152;

    const updateOffsets = () => {
      const hudHeight = hud?.getBoundingClientRect().height ?? 0;
      const controlsHeight = controls?.getBoundingClientRect().height ?? 0;
      const topOffset = Math.max(hudHeight + 24, fallbackTop);
      const bottomOffset = Math.max(controlsHeight + 24, fallbackBottom);
      container.style.setProperty("--chat-hud-offset", `${topOffset}px`);
      container.style.setProperty("--chat-controls-offset", `${bottomOffset}px`);
    };

    updateOffsets();

    const observers: ResizeObserver[] = [];
    if (hud) {
      const observer = new ResizeObserver(updateOffsets);
      observer.observe(hud);
      observers.push(observer);
    }
    if (controls) {
      const observer = new ResizeObserver(updateOffsets);
      observer.observe(controls);
      observers.push(observer);
    }

    window.addEventListener("resize", updateOffsets);

    return () => {
      observers.forEach((observer) => observer.disconnect());
      window.removeEventListener("resize", updateOffsets);
    };
  }, [hasConversation]);

  const statusMeta = useMemo(() => {
    const labels = {
      queued: t("imageHistory.status.queued"),
      running: t("imageHistory.status.running"),
      succeeded: t("imageHistory.status.succeeded"),
      failed: t("imageHistory.status.failed"),
      canceled: t("imageHistory.status.canceled"),
    };
    const tones: Record<string, StatusTone> = {
      queued: "secondary",
      running: "secondary",
      succeeded: "default",
      failed: "destructive",
      canceled: "outline",
    };
    return { labels, tones };
  }, [t]);

  const renderPrompt = useCallback(
    (task: ImageGenerationTaskItem) => {
      if (task.prompt_encrypted) {
        return t("imageHistory.promptEncrypted");
      }
      if (task.prompt?.trim()) {
        return task.prompt.trim();
      }
      return t("imageHistory.promptEmpty");
    },
    [t]
  );

  const ratioFallback = useMemo(() => {
    if (ratio === "16:9") return "16 / 9";
    if (ratio === "9:16") return "9 / 16";
    return "1 / 1";
  }, [ratio]);

  const resolveAspectRatio = useCallback(
    (task: ImageGenerationTaskItem) => {
      const width = task.preview?.width;
      const height = task.preview?.height;
      if (width && height) {
        return `${width} / ${height}`;
      }
      return ratioFallback;
    },
    [ratioFallback]
  );

  const resolveTaskTimestamp = useCallback(
    (task: ImageGenerationTaskItem) =>
      task.completed_at ?? task.updated_at ?? task.created_at ?? null,
    []
  );

  const resolveTaskTimestampValue = useCallback(
    (task: ImageGenerationTaskItem) => {
      const timestamp = resolveTaskTimestamp(task);
      if (!timestamp) return 0;
      const date = new Date(timestamp);
      return Number.isNaN(date.getTime()) ? 0 : date.getTime();
    },
    [resolveTaskTimestamp]
  );

  const conversationItems = useMemo(() => {
    const sortedTasks = [...sessionTasks].sort(
      (a, b) => resolveTaskTimestampValue(a) - resolveTaskTimestampValue(b)
    );
    return sortedTasks.map((task) => {
      const previewUrl = task.preview?.asset_url ?? task.preview?.source_url ?? null;
      const statusLabel = statusMeta.labels[task.status] ?? task.status;
      const statusTone = statusMeta.tones[task.status] ?? "outline";
      return {
        id: task.task_id,
        prompt: renderPrompt(task),
        previewUrl,
        status: task.status,
        statusLabel,
        statusTone,
        aspectRatio: resolveAspectRatio(task),
      };
    });
  }, [sessionTasks, resolveTaskTimestampValue, renderPrompt, statusMeta, resolveAspectRatio]);

  const imageAlt = t("input.image.alt");

  return (
    <div className="relative w-full h-full overflow-hidden">
      {/* 极光弥散背景 - iOS 氛围感 */}
      <div className="absolute inset-0 bg-gradient-to-b from-slate-50/90 via-blue-50/60 to-indigo-50/50 dark:from-slate-950/50 dark:via-slate-900/40 dark:to-indigo-950/30">
        {/* 动态光斑 - 多层叠加 */}
        <div className="absolute top-[-35%] left-[-20%] w-[80vw] h-[80vw] bg-gradient-to-br from-sky-200/25 via-indigo-200/15 to-purple-200/10 dark:from-sky-700/15 dark:via-indigo-600/10 dark:to-purple-600/5 rounded-full blur-[140px] animate-float" />
        <div className="absolute bottom-[-35%] right-[-20%] w-[70vw] h-[70vw] bg-gradient-to-tl from-cyan-200/25 via-blue-200/15 to-teal-200/10 dark:from-cyan-700/15 dark:via-blue-600/10 dark:to-teal-600/5 rounded-full blur-[120px] animate-float-delayed" />
        <div className="absolute top-[12%] left-[35%] w-[48vw] h-[48vw] bg-gradient-to-r from-rose-200/15 via-amber-100/10 to-purple-200/10 dark:from-rose-700/10 dark:via-amber-600/8 dark:to-purple-600/5 rounded-full blur-[100px] animate-pulse-slow" />

        {/* 微妙的网格纹理 - 增加质感 */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.08)_1px,transparent_1px)] bg-[size:42px_42px]" />

        {/* 顶部柔光 */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/50 to-transparent" />
      </div>

      {hasConversation ? (
        <div
          ref={containerRef}
          className="absolute inset-0 overflow-y-auto px-4 scrollbar-hide"
          style={{
            paddingTop: "calc(var(--chat-hud-offset, 112px) + env(safe-area-inset-top))",
            paddingBottom: "calc(var(--chat-controls-offset, 152px) + env(safe-area-inset-bottom))",
            scrollPaddingTop: "calc(var(--chat-hud-offset, 112px) + env(safe-area-inset-top))",
            scrollPaddingBottom: "calc(var(--chat-controls-offset, 152px) + env(safe-area-inset-bottom))",
          }}
        >
          <div className="max-w-5xl 2xl:max-w-6xl mx-auto flex flex-col gap-8 pt-2">
            {conversationItems.map((item) => (
              <div key={item.id} className="flex flex-col gap-4">
                <PromptBubble content={item.prompt} />
                <ImageResultBubble
                  previewUrl={item.previewUrl}
                  status={item.status}
                  statusLabel={item.statusLabel}
                  statusTone={item.statusTone}
                  aspectRatio={item.aspectRatio}
                  imageAlt={imageAlt}
                />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center p-8">
          <GlassCard
            blur="default"
            theme="surface"
            className="flex flex-col items-center justify-center text-center px-10 py-12 max-w-md"
          >
            <div className="w-20 h-20 rounded-3xl bg-primary/10 flex items-center justify-center mb-4">
              <Sparkles className="w-10 h-10 text-primary" />
            </div>
            <h3 className="text-lg font-medium text-foreground mb-2">
              {t("image.emptyState.title") || "开始创作"}
            </h3>
            <p className="text-sm text-muted-foreground max-w-xs">
              {t("image.emptyState.description") || "在底部输入框描述你的想象"}
            </p>
          </GlassCard>
        </div>
      )}
    </div>
  );
}
