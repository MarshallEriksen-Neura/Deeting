"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useI18n } from "@/hooks/use-i18n";
import { useChatService } from "@/hooks/use-chat-service";
import { createImageGenerationTask } from "@/lib/api/image-generation";
import { openApiSSE } from "@/lib/http";
import { useImageGenerationStore } from "@/store/image-generation-store";
import { useImageGenerationTasks } from "@/lib/swr/use-image-generation-tasks";
import { FloatingConsole } from "../../../components/floating-console";
import { createSessionId, normalizeSessionId } from "@/lib/chat/session-id";

export default function ImageControlsPage() {
  const t = useI18n("chat");
  const searchParams = useSearchParams();
  const { models } = useChatService({
    enabled: true,
    modelCapability: "image_generation",
  });

  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    selectedModelId,
    setSelectedModelId,
    sessionId,
    setSessionId,
    ratio,
    setRatio,
    steps,
    setSteps,
    guidance,
    setGuidance,
  } = useImageGenerationStore();

  const querySessionId = useMemo(
    () => normalizeSessionId(searchParams?.get("session") ?? null),
    [searchParams]
  );

  // 同步 sessionId
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

  const { items: sessionTasks } = useImageGenerationTasks(
    {
      size: 12,
      include_outputs: true,
      session_id: sessionId ?? undefined,
    },
    { enabled: Boolean(sessionId) }
  );

  // 生成历史图库数据
  const recentImages = useMemo(() => {
    return sessionTasks
      .map((task) => {
        const previewUrl = task.preview?.asset_url ?? task.preview?.source_url ?? null;
        if (!previewUrl) return null;
        return { url: previewUrl, taskId: task.task_id };
      })
      .filter((item): item is { url: string; taskId: string } => Boolean(item));
  }, [sessionTasks]);

  const handleGenerate = useCallback(async () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) return;
    if (!selectedModelId) {
      setError(t("error.modelUnavailable"));
      return;
    }

    const activeSessionId = ensureSessionId();
    setIsGenerating(true);
    setError(null);

    try {
      const task = await createImageGenerationTask({
        model: selectedModel?.id ?? selectedModelId,
        prompt: trimmedPrompt,
        aspect_ratio: ratio,
        num_outputs: 1,
        steps,
        cfg_scale: guidance,
        provider_model_id: selectedModelId,
        session_id: activeSessionId,
      });

      openApiSSE(`/api/v1/internal/images/generations/${task.task_id}/events`, {
        onMessage: (msg) => {
          const data = msg.data;
          if (data === "[DONE]") {
            setIsGenerating(false);
            return;
          }
          if (!data || typeof data !== "object") return;
          const payload = data as Record<string, unknown>;
          const type = typeof payload.type === "string" ? payload.type : "";
          if (type === "status") {
            const nextStatus = typeof payload.status === "string" ? payload.status : null;
            if (nextStatus === "failed") {
              setError((payload.error_message as string) || t("error.requestFailed"));
              setIsGenerating(false);
            }
            if (nextStatus === "succeeded") {
              setIsGenerating(false);
              // 刷新页面以显示新生成的图片
              window.location.reload();
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
  }, [prompt, selectedModelId, selectedModel, ratio, steps, guidance, t]);

  return (
    <div className="w-full">
      <FloatingConsole
        prompt={prompt}
        onPromptChange={setPrompt}
        onGenerate={handleGenerate}
        isGenerating={isGenerating}
        disabled={!selectedModelId}
        recentImages={recentImages}
        selectedModelId={selectedModelId ?? undefined}
        onModelChange={(modelId) => setSelectedModelId(modelId)}
        ratio={ratio}
        onRatioChange={setRatio}
        guidance={guidance}
        onGuidanceChange={setGuidance}
        steps={steps}
        onStepsChange={setSteps}
        models={models.map((model) => ({
          id: model.provider_model_id ?? model.id,
          name: model.name,
        }))}
      />
    </div>
  );
}
