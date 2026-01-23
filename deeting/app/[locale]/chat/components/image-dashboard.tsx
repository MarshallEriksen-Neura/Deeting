"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { useI18n } from "@/hooks/use-i18n";
import { useChatService } from "@/hooks/use-chat-service";
import { createImageGenerationTask, type ImageGenerationOutputItem } from "@/lib/api/image-generation";
import { openApiSSE } from "@/lib/http";
import { useImageGenerationStore } from "@/store/image-generation-store";
import { StatusStream, HolographicPulse, useStepProgress } from "./status-visuals";
import { buildImageAttachments, UPLOAD_ERROR_CODES } from "@/lib/chat/attachments";
import { createSessionId, normalizeSessionId } from "@/lib/chat/session-id";
import type { ChatImageAttachment } from "@/lib/chat/message-content";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import { useImageGenerationTasks } from "@/lib/swr/use-image-generation-tasks";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Sparkles } from "lucide-react";

export default function ImageDashboard() {
  const t = useI18n("chat");
  const searchParams = useSearchParams();
  const { models } = useChatService({
    enabled: true,
    modelCapability: "image_generation",
  });

  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [output, setOutput] = useState<ImageGenerationOutputItem | null>(null);

  const stopRef = useRef<(() => void) | null>(null);
  const {
    selectedModelId,
    setSelectedModelId,
    sessionId,
    setSessionId,
    ratio,
    steps,
    guidance,
  } = useImageGenerationStore();

  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const ensureSessionId = () => {
    if (sessionId) return sessionId;
    const nextId = createSessionId();
    setSessionId(nextId);
    return nextId;
  };

  const selectedModel = useMemo(
    () =>
      models.find((model) => model.provider_model_id === selectedModelId || model.id === selectedModelId),
    [models, selectedModelId]
  );

  const outputUrl = output?.asset_url ?? output?.source_url ?? null;

  const {
    items: sessionTasks,
  } = useImageGenerationTasks(
    {
      size: 12,
      include_outputs: true,
      session_id: sessionId ?? undefined,
    },
    { enabled: Boolean(sessionId) }
  );

  const sessionPreviews = useMemo(() => {
    return sessionTasks
      .map((task) => ({
        task,
        previewUrl: task.preview?.asset_url ?? task.preview?.source_url ?? null,
      }))
      .filter((item) => Boolean(item.previewUrl));
  }, [sessionTasks]);

  useEffect(() => {
    if (isGenerating) return;
    if (outputUrl) return;
    if (!sessionPreviews.length) return;
    const firstPreview = sessionPreviews[0]?.task.preview;
    if (firstPreview) {
      setOutput(firstPreview as ImageGenerationOutputItem);
    }
  }, [isGenerating, outputUrl, sessionPreviews]);

  const stepsVisual = useMemo(() => [
    { key: "queue", label: t("status.flow.queue") },
    { key: "process", label: t("status.flow.process") },
    { key: "refine", label: t("status.flow.refine") },
    { key: "finish", label: t("status.flow.finish") },
  ], [t]);

  const timerStep = useStepProgress(isGenerating, stepsVisual.length);

  const activeStep = useMemo(() => {
    if (status === "succeeded") return 3;
    if (status === "failed") return 0;
    if (status === "queued") return 0;
    if (status === "running") {
      return Math.max(1, timerStep);
    }
    return 0;
  }, [status, timerStep]);

  useEffect(() => {
    if (!models.length) return;
    const hasSelected = models.some(
      (model) => model.provider_model_id === selectedModelId || model.id === selectedModelId
    );
    if (!hasSelected) {
      setSelectedModelId(models[0].provider_model_id ?? models[0].id);
    }
  }, [models, selectedModelId, setSelectedModelId]);

  useEffect(() => {
    return () => {
      stopRef.current?.();
    };
  }, []);

  // 画布尺寸计算
  const getCanvasDimensions = () => {
    const aspectRatio = ratio === "1:1" ? 1 : ratio === "16:9" ? 16 / 9 : 9 / 16;
    const maxHeight = typeof window !== "undefined" ? window.innerHeight * 0.55 : 500;
    const maxWidth = typeof window !== "undefined" ? window.innerWidth * 0.85 : 800;
    let height = maxHeight;
    let width = height * aspectRatio;
    if (width > maxWidth) {
      width = maxWidth;
      height = width / aspectRatio;
    }
    return { width: Math.round(width), height: Math.round(height) };
  };

  const [canvasDimensions, setCanvasDimensions] = useState({ width: 512, height: 512 });

  useEffect(() => {
    const updateDimensions = () => setCanvasDimensions(getCanvasDimensions());
    updateDimensions();
    window.addEventListener("resize", updateDimensions);
    return () => window.removeEventListener("resize", updateDimensions);
  }, [ratio]);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    if (!files.length) return;
    setError(null);
    const result = await buildImageAttachments(files);

    if (result.skipped > 0 && result.attachments.length === 0) {
      setError(t("input.image.errorInvalid"));
      return;
    }
    // 处理附件的逻辑保持不变
    event.target.value = "";
  };

  const handleGenerate = async () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) return;
    if (!selectedModelId) {
      setError(t("error.modelUnavailable"));
      return;
    }

    const activeSessionId = ensureSessionId();

    setIsGenerating(true);
    setError(null);
    setOutput(null);
    setStatus("queued");

    stopRef.current?.();

    try {
      const task = await createImageGenerationTask({
        model: selectedModel?.id ?? selectedModelId,
        prompt: trimmedPrompt || " ",
        aspect_ratio: ratio,
        num_outputs: 1,
        steps,
        cfg_scale: guidance,
        provider_model_id: selectedModelId,
        session_id: activeSessionId,
      });

      stopRef.current = openApiSSE(`/api/v1/internal/images/generations/${task.task_id}/events`, {
        onMessage: (msg) => {
          const data = msg.data;
          if (data === "[DONE]") {
            stopRef.current?.();
            setIsGenerating(false);
            return;
          }
          if (!data || typeof data !== "object") return;
          const payload = data as Record<string, unknown>;
          const type = typeof payload.type === "string" ? payload.type : "";
          if (type === "status") {
            const nextStatus = typeof payload.status === "string" ? payload.status : null;
            if (nextStatus) setStatus(nextStatus);
            if (Array.isArray(payload.outputs) && payload.outputs.length > 0) {
              setOutput(payload.outputs[0] as ImageGenerationOutputItem);
            }
            if (nextStatus === "failed") {
              setError((payload.error_message as string) || t("error.requestFailed"));
              setIsGenerating(false);
            }
            if (nextStatus === "succeeded") {
              setIsGenerating(false);
            }
          }
          if (type === "timeout" || type === "error") {
            setError(t("error.requestFailed"));
            setIsGenerating(false);
          }
        },
        onError: () => {
          setError(t("error.requestFailed"));
          setIsGenerating(false);
        },
      });
    } catch {
      setError(t("error.requestFailed"));
      setIsGenerating(false);
    }
  };

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

      {/* 主画布区域 - 居中悬浮 */}
      <div className="absolute inset-0 flex items-center justify-center p-8">
        {outputUrl ? (
          <ImageLightbox src={outputUrl} alt={t("input.image.alt")}>
            <GlassCard
              blur="default"
              theme="surface"
              className="relative overflow-hidden cursor-zoom-in group"
              shine={true}
              innerBorder={true}
            >
              <div
                style={{
                  width: canvasDimensions.width,
                  height: canvasDimensions.height,
                }}
              >
                <Image
                  src={outputUrl}
                  alt={t("input.image.alt")}
                  fill
                  sizes="(max-width: 1024px) 100vw, 800px"
                  className="object-contain transition-transform duration-500 group-hover:scale-105"
                />
                {/* 悬停遮罩 */}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                  <div className="bg-white/90 dark:bg-black/80 backdrop-blur-sm text-foreground p-3 rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
                    <Sparkles className="w-5 h-5" />
                  </div>
                </div>
              </div>
            </GlassCard>
          </ImageLightbox>
        ) : isGenerating ? (
          <GlassCard
            blur="default"
            theme="surface"
            className="flex items-center justify-center"
            style={{
              width: canvasDimensions.width,
              height: canvasDimensions.height,
            }}
          >
            <HolographicPulse
              label={stepsVisual[activeStep]?.label || t("status.placeholder.batch")}
              className="h-full max-h-32 w-full"
            />
          </GlassCard>
        ) : (
          /* 空状态 - 画布占位符 */
          <GlassCard
            blur="default"
            theme="surface"
            className="flex flex-col items-center justify-center text-center"
            style={{
              width: canvasDimensions.width,
              height: canvasDimensions.height,
            }}
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
        )}
      </div>

      {/* 画布下方状态指示 */}
      {isGenerating && (
        <div className="absolute bottom-32 left-1/2 transform -translate-x-1/2 z-20">
          <StatusStream
            steps={stepsVisual}
            activeIndex={activeStep}
            label={t("status.flow.stream")}
            compact={true}
          />
        </div>
      )}

      {/* 错误提示 */}
      {error && (
        <div className="absolute top-6 left-1/2 transform -translate-x-1/2 z-50">
          <div className="px-4 py-2 rounded-xl bg-red-500/20 text-red-600 dark:text-red-400 text-sm">
            {error}
          </div>
        </div>
      )}

      {/* 隐藏的文件输入 */}
      <Input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}
