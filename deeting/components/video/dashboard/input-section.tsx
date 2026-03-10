"use client";

import { useCallback } from "react";
import {
  Upload,
  Image as ImageIcon,
  Sparkles,
  Music,
  Film,
  ImagePlus,
  X,
} from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { useVideoGenerationStore } from "@/store/video-generation-store";
import { resolveVideoInputUrl, type DesktopVideoMediaSlot } from "@/lib/video/desktop-media-upload";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

type MediaSlotConfig = {
  type: string;
  label: string;
  dropText: string;
  accept: string;
  icon: typeof ImageIcon;
  value: string | null;
  onChange: (url: string | null) => void;
};

function MediaUploadSlot({
  config,
  compact,
}: {
  config: MediaSlotConfig;
  compact?: boolean;
}) {
  const inputId = `media-upload-${config.type}`;

  const handleUpload = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        void resolveVideoInputUrl(file, config.type as DesktopVideoMediaSlot).then((url) => {
          config.onChange(url);
        });
      }
    },
    [config]
  );

  const handleClear = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      config.onChange(null);
    },
    [config]
  );

  const Icon = config.icon;

  if (compact) {
    return (
      <div
        className="relative border border-dashed border-foreground/20 rounded-xl p-3 text-center hover:border-cyan-400/50 transition-colors cursor-pointer group"
        onClick={() => document.getElementById(inputId)?.click()}
      >
        {config.value ? (
          <div className="relative flex items-center gap-2">
            <Icon className="w-4 h-4 text-cyan-400 shrink-0" />
            <span className="text-xs text-foreground/70 truncate flex-1">
              {config.label}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0 hover:bg-red-500/20 shrink-0"
              onClick={handleClear}
            >
              <X className="w-3 h-3 text-red-400" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-cyan-500/10 rounded-lg flex items-center justify-center shrink-0">
              <Icon className="w-4 h-4 text-cyan-400" />
            </div>
            <div className="text-left min-w-0">
              <div className="text-xs font-medium text-foreground/80 truncate">
                {config.label}
              </div>
              <div className="text-[10px] text-muted-foreground truncate">
                {config.dropText}
              </div>
            </div>
          </div>
        )}
        <input
          id={inputId}
          type="file"
          accept={config.accept}
          onChange={handleUpload}
          className="hidden"
        />
      </div>
    );
  }

  // Full-size slot (for single image when no input_types)
  return (
    <div
      className="relative border-2 border-dashed border-foreground/20 rounded-2xl p-6 lg:p-8 text-center hover:border-cyan-400/50 transition-colors cursor-pointer group"
      onClick={() => document.getElementById(inputId)?.click()}
    >
      {config.value ? (
        <div className="relative">
          {config.type === "image" || config.type === "end_image" ? (
            <img
              src={config.value}
              alt={config.label}
              className="w-full h-24 lg:h-32 object-cover rounded-xl"
            />
          ) : (
            <div className="w-full h-24 lg:h-32 bg-cyan-500/10 rounded-xl flex items-center justify-center">
              <Icon className="w-8 h-8 text-cyan-400" />
            </div>
          )}
          <div className="absolute inset-0 bg-black/20 rounded-xl flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <Upload className="w-6 h-6 text-white" />
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="absolute top-1 right-1 h-6 w-6 p-0 bg-black/40 hover:bg-red-500/60 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={handleClear}
          >
            <X className="w-3 h-3 text-white" />
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="w-10 lg:w-12 h-10 lg:h-12 mx-auto bg-cyan-500/20 rounded-full flex items-center justify-center">
            <Icon className="w-5 lg:w-6 h-5 lg:h-6 text-cyan-400" />
          </div>
          <div className="text-xs lg:text-sm text-muted-foreground">
            {config.dropText}
          </div>
        </div>
      )}
      <input
        id={inputId}
        type="file"
        accept={config.accept}
        onChange={handleUpload}
        className="hidden"
      />
    </div>
  );
}

interface InputSectionProps {
  inputTypes?: string[] | null;
}

export function InputSection({ inputTypes }: InputSectionProps) {
  const t = useI18n("video");
  const {
    prompt,
    setPrompt,
    imageUrl,
    setImageUrl,
    audioUrl,
    setAudioUrl,
    videoUrl,
    setVideoUrl,
    endImageUrl,
    setEndImageUrl,
  } = useVideoGenerationStore();

  // Determine which media slots to show based on model's input_types
  const hasInputTypes = inputTypes && inputTypes.length > 0;
  const showImage = !hasInputTypes || inputTypes.includes("image");
  const showAudio = hasInputTypes && inputTypes.includes("audio");
  const showVideo = hasInputTypes && inputTypes.includes("video");
  const showEndImage = hasInputTypes && inputTypes.includes("end_image");

  const activeSlotCount = [showImage, showAudio, showVideo, showEndImage].filter(Boolean).length;
  const useCompactLayout = activeSlotCount > 1;

  const mediaSlots: MediaSlotConfig[] = [];

  if (showImage) {
    mediaSlots.push({
      type: "image",
      label: t("referenceImage"),
      dropText: t("dropOrClick"),
      accept: "image/*",
      icon: ImageIcon,
      value: imageUrl,
      onChange: setImageUrl,
    });
  }
  if (showAudio) {
    mediaSlots.push({
      type: "audio",
      label: t("referenceAudio"),
      dropText: t("dropOrClickAudio"),
      accept: "audio/*",
      icon: Music,
      value: audioUrl,
      onChange: setAudioUrl,
    });
  }
  if (showVideo) {
    mediaSlots.push({
      type: "video",
      label: t("referenceVideo"),
      dropText: t("dropOrClickVideo"),
      accept: "video/*",
      icon: Film,
      value: videoUrl,
      onChange: setVideoUrl,
    });
  }
  if (showEndImage) {
    mediaSlots.push({
      type: "end_image",
      label: t("endFrameImage"),
      dropText: t("dropOrClickEndImage"),
      accept: "image/*",
      icon: ImagePlus,
      value: endImageUrl,
      onChange: setEndImageUrl,
    });
  }

  return (
    <div className="space-y-4 lg:space-y-6">
      {/* Media Input Slots */}
      {mediaSlots.length > 0 && (
        <div className="space-y-3">
          {useCompactLayout ? (
            <>
              <label className="text-sm font-medium text-foreground/90">
                {t("mediaInputs")}
              </label>
              <div className="grid grid-cols-1 gap-2">
                {mediaSlots.map((slot) => (
                  <MediaUploadSlot
                    key={slot.type}
                    config={slot}
                    compact
                  />
                ))}
              </div>
            </>
          ) : (
            <>
              <label className="text-sm font-medium text-foreground/90">
                {mediaSlots[0].label}
              </label>
              <MediaUploadSlot config={mediaSlots[0]} />
            </>
          )}
        </div>
      )}

      {/* Prompt Laboratory */}
      <div className="space-y-3">
        <label className="text-sm font-medium text-foreground/90 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-cyan-400" />
          {t("prompt")}
        </label>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t("promptPlaceholder")}
          className="min-h-[100px] lg:min-h-[120px] bg-foreground/5 border-foreground/10 text-foreground placeholder:text-muted-foreground focus:border-cyan-400/50 resize-none text-sm"
        />
        <div className="text-xs text-muted-foreground">{t("promptHint")}</div>
      </div>
    </div>
  );
}
