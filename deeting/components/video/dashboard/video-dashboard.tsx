"use client";

import { useState, useCallback, useMemo } from "react";
import { Sparkles, Play } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { useVideoGenerationStore } from "@/store/video-generation-store";
import { useVideoGenerationTasks } from "@/lib/swr/use-video-generation-tasks";
import { normalizeSessionId } from "@/lib/chat/session-id";
import { Button } from "@/components/ui/button";
import { InputSection } from "./input-section";
import { ParameterSettings } from "./parameter-settings";
import { VideoPreviewCanvas } from "./video-preview-canvas";
import { HistoryTimeline } from "./history-timeline";

export default function VideoDashboard() {
  const t = useI18n("video");
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentVideo, setCurrentVideo] = useState<string | null>(null);
  const { sessionId, setSessionId } = useVideoGenerationStore();

  const { items: sessionTasks } = useVideoGenerationTasks(
    {
      size: 12,
      include_outputs: true,
      session_id: sessionId ?? undefined,
    },
    { enabled: Boolean(sessionId) }
  );

  const hasConversation = sessionTasks.length > 0;

  const handleGenerate = useCallback(() => {
    setIsGenerating(true);
    // Mock generation process - in real implementation, this would call the API
    setTimeout(() => {
      setIsGenerating(false);
      setCurrentVideo("mock-video-url");
      // Create a new session if none exists
      if (!sessionId) {
        const newSessionId = normalizeSessionId(Date.now().toString());
        setSessionId(newSessionId);
      }
    }, 3000);
  }, [sessionId, setSessionId]);

  return (
    <div className="flex flex-col lg:flex-row h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 relative overflow-hidden">
      {/* Background noise texture */}
      <div className="absolute inset-0 opacity-20">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(56,189,248,0.1),transparent_50%)] animate-pulse" />
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZGVmcz48cGF0dGVybiBpZD0iZ3JpZCIgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIiBwYXR0ZXJuVW5pdHM9InVzZXJTcGFjZU9uVXNlIj48cGF0aCBkPSJNIDQwIDAgTCAwIDAgMCA0MCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJyZ2JhKDU2LCAxODksIDI0OCwgMC4xKSIgc3Ryb2tlLXdpZHRoPSIxIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2dyaWQpIi8+PC9zdmc+')] opacity-30" />
      </div>

      {/* Left Input Dock - Responsive */}
      <aside className="w-full lg:w-80 m-2 lg:m-4 bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 p-4 lg:p-6 flex flex-col gap-4 lg:gap-6 shadow-2xl shadow-cyan-500/10 relative overflow-hidden">
        {/* Glass morphism glow effect */}
        <div className="absolute -inset-1 bg-gradient-to-r from-cyan-500/20 via-transparent to-teal-500/20 rounded-2xl blur-xl" />

        <div className="relative z-10">
          <h2 className="text-lg lg:text-xl font-medium text-white mb-4 lg:mb-6 flex items-center gap-2">
            <Sparkles className="w-4 lg:w-5 h-4 lg:h-5 text-cyan-400" />
            Create
          </h2>

          <InputSection />
          <ParameterSettings />

          <Button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="w-full mt-auto py-3 bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500 rounded-xl transition-all shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/30 disabled:opacity-50"
          >
            {isGenerating ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                Generating...
              </>
            ) : (
              <>
                <Play className="w-4 h-4 mr-2" />
                Generate Video
              </>
            )}
          </Button>
        </div>
      </aside>

      {/* Main Content Area - Responsive */}
      <main className="flex-1 p-2 lg:p-4 flex flex-col relative z-10 min-h-0">
        <VideoPreviewCanvas
          videoUrl={currentVideo}
          isGenerating={isGenerating}
        />

        {/* Bottom Memory Bridge - Responsive */}
        <div className="h-32 lg:h-48 mt-2 lg:mt-4 overflow-x-auto">
          <HistoryTimeline />
        </div>
      </main>
    </div>
  );
}
