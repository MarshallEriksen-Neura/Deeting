"use client";

import { Suspense, useState, useCallback, useMemo, useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/hooks/use-i18n";
import { useChatService } from "@/hooks/use-chat-service";
import {
  cancelImageGenerationTask,
  createImageGenerationTask,
  watchImageGenerationTask,
} from "@/lib/api/image-generation";
import { useImageGenerationStore } from "@/store/image-generation-store";
import { useImageGenerationTasks } from "@/lib/swr/use-image-generation-tasks";
import { FloatingConsole } from "@/components/chat/console/floating-console";
import { createRequestId } from "@/lib/chat/request-id";
import { createSessionId, normalizeSessionId } from "@/lib/chat/session-id";
import { resolveImagePreviewUrl } from "@/lib/image/result-helpers";

export default function ImageControlsPage() {
  return (
    <Suspense fallback={null}>
      <ImageControlsPageContent />
    </Suspense>
  );
}

function ImageControlsPageContent() {
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
  const [, setError] = useState<string | null>(null);
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
    isGenerating,
    startGeneration,
    finishGeneration,
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
      finishGeneration();
    };
  }, [finishGeneration]);

  const ensureSessionId = useCallback(() => {
    if (sessionId) return sessionId;
    const nextId = createSessionId();
    setSessionId(nextId);
    return nextId;
  }, [sessionId, setSessionId]);

  const selectedModel = useMemo(
    () =>
      models.find((model) => model.provider_model_id === selectedModelId || model.id === selectedModelId),
    [models, selectedModelId]
  );

  const { items: sessionTasks, mutate: mutateSessionTasks } = useImageGenerationTasks(
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
        const previewUrl = resolveImagePreviewUrl(task);
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
    startGeneration(trimmedPrompt);
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

      mutateSessionTasks();
      activeTaskIdRef.current = task.task_id;
      stopRef.current = watchImageGenerationTask(task.task_id, {
        onMessage: (msg) => {
          const data = msg.data;
          if (data === "[DONE]") {
            stopRef.current?.();
            stopRef.current = null;
            activeTaskIdRef.current = null;
            activeRequestIdRef.current = null;
            finishGeneration();
            mutateSessionTasks();
            return;
          }
          if (!data || typeof data !== "object") return;
          const payload = data as Record<string, unknown>;
          const type = typeof payload.type === "string" ? payload.type : "";
          if (type === "status") {
            const nextStatus = typeof payload.status === "string" ? payload.status : null;
            if (nextStatus === "queued" || nextStatus === "running") {
              mutateSessionTasks();
            }
            if (nextStatus === "failed") {
              setError((payload.error_message as string) || t("error.requestFailed"));
              finishGeneration();
              mutateSessionTasks();
              stopRef.current?.();
              stopRef.current = null;
              activeTaskIdRef.current = null;
              activeRequestIdRef.current = null;
            }
            if (nextStatus === "succeeded") {
              finishGeneration();
              stopRef.current?.();
              stopRef.current = null;
              activeTaskIdRef.current = null;
              activeRequestIdRef.current = null;
              mutateSessionTasks();
            }
          }
          if (type === "timeout" || type === "error") {
            setError(t("error.requestFailed"));
            finishGeneration();
            mutateSessionTasks();
            stopRef.current?.();
            stopRef.current = null;
            activeTaskIdRef.current = null;
            activeRequestIdRef.current = null;
          }
        },
        onError: () => {
          setError(t("error.requestFailed"));
          finishGeneration();
          mutateSessionTasks();
          stopRef.current?.();
          stopRef.current = null;
          activeTaskIdRef.current = null;
          activeRequestIdRef.current = null;
        },
      });
    } catch {
      setError(t("error.requestFailed"));
      finishGeneration();
      activeTaskIdRef.current = null;
      activeRequestIdRef.current = null;
    }
  }, [prompt, selectedNegatives, selectedModelId, selectedModel, ratio, steps, guidance, t, mutateSessionTasks, startGeneration, finishGeneration, ensureSessionId]);

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
    finishGeneration();
    const params = new URLSearchParams(searchParams?.toString());
    params.delete("session");
    const url = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    router.replace(url || "/chat/create/image");
  }, [pathname, resetSession, router, searchParams, finishGeneration]);

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
