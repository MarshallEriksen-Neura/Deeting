"use client";

import { useState } from "react";
import Image from "next/image";
import { Play, Clock, Loader2 } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { GlassCard } from "@/components/ui/glass-card";
import { Progress } from "@/components/ui/progress";

// Mock data for history items
const mockHistoryItems = [
  {
    id: "1",
    thumbnail: "/api/placeholder/120/80",
    title: "Ocean waves at sunset",
    duration: 5.2,
    createdAt: "2 hours ago",
    status: "completed",
  },
  {
    id: "2",
    thumbnail: "/api/placeholder/120/80",
    title: "City lights timelapse",
    duration: 8.1,
    createdAt: "5 hours ago",
    status: "completed",
  },
  {
    id: "3",
    thumbnail: "/api/placeholder/120/80",
    title: "Abstract geometric motion",
    duration: 3.7,
    createdAt: "1 day ago",
    status: "processing",
    progress: 75,
  },
  {
    id: "4",
    thumbnail: "/api/placeholder/120/80",
    title: "Nature scene transition",
    duration: 6.4,
    createdAt: "2 days ago",
    status: "completed",
  },
  {
    id: "5",
    thumbnail: "/api/placeholder/120/80",
    title: "Particle system animation",
    duration: 4.9,
    createdAt: "3 days ago",
    status: "completed",
  },
  {
    id: "6",
    thumbnail: "/api/placeholder/120/80",
    title: "Light painting effect",
    duration: 7.3,
    createdAt: "1 week ago",
    status: "completed",
  },
];

export function HistoryTimeline() {
  const t = useI18n("video");
  const [selectedItem, setSelectedItem] = useState<string | null>(null);

  return (
    <div className="h-full bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 p-3 lg:p-4 overflow-hidden">
      <div className="flex items-center justify-between mb-3 lg:mb-4">
        <h3 className="text-base lg:text-lg font-medium text-white flex items-center gap-2">
          <Clock className="w-4 lg:w-5 h-4 lg:h-5 text-cyan-400" />
          Memory Bridge
        </h3>
        <span className="text-xs text-white/60">{mockHistoryItems.length} videos</span>
      </div>

      <div className="overflow-y-auto h-full pb-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 lg:gap-3">
          {mockHistoryItems.map((item) => (
            <GlassCard
              key={item.id}
              className={`relative cursor-pointer transition-all hover:scale-105 ${
                selectedItem === item.id ? 'ring-2 ring-cyan-400' : ''
              }`}
              onClick={() => setSelectedItem(item.id)}
              blur="sm"
              theme="surface"
              hover="lift"
              padding="sm"
            >
              <div className="relative aspect-video bg-black/20 rounded-lg overflow-hidden mb-2">
                <Image
                  src={item.thumbnail}
                  alt={item.title}
                  fill
                  className="object-cover"
                />

                {/* Status overlay */}
                {item.status === "processing" && (
                  <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                    <div className="text-center space-y-2">
                      <Loader2 className="w-6 h-6 animate-spin text-cyan-400 mx-auto" />
                      <div className="w-full bg-white/20 rounded-full h-1">
                        <div
                          className="bg-cyan-400 h-1 rounded-full transition-all"
                          style={{ width: `${item.progress}%` }}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Play overlay */}
                {item.status === "completed" && (
                  <div className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Play className="w-8 h-8 text-white" />
                  </div>
                )}

                {/* Duration badge */}
                <div className="absolute bottom-1 right-1 bg-black/60 text-white text-xs px-1 py-0.5 rounded">
                  {item.duration}s
                </div>
              </div>

              <div className="space-y-1">
                <h4 className="text-sm font-medium text-white line-clamp-2">
                  {item.title}
                </h4>
                <p className="text-xs text-white/60">
                  {item.createdAt}
                </p>
              </div>

              {/* Processing progress ring for grid items */}
              {item.status === "processing" && (
                <div className="absolute -top-1 -right-1 w-6 h-6">
                  <svg className="w-6 h-6 transform -rotate-90" viewBox="0 0 24 24">
                    <circle
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="2"
                      fill="none"
                      className="text-white/20"
                    />
                    <circle
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="2"
                      fill="none"
                      strokeDasharray={`${2 * Math.PI * 10}`}
                      strokeDashoffset={`${2 * Math.PI * 10 * (1 - (item.progress || 0) / 100)}`}
                      className="text-cyan-400 transition-all"
                    />
                  </svg>
                </div>
              )}
            </GlassCard>
          ))}
        </div>
      </div>
    </div>
  );
}