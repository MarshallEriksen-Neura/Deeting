"use client";

import { useState, useCallback } from "react";
import { Sparkles, Play } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/hooks/use-i18n";
import { useVideoGenerationStore } from "@/store/video-generation-store";
import { useVideoGenerationTasks } from "@/lib/swr/use-video-generation-tasks";
import { createSessionId } from "@/lib/chat/session-id";
import {
  createVideoGenerationTask,
  fetchVideoGenerationTask,
} from "@/lib/api/video-generation";
import type { VideoGenerationTaskDetail } from "@/lib/api/video-generation";
import { Button } from "@/components/ui/button";
import { InputSection } from "./input-section";
import { ParameterSettings } from "./parameter-settings";
import { VideoModelSelector } from "./video-model-selector";
import { VideoPreviewCanvas } from "./video-preview-canvas";
import { HistoryTimeline } from "./history-timeline";

type GenerationPhase = "idle" | "submitting" | "queued" | "processing" | "completed" | "failed";

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 200; // ~10 minutes max

export default function VideoDashboard() {
  const t = useI18n("video");
  const [generationPhase, setGenerationPhase] = useState<GenerationPhase>("idle");
  const [currentVideo, setCurrentVideo] = useState<string | null>(null);
  const [currentTaskDetail, setCurrentTaskDetail] = useState<VideoGenerationTaskDetail | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const {
    sessionId,
    setSessionId,
    prompt,
    imageUrl,
    selectedModelId,
    ratio,
    duration,
    fps,
    motionBucketId,
  } = useVideoGenerationStore();

  const {
    items: sessionTasks,
    isLoading: isLoadingTasks,
    hasMore,
    loadMore,
    mutate,
  } = useVideoGenerationTasks(
    {
      size: 12,
      include_outputs: true,
      session_id: sessionId ?? undefined,
    },
    { enabled: Boolean(sessionId) }
  );

  const isGenerating = generationPhase === "submitting" || generationPhase === "queued" || generationPhase === "processing";

  const pollTaskStatus = useCallback(
    async (taskId: string) => {
      let attempts = 0;
      while (attempts < MAX_POLL_ATTEMPTS) {
        attempts++;
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        try {
          const detail = await fetchVideoGenerationTask(taskId);
          setCurrentTaskDetail(detail);

          if (detail.status === "completed") {
            const videoOutput = detail.outputs?.find(
              (o) => o.asset_url || o.source_url
            );
            setCurrentVideo(videoOutput?.asset_url || videoOutput?.source_url || null);
            setGenerationPhase("completed");
            mutate();
            return;
          }

          if (detail.status === "failed") {
            setErrorMessage(detail.error_message || t("errorGenerate"));
            setGenerationPhase("failed");
            toast.error(detail.error_message || t("errorGenerate"));
            mutate();
            return;
          }

          if (detail.status === "processing") {
            setGenerationPhase("processing");
          }
        } catch {
          // Network error during poll — continue retrying
        }
      }
      setGenerationPhase("failed");
      setErrorMessage("Generation timed out. Check history for updates.");
      toast.error("Generation timed out");
    },
    [mutate, t]
  );

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) {
      toast.error(t("promptRequired"));
      return;
    }
    if (!selectedModelId) {
      toast.error(t("modelRequired"));
      return;
    }

    setGenerationPhase("submitting");
    setErrorMessage(null);
    setCurrentVideo(null);
    setCurrentTaskDetail(null);

    try {
      const sid = sessionId || createSessionId();
      if (!sessionId) {
        setSessionId(sid);
      }

      const result = await createVideoGenerationTask({
        model: selectedModelId,
        prompt: prompt.trim(),
        image_url: imageUrl,
        aspect_ratio: ratio,
        duration,
        fps,
        motion_bucket_id: motionBucketId,
        session_id: sid,
      });

      setGenerationPhase("queued");
      mutate();

      await pollTaskStatus(result.task_id);
    } catch (error) {
      setGenerationPhase("failed");
      const message =
        error instanceof Error ? error.message : t("errorGenerate");
      setErrorMessage(message);
      toast.error(message);
    }
  }, [
    prompt,
    sessionId,
    setSessionId,
    selectedModelId,
    imageUrl,
    ratio,
    duration,
    fps,
    motionBucketId,
    pollTaskStatus,
    mutate,
    t,
  ]);

  const handleSelectTask = useCallback(
    (taskId: string) => {
      const task = sessionTasks.find((t) => t.task_id === taskId);
      if (task?.preview?.asset_url || task?.preview?.source_url) {
        setCurrentVideo(task.preview.asset_url || task.preview.source_url || null);
        setGenerationPhase("completed");
      }
    },
    [sessionTasks]
  );

  return (
    <div className="flex flex-col lg:flex-row h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 relative overflow-hidden">
      {/* Background noise texture */}
      <div className="absolute inset-0 opacity-20">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(56,189,248,0.08),transparent_50%)] dark:bg-[radial-gradient(circle_at_50%_50%,rgba(56,189,248,0.1),transparent_50%)] animate-pulse" />
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZGVmcz48cGF0dGVybiBpZD0iZ3JpZCIgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIiBwYXR0ZXJuVW5pdHM9InVzZXJTcGFjZU9uVXNlIj48cGF0aCBkPSJNIDQwIDAgTCAwIDAgMCA0MCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJyZ2JhKDU2LCAxODksIDI0OCwgMC4xKSIgc3Ryb2tlLXdpZHRoPSIxIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2dyaWQpIi8+PC9zdmc+')] opacity-10 dark:opacity-30" />
      </div>

      {/* Left Input Dock */}
      <aside className="w-full lg:w-80 m-2 lg:m-4 bg-black/5 dark:bg-white/5 backdrop-blur-xl rounded-2xl border border-black/10 dark:border-white/10 p-4 lg:p-6 flex flex-col gap-4 lg:gap-6 shadow-2xl shadow-cyan-500/5 dark:shadow-cyan-500/10 relative overflow-hidden">
        <div className="absolute -inset-1 bg-gradient-to-r from-cyan-500/10 via-transparent to-teal-500/10 dark:from-cyan-500/20 dark:via-transparent dark:to-teal-500/20 rounded-2xl blur-xl" />

        <div className="relative z-10 flex flex-col h-full">
          <h2 className="text-lg lg:text-xl font-medium text-foreground mb-4 lg:mb-6 flex items-center gap-2">
            <Sparkles className="w-4 lg:w-5 h-4 lg:h-5 text-cyan-500 dark:text-cyan-400" />
            {t("create")}
          </h2>

          <div className="flex-1 overflow-y-auto space-y-4">
            <VideoModelSelector />
            <InputSection />
            <ParameterSettings />
          </div>

          <Button
            onClick={handleGenerate}
            disabled={isGenerating || !selectedModelId}
            className="w-full mt-4 py-3 bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500 rounded-xl transition-all shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/30 disabled:opacity-50"
          >
            {isGenerating ? (
              <>
                <div className="w-4 h-4 border-2 border-foreground/30 border-t-foreground rounded-full animate-spin mr-2" />
                {t("generating")}
              </>
            ) : (
              <>
                <Play className="w-4 h-4 mr-2" />
                {t("generate")}
              </>
            )}
          </Button>

          {generationPhase === "failed" && errorMessage && (
            <div className="mt-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
              <p className="text-xs text-red-400">{errorMessage}</p>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleGenerate}
                className="mt-1 text-xs text-red-300 hover:text-red-200 hover:bg-red-500/10 p-0 h-auto"
              >
                {t("errorRetry")}
              </Button>
            </div>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-2 lg:p-4 flex flex-col relative z-10 min-h-0">
        <VideoPreviewCanvas
          videoUrl={currentVideo}
          isGenerating={isGenerating}
          generationPhase={generationPhase}
          taskDetail={currentTaskDetail}
        />

        <div className="h-32 lg:h-48 mt-2 lg:mt-4 overflow-x-auto">
          <HistoryTimeline
            tasks={sessionTasks}
            isLoading={isLoadingTasks}
            hasMore={hasMore}
            onLoadMore={loadMore}
            onSelectTask={handleSelectTask}
          />
        </div>
      </main>
    </div>
  );
}
