"use client";

import { ChevronDown, Move3D, Camera, Square, RectangleHorizontal, RectangleVertical } from "lucide-react";
import { useState } from "react";
import { useI18n } from "@/hooks/use-i18n";
import {
  useVideoGenerationStore,
  type CameraDirection,
} from "@/store/video-generation-store";
import { Slider } from "@/ui/shadcn/slider";
import { Button } from "@/ui/shadcn/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/ui/shadcn/collapsible";

type AspectRatio = "16:9" | "9:16" | "1:1";

const CAMERA_DIRECTIONS: { icon: string; value: CameraDirection }[] = [
  { icon: "↗", value: "up-right" },
  { icon: "↑", value: "up" },
  { icon: "↖", value: "up-left" },
  { icon: "→", value: "right" },
  { icon: "●", value: "center" },
  { icon: "←", value: "left" },
  { icon: "↙", value: "down-left" },
  { icon: "↓", value: "down" },
  { icon: "↘", value: "down-right" },
];

const ASPECT_RATIO_OPTIONS: {
  value: AspectRatio;
  icon: typeof RectangleHorizontal;
  label: string;
}[] = [
  { value: "16:9", icon: RectangleHorizontal, label: "16:9" },
  { value: "9:16", icon: RectangleVertical, label: "9:16" },
  { value: "1:1", icon: Square, label: "1:1" },
];

export function ParameterSettings() {
  const t = useI18n("video");
  const [isOpen, setIsOpen] = useState(false);
  const {
    motionBucketId,
    setMotionBucketId,
    ratio,
    setRatio,
    cameraDirection,
    setCameraDirection,
  } = useVideoGenerationStore();

  // Map motionBucketId (0-255) to display scale (0-10) for slider
  const motionDisplay = Math.round((motionBucketId / 255) * 10);

  const handleMotionChange = (value: number[]) => {
    setMotionBucketId(Math.round((value[0] / 10) * 255));
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          className="w-full justify-between text-foreground/90 hover:bg-foreground/10 hover:text-foreground"
        >
          <span className="flex items-center gap-2">
            <Move3D className="w-4 h-4" />
            {t("parameters")}
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </Button>
      </CollapsibleTrigger>

      <CollapsibleContent className="space-y-6 pt-4">
        {/* Motion Score */}
        <div className="space-y-3">
          <label className="text-sm font-medium text-foreground/90 flex items-center gap-2">
            <Move3D className="w-4 h-4 text-cyan-400" />
            {t("motionIntensity")}
          </label>
          <div className="px-2">
            <Slider
              value={[motionDisplay]}
              onValueChange={handleMotionChange}
              max={10}
              min={0}
              step={1}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>{t("motionStatic")}</span>
              <span className="font-medium text-cyan-400">{motionDisplay}</span>
              <span>{t("motionDynamic")}</span>
            </div>
          </div>
        </div>

        {/* Camera Control */}
        <div className="space-y-3">
          <label className="text-sm font-medium text-foreground/90 flex items-center gap-2">
            <Camera className="w-4 h-4 text-cyan-400" />
            {t("cameraControl")}
          </label>
          <div className="grid grid-cols-3 gap-1 lg:gap-2">
            {CAMERA_DIRECTIONS.map((control) => (
              <Button
                key={control.value}
                variant="outline"
                size="sm"
                onClick={() => setCameraDirection(control.value)}
                className={`aspect-square text-xs lg:text-sm ${
                  cameraDirection === control.value
                    ? "bg-cyan-600 border-cyan-400 text-white hover:bg-cyan-500"
                    : "bg-foreground/5 border-foreground/10 text-foreground hover:bg-cyan-500/20 hover:border-cyan-400/50"
                }`}
              >
                {control.icon}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-1 lg:gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCameraDirection("zoom-in")}
              className={`text-xs lg:text-sm ${
                cameraDirection === "zoom-in"
                  ? "bg-cyan-600 border-cyan-400 text-white hover:bg-cyan-500"
                  : "bg-foreground/5 border-foreground/10 text-foreground hover:bg-cyan-500/20 hover:border-cyan-400/50"
              }`}
            >
              {t("zoomIn")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCameraDirection("zoom-out")}
              className={`text-xs lg:text-sm ${
                cameraDirection === "zoom-out"
                  ? "bg-cyan-600 border-cyan-400 text-white hover:bg-cyan-500"
                  : "bg-foreground/5 border-foreground/10 text-foreground hover:bg-cyan-500/20 hover:border-cyan-400/50"
              }`}
            >
              {t("zoomOut")}
            </Button>
          </div>
        </div>

        {/* Aspect Ratio */}
        <div className="space-y-3">
          <label className="text-sm font-medium text-foreground/90">{t("aspectRatio")}</label>
          <div className="grid grid-cols-3 gap-2">
            {ASPECT_RATIO_OPTIONS.map((option) => {
              const Icon = option.icon;
              return (
                <Button
                  key={option.value}
                  variant={ratio === option.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => setRatio(option.value)}
                  className={`flex flex-col items-center gap-1 h-auto py-3 ${
                    ratio === option.value
                      ? "bg-cyan-600 hover:bg-cyan-500"
                      : "bg-foreground/5 border-foreground/10 text-foreground hover:bg-cyan-500/20 hover:border-cyan-400/50"
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
