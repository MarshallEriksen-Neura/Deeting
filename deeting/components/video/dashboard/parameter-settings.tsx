"use client";

import { useState } from "react";
import { ChevronDown, Move3D, Camera, Square, RectangleHorizontal, RectangleVertical } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { GlassCard } from "@/components/ui/glass-card";

type AspectRatio = "16:9" | "9:16" | "1:1";

export function ParameterSettings() {
  const t = useI18n("video");
  const [isOpen, setIsOpen] = useState(false);
  const [motionScore, setMotionScore] = useState([5]);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");

  const aspectRatioOptions = [
    { value: "16:9" as const, icon: RectangleHorizontal, label: "16:9" },
    { value: "9:16" as const, icon: RectangleVertical, label: "9:16" },
    { value: "1:1" as const, icon: Square, label: "1:1" },
  ];

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          className="w-full justify-between text-white/90 hover:bg-white/10 hover:text-white"
        >
          <span className="flex items-center gap-2">
            <Move3D className="w-4 h-4" />
            Parameters
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </Button>
      </CollapsibleTrigger>

      <CollapsibleContent className="space-y-6 pt-4">
        {/* Motion Score */}
        <div className="space-y-3">
          <label className="text-sm font-medium text-white/90 flex items-center gap-2">
            <Move3D className="w-4 h-4 text-cyan-400" />
            Motion Intensity
          </label>
          <div className="px-2">
            <Slider
              value={motionScore}
              onValueChange={setMotionScore}
              max={10}
              min={0}
              step={1}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-white/60 mt-1">
              <span>Static</span>
              <span className="font-medium text-cyan-400">{motionScore[0]}</span>
              <span>Dynamic</span>
            </div>
          </div>
        </div>

        {/* Camera Control */}
        <div className="space-y-3">
          <label className="text-sm font-medium text-white/90 flex items-center gap-2">
            <Camera className="w-4 h-4 text-cyan-400" />
            Camera Control
          </label>
          <div className="grid grid-cols-3 gap-1 lg:gap-2">
            {[
              { icon: "↗", label: "Up-Right" },
              { icon: "↑", label: "Up" },
              { icon: "↖", label: "Up-Left" },
              { icon: "→", label: "Right" },
              { icon: "●", label: "Center" },
              { icon: "←", label: "Left" },
              { icon: "↙", label: "Down-Right" },
              { icon: "↓", label: "Down" },
              { icon: "↘", label: "Down-Left" },
            ].map((control, index) => (
              <Button
                key={index}
                variant="outline"
                size="sm"
                className="aspect-square bg-white/5 border-white/10 text-white hover:bg-cyan-500/20 hover:border-cyan-400/50 text-xs lg:text-sm"
              >
                {control.icon}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-1 lg:gap-2">
            <Button
              variant="outline"
              size="sm"
              className="bg-white/5 border-white/10 text-white hover:bg-cyan-500/20 hover:border-cyan-400/50 text-xs lg:text-sm"
            >
              Zoom In
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="bg-white/5 border-white/10 text-white hover:bg-cyan-500/20 hover:border-cyan-400/50 text-xs lg:text-sm"
            >
              Zoom Out
            </Button>
          </div>
        </div>

        {/* Aspect Ratio */}
        <div className="space-y-3">
          <label className="text-sm font-medium text-white/90">Aspect Ratio</label>
          <div className="grid grid-cols-3 gap-2">
            {aspectRatioOptions.map((option) => {
              const Icon = option.icon;
              return (
                <Button
                  key={option.value}
                  variant={aspectRatio === option.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => setAspectRatio(option.value)}
                  className={`flex flex-col items-center gap-1 h-auto py-3 ${
                    aspectRatio === option.value
                      ? "bg-cyan-600 hover:bg-cyan-500"
                      : "bg-white/5 border-white/10 text-white hover:bg-cyan-500/20 hover:border-cyan-400/50"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="text-xs">{option.label}</span>
                </Button>
              );
            })}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}