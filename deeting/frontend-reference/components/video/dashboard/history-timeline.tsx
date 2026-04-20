"use client";

import { useState } from "react";
import Image from "next/image";
import { Play, Clock, Loader2, Film, RefreshCw } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { GlassCard } from "@/ui/common/glass-card";
import type { VideoGenerationTaskListItem } from "@/lib/api/video-generation";

interface HistoryTimelineProps {
  tasks: VideoGenerationTaskListItem[];
  isLoading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onSelectTask: (taskId: string) => void;
  onRegenerate?: (task: VideoGenerationTaskListItem) => void;
  regeneratingTaskId?: string | null;
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function StatusBadge({ status, t }: { status: string; t: (key: string) => string }) {
  const config: Record<string, { color: string; label: string }> = {
    completed: { color: "text-green-400", label: t("completed") },
    processing: { color: "text-cyan-400", label: t("processing") },
    queued: { color: "text-yellow-400", label: t("queued") },
    failed: { color: "text-red-400", label: t("failed") },
  };
  const { color, label } = config[status] || { color: "text-muted-foreground", label: status };
  return <span className={`text-xs ${color}`}>{label}</span>;
}

export function HistoryTimeline({
  tasks,
  isLoading,
  hasMore,
  onLoadMore,
  onSelectTask,
  onRegenerate,
  regeneratingTaskId,
}: HistoryTimelineProps) {
  const t = useI18n("video");
  const [selectedItem, setSelectedItem] = useState<string | null>(null);

  const handleSelect = (taskId: string) => {
    setSelectedItem(taskId);
    onSelectTask(taskId);
  };

  if (!isLoading && tasks.length === 0) {
    return (
      <div className="h-full bg-foreground/5 backdrop-blur-xl rounded-2xl border border-foreground/10 p-3 lg:p-4 flex items-center justify-center">
        <div className="text-center space-y-2">
          <Film className="w-8 h-8 text-muted-foreground/50 mx-auto" />
          <p className="text-sm text-muted-foreground">{t("noHistory")}</p>
          <p className="text-xs text-muted-foreground/70">{t("noHistoryDesc")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full bg-foreground/5 backdrop-blur-xl rounded-2xl border border-foreground/10 p-3 lg:p-4 overflow-hidden">
      <div className="flex items-center justify-between mb-3 lg:mb-4">
        <h3 className="text-base lg:text-lg font-medium text-foreground flex items-center gap-2">
          <Clock className="w-4 lg:w-5 h-4 lg:h-5 text-cyan-400" />
          {t("history")}
        </h3>
        <span className="text-xs text-muted-foreground">
          {t("historyCount").replace("{count}", String(tasks.length))}
        </span>
      </div>

      <div className="overflow-y-auto h-full pb-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 lg:gap-3">
          {isLoading &&
            tasks.length === 0 &&
            Array.from({ length: 6 }).map((_, i) => (
              <div
                key={`skeleton-${i}`}
                className="animate-pulse bg-foreground/5 rounded-xl aspect-video"
              />
            ))}

          {tasks.map((task) => {
            const thumbnailUrl =
              task.preview?.cover_url || task.preview?.asset_url || null;

            return (
              <GlassCard
                key={task.task_id}
                className={`relative cursor-pointer transition-all hover:scale-105 ${
                  selectedItem === task.task_id ? "ring-2 ring-cyan-400" : ""
                }`}
                onClick={() => handleSelect(task.task_id)}
                blur="sm"
                theme="surface"
                hover="lift"
                padding="sm"
              >
                <div className="relative aspect-video bg-black/20 rounded-lg overflow-hidden mb-2">
                  {thumbnailUrl ? (
                    <Image
                      src={thumbnailUrl}
                      alt={task.prompt || "Video"}
                      fill
                      className="object-cover"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-cyan-500/10 to-teal-500/10">
                      <Film className="w-6 h-6 text-muted-foreground/50" />
                    </div>
                  )}

                  {task.status === "processing" && (
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                      <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
                    </div>
                  )}

                  {task.status === "completed" && (
                    <div className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center">
                      <Play className="w-8 h-8 text-white" />
                    </div>
                  )}

                  {task.preview?.duration != null && (
                    <div className="absolute bottom-1 right-1 bg-black/60 text-white text-xs px-1 py-0.5 rounded">
                      {task.preview.duration.toFixed(1)}s
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <h4 className="text-sm font-medium text-foreground line-clamp-2">
                    {task.prompt || task.model}
                  </h4>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      {formatRelativeTime(task.created_at)}
                    </p>
                    <StatusBadge status={task.status} t={t} />
                  </div>
                </div>

                {task.status === "failed" && (
                  <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center">
                    <span className="text-white text-xs font-bold">!</span>
                  </div>
                )}

                {onRegenerate && (task.status === "completed" || task.status === "failed") ? (
                  <button
                    className="absolute top-1 left-1 w-6 h-6 bg-black/50 hover:bg-black/70 rounded-full flex items-center justify-center transition-colors z-10"
                    title="Regenerate"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRegenerate(task);
                    }}
                    disabled={regeneratingTaskId === task.task_id}
                  >
                    <RefreshCw className={`w-3 h-3 text-white ${regeneratingTaskId === task.task_id ? "animate-spin" : ""}`} />
                  </button>
                ) : null}
              </GlassCard>
            );
          })}

          {hasMore && (
            <button
              onClick={onLoadMore}
              className="aspect-video bg-foreground/5 rounded-xl border border-dashed border-foreground/20 flex items-center justify-center hover:bg-foreground/10 transition-colors"
            >
              <span className="text-xs text-muted-foreground">Load more</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
