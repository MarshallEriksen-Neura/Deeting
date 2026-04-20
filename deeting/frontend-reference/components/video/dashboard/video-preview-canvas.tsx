"use client";

import { useState, useRef, useCallback } from "react";
import { Play, Pause, RotateCcw, Download, Expand, Scissors } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { Button } from "@/ui/shadcn/button";
import type { VideoGenerationTaskDetail } from "@/lib/api/video-generation";

type GenerationPhase = "idle" | "submitting" | "queued" | "processing" | "completed" | "failed";

interface VideoPreviewCanvasProps {
  videoUrl: string | null;
  isGenerating: boolean;
  generationPhase: GenerationPhase;
  taskDetail: VideoGenerationTaskDetail | null;
}

export function VideoPreviewCanvas({
  videoUrl,
  isGenerating,
  generationPhase,
}: VideoPreviewCanvasProps) {
  const t = useI18n("video");
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  const handlePlayPause = useCallback(() => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  }, [isPlaying]);

  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) {
      const current = videoRef.current.currentTime;
      const total = videoRef.current.duration;
      setCurrentTime(current);
      setProgress((current / total) * 100);
    }
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
  }, []);

  const handleProgressClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (videoRef.current) {
        const rect = event.currentTarget.getBoundingClientRect();
        const clickX = event.clientX - rect.left;
        const percentage = clickX / rect.width;
        const newTime = percentage * videoRef.current.duration;
        videoRef.current.currentTime = newTime;
        setCurrentTime(newTime);
        setProgress(percentage * 100);
      }
    },
    []
  );

  const handleFrameExtract = useCallback(() => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const link = document.createElement("a");
    link.download = `frame-${currentTime.toFixed(2)}s.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }, [currentTime]);

  const handleDownload = useCallback(() => {
    if (!videoUrl) return;
    const link = document.createElement("a");
    link.href = videoUrl;
    link.download = "video.mp4";
    link.click();
  }, [videoUrl]);

  const handleFullscreen = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.requestFullscreen?.();
    }
  }, []);

  const getPhaseMessage = () => {
    switch (generationPhase) {
      case "submitting":
        return t("generating");
      case "queued":
        return t("queued");
      case "processing":
        return t("generatingDesc");
      default:
        return t("generatingDesc");
    }
  };

  if (isGenerating) {
    return (
      <div className="flex-1 bg-foreground/5 dark:bg-black/40 rounded-3xl relative overflow-hidden flex items-center justify-center shadow-2xl shadow-cyan-500/10">
        <div className="relative w-full h-full">
          <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 via-transparent to-teal-500/10 animate-pulse" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center space-y-6">
              <div className="relative">
                <div className="w-32 h-32 mx-auto relative">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div
                      key={i}
                      className="absolute w-2 h-2 bg-cyan-400 rounded-full animate-ping"
                      style={{
                        top: `${50 + 40 * Math.sin((i / 8) * 2 * Math.PI)}%`,
                        left: `${50 + 40 * Math.cos((i / 8) * 2 * Math.PI)}%`,
                        animationDelay: `${i * 0.1}s`,
                      }}
                    />
                  ))}
                  <div className="absolute inset-0 border-2 border-cyan-400/30 rounded-full animate-spin" />
                </div>
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-medium text-foreground">
                  {t("generatingTitle")}
                </h3>
                <p className="text-muted-foreground">{getPhaseMessage()}</p>
                <div className="w-64 mx-auto">
                  <div className="h-2 bg-foreground/10 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-cyan-400 to-teal-400 rounded-full animate-[indeterminate_1.5s_ease-in-out_infinite] w-1/3" />
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {generationPhase === "submitting" && t("generating")}
                    {generationPhase === "queued" && t("queued")}
                    {generationPhase === "processing" && t("processing")}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-foreground/5 dark:bg-black/40 rounded-2xl lg:rounded-3xl relative overflow-hidden shadow-2xl shadow-cyan-500/10">
      <div className="w-full h-full flex items-center justify-center p-4 lg:p-8">
        {videoUrl ? (
          <div className="relative w-full max-w-4xl aspect-video bg-black rounded-2xl overflow-hidden shadow-2xl">
            <video
              ref={videoRef}
              src={videoUrl}
              className="w-full h-full object-contain"
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleLoadedMetadata}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
            />

            {/* Video player overlay - keep white text on dark gradient */}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4">
              <div className="mb-4">
                <div
                  className="relative h-2 bg-white/20 rounded-full cursor-pointer group"
                  onClick={handleProgressClick}
                >
                  <div
                    className="absolute top-0 left-0 h-full bg-cyan-400 rounded-full transition-all"
                    style={{ width: `${progress}%` }}
                  />
                  <div
                    className="absolute top-0 w-1 h-full bg-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                    style={{
                      left: `${progress}%`,
                      transform: "translateX(-50%)",
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleFrameExtract();
                    }}
                    title="Extract frame"
                  />
                </div>
                <div className="flex justify-between text-xs text-white/70 mt-1">
                  <span>{Math.floor(currentTime)}s</span>
                  <span>{Math.floor(duration)}s</span>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handlePlayPause}
                    className="text-white hover:bg-white/20"
                  >
                    {isPlaying ? (
                      <Pause className="w-4 h-4" />
                    ) : (
                      <Play className="w-4 h-4" />
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      videoRef.current && (videoRef.current.currentTime = 0)
                    }
                    className="text-white hover:bg-white/20"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </Button>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleFrameExtract}
                    className="text-white hover:bg-white/20"
                    title="Extract current frame"
                  >
                    <Scissors className="w-4 h-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleDownload}
                    className="text-white hover:bg-white/20"
                  >
                    <Download className="w-4 h-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleFullscreen}
                    className="text-white hover:bg-white/20"
                  >
                    <Expand className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center space-y-4">
            <div className="w-24 h-24 mx-auto bg-foreground/5 rounded-full flex items-center justify-center">
              <Play className="w-8 h-8 text-muted-foreground/60" />
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-medium text-foreground">
                {t("readyTitle")}
              </h3>
              <p className="text-muted-foreground">{t("readyDesc")}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
