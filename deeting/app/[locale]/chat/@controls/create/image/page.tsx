"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/hooks/use-i18n";
import { useChatService } from "@/hooks/use-chat-service";
import { cancelImageGenerationTask, createImageGenerationTask } from "@/lib/api/image-generation";
import { openApiSSE } from "@/lib/http";
import { useImageGenerationStore } from "@/store/image-generation-store";
import { useImageGenerationTasks } from "@/lib/swr/use-image-generation-tasks";
import { FloatingConsole } from "@/components/chat/console/floating-console";
import { createRequestId } from "@/lib/chat/request-id";
import { createSessionId, normalizeSessionId } from "@/lib/chat/session-id";

export default function ImageControlsPage() {
  const t = useI18n("chat");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { models } = useChatService({
    enabled: true,
    modelCapability: "image_generation",
  });

  const [prompt, setPrompt] = useState("");
  const [selectedNegatives, setSelectedNegatives] = useState<Set<string>>(new Set());
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const activeTaskIdRef = useRef<string | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);

  const {
    selectedModelId,
    sessionId,
    setSessionId,
    resetSession,
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

  useEffect(() => {
    return () => {
      stopRef.current?.();
    };
  }, []);

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
    if (!sessionId) {
      return [];
    }
    return sessionTasks
      .map((task) => {
        const previewUrl = task.preview?.asset_url ?? task.preview?.source_url ?? null;
        if (!previewUrl) return null;
        return { url: previewUrl, taskId: task.task_id };
      })
      .filter((item): item is { url: string; taskId: string } => Boolean(item));
  }, [sessionId, sessionTasks]);

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
    stopRef.current?.();
    stopRef.current = null;
    activeTaskIdRef.current = null;
    activeRequestIdRef.current = null;

    try {
      const negativePrompt = selectedNegatives.size > 0 
        ? Array.from(selectedNegatives).join(", ") 
        : undefined;

      const requestId = createRequestId();
      activeRequestIdRef.current = requestId;

      const task = await createImageGenerationTask({
        model: selectedModel?.id ?? selectedModelId,
        prompt: trimmedPrompt,
        negative_prompt: negativePrompt,
        aspect_ratio: ratio,
        num_outputs: 1,
        steps,
        cfg_scale: guidance,
        provider_model_id: selectedModelId,
        session_id: activeSessionId,
        request_id: requestId,
      });

      activeTaskIdRef.current = task.task_id;
      stopRef.current = openApiSSE(`/api/v1/internal/images/generations/${task.task_id}/events`, {
        onMessage: (msg) => {
          const data = msg.data;
          if (data === "[DONE]") {
            stopRef.current?.();
            stopRef.current = null;
            activeTaskIdRef.current = null;
            activeRequestIdRef.current = null;
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
              stopRef.current?.();
              stopRef.current = null;
              activeTaskIdRef.current = null;
              activeRequestIdRef.current = null;
            }
            if (nextStatus === "succeeded") {
              setIsGenerating(false);
              stopRef.current?.();
              stopRef.current = null;
              activeTaskIdRef.current = null;
              activeRequestIdRef.current = null;
              // 刷新页面以显示新生成的图片
              window.location.reload();
            }
          }
          if (type === "timeout" || type === "error") {
            setError(t("error.requestFailed"));
            setIsGenerating(false);
            stopRef.current?.();
            stopRef.current = null;
            activeTaskIdRef.current = null;
            activeRequestIdRef.current = null;
          }
        },
        onError: () => {
          setError(t("error.requestFailed"));
          setIsGenerating(false);
          stopRef.current?.();
          stopRef.current = null;
          activeTaskIdRef.current = null;
          activeRequestIdRef.current = null;
        },
      });
    } catch {
      setError(t("error.requestFailed"));
      setIsGenerating(false);
      activeTaskIdRef.current = null;
      activeRequestIdRef.current = null;
    }
  }, [prompt, selectedNegatives, selectedModelId, selectedModel, ratio, steps, guidance, t]);

  const handleNewSession = useCallback(async () => {
    const requestId = activeRequestIdRef.current;
    stopRef.current?.();
    stopRef.current = null;
    activeTaskIdRef.current = null;
    activeRequestIdRef.current = null;
    if (requestId) {
      try {
        await cancelImageGenerationTask(requestId);
      } catch {
        // ignore cancel errors to keep UX responsive
      }
    }
    resetSession();
    setPrompt("");
    setSelectedNegatives(new Set());
    setError(null);
    setIsGenerating(false);
    const params = new URLSearchParams(searchParams?.toString());
    params.delete("session");
    const url = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    router.replace(url || "/chat/create/image");
  }, [pathname, resetSession, router, searchParams]);

  return (
    <div className="w-full">
      <FloatingConsole
        prompt={prompt}
        onPromptChange={setPrompt}
        onGenerate={handleGenerate}
        isGenerating={isGenerating}
        disabled={!selectedModelId}
        recentImages={recentImages}
        onNewSession={handleNewSession}
        ratio={ratio}
        onRatioChange={setRatio}
        guidance={guidance}
        onGuidanceChange={setGuidance}
        steps={steps}
        onStepsChange={setSteps}
        selectedNegatives={selectedNegatives}
        onSelectedNegativesChange={setSelectedNegatives}
      />
    </div>
  );
}
