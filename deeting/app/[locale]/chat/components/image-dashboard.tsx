'use client';
import Image from 'next/image';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { X, Wand2, Palette, Image as ImageIcon, SlidersHorizontal, Sparkles } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { useI18n } from '@/hooks/use-i18n';
import { useChatService } from '@/hooks/use-chat-service';
import { createImageGenerationTask, type ImageGenerationOutputItem } from '@/lib/api/image-generation';
import { openApiSSE } from '@/lib/http';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ModelPicker } from '@/components/models/model-picker';
import { cn } from '@/lib/utils';

const RATIO_OPTIONS = ["1:1", "16:9", "9:16"] as const;
type RatioOption = (typeof RATIO_OPTIONS)[number];

export default function ImageDashboard() {
  const t = useI18n('chat');
  const { modelGroups, models, isLoadingModels } = useChatService({
    enabled: true,
    modelCapability: "image",
  });
  const [prompt, setPrompt] = useState("");
  const [ratio, setRatio] = useState<RatioOption>("1:1");
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [output, setOutput] = useState<ImageGenerationOutputItem | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  const selectedModel = useMemo(
    () =>
      models.find((model) => model.provider_model_id === selectedModelId || model.id === selectedModelId),
    [models, selectedModelId]
  );

  const outputUrl = output?.asset_url ?? output?.source_url ?? null;

  useEffect(() => {
    if (!models.length) return;
    const hasSelected = models.some(
      (model) => model.provider_model_id === selectedModelId || model.id === selectedModelId
    );
    if (!hasSelected) {
      setSelectedModelId(models[0].provider_model_id ?? models[0].id);
    }
  }, [models, selectedModelId]);

  useEffect(() => {
    return () => {
      stopRef.current?.();
    };
  }, []);

  const handleGenerate = async () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) return;
    if (!selectedModelId) {
      setError(t("error.modelUnavailable"));
      return;
    }

    setIsGenerating(true);
    setError(null);
    setOutput(null);
    setStatus("queued");

    stopRef.current?.();

    try {
      const task = await createImageGenerationTask({
        model: selectedModel?.id ?? selectedModelId,
        prompt: trimmedPrompt,
        aspect_ratio: ratio,
        num_outputs: 1,
        provider_model_id: selectedModelId,
      });

      stopRef.current = openApiSSE(`/api/v1/internal/images/generations/${task.task_id}/events`, {
        onMessage: (msg) => {
          const data = msg.data;
          if (data === "[DONE]") {
            stopRef.current?.();
            setIsGenerating(false);
            return;
          }
          if (!data || typeof data !== "object") return;
          const payload = data as Record<string, unknown>;
          const type = typeof payload.type === "string" ? payload.type : "";
          if (type === "status") {
            const nextStatus = typeof payload.status === "string" ? payload.status : null;
            if (nextStatus) setStatus(nextStatus);
            if (Array.isArray(payload.outputs) && payload.outputs.length > 0) {
              setOutput(payload.outputs[0] as ImageGenerationOutputItem);
            }
            if (nextStatus === "failed") {
              setError((payload.error_message as string) || t("error.requestFailed"));
              setIsGenerating(false);
            }
            if (nextStatus === "succeeded") {
              setIsGenerating(false);
            }
          }
          if (type === "timeout") {
            setError(t("error.requestFailed"));
            setIsGenerating(false);
          }
          if (type === "error") {
            setError((payload.message as string) || t("error.requestFailed"));
            setIsGenerating(false);
          }
        },
        onError: () => {
          setError(t("error.requestFailed"));
          setIsGenerating(false);
        },
      });
    } catch {
      setError(t("error.requestFailed"));
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex h-full w-full">
      {/* ZONE 1: Style & Tools (Left Sidebar) */}
      <div className="w-16 border-r border-black/5 dark:border-white/5 flex flex-col items-center py-4 gap-4 bg-black/[0.02] dark:bg-white/[0.02]">
        <div className="w-8 h-8 rounded-lg bg-purple-500/10 dark:bg-purple-500/20 flex items-center justify-center text-purple-600 dark:text-purple-400 mb-2">
          <Wand2 className="w-4 h-4" />
        </div>

        <ToolbarButton icon={<Palette className="w-4 h-4" />} label={t("image.toolbar.style")} active />
        <ToolbarButton icon={<ImageIcon className="w-4 h-4" />} label={t("image.toolbar.refImage")} />
        <ToolbarButton icon={<SlidersHorizontal className="w-4 h-4" />} label={t("image.toolbar.settings")} />

        <div className="mt-auto">
          <Link href="/chat" scroll={false}>
            <Button
              variant="ghost"
              size="icon"
              className="text-black/20 dark:text-white/20 hover:text-black dark:hover:text-white transition-colors hover:bg-black/5 dark:hover:bg-white/10"
              aria-label={t("controls.menu")}
            >
              <X className="w-4 h-4" />
            </Button>
          </Link>
        </div>
      </div>

      {/* ZONE 2: Main Prompt Area (Center) */}
      <div className="flex-1 flex flex-col p-5 gap-4">
        <div className="flex-1 flex flex-col">
          <Label className="text-xs font-bold text-purple-500/80 dark:text-purple-400/80 mb-2 uppercase tracking-widest">
            {t("image.prompt.label")}
          </Label>
          <Textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={t("image.prompt.placeholder")}
            className="flex-1 bg-transparent text-black/90 dark:text-white/90 resize-none font-medium text-lg placeholder-black/10 dark:placeholder-white/10 leading-relaxed border-0 shadow-none focus-visible:ring-0"
            autoFocus
          />
        </div>

        {error ? (
          <Alert variant="destructive" className="border border-red-500/20 bg-red-500/10">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {outputUrl ? (
          <div className="relative w-full max-w-xl aspect-square border border-black/5 dark:border-white/10 rounded-2xl overflow-hidden bg-black/[0.02] dark:bg-white/[0.02]">
            <Image
              src={outputUrl}
              alt={t("input.image.alt")}
              fill
              sizes="(max-width: 1024px) 100vw, 512px"
              className="object-cover"
            />
          </div>
        ) : null}

        {/* Inline Hints */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
          <Badge className="text-[10px] font-medium bg-black/5 dark:bg-white/5 text-black/60 dark:text-white/60">
            {t("image.badges.cyberpunk")}
          </Badge>
          <Badge className="text-[10px] font-medium bg-black/5 dark:bg-white/5 text-black/60 dark:text-white/60">
            {t("image.badges.cinematicLighting")}
          </Badge>
          <Badge className="text-[10px] font-medium bg-black/5 dark:bg-white/5 text-black/60 dark:text-white/60">
            {t("image.badges.resolution")}
          </Badge>
          <Badge
            variant="outline"
            className="text-[10px] font-medium text-black/40 dark:text-white/40 border-dashed border-black/20 dark:border-white/20"
          >
            {t("image.badges.addNegative")}
          </Badge>
        </div>
      </div>

      {/* ZONE 3: Parameters & Action (Right Sidebar) */}
      <div className="w-80 border-l border-black/5 dark:border-white/5 bg-black/[0.01] dark:bg-white/[0.01] p-4 flex flex-col gap-4">
        {/* Aspect Ratio Selector */}
        <div className="space-y-2">
          <span className="text-xs text-black/40 dark:text-white/40 font-medium uppercase tracking-wider">
            {t("image.aspectRatio")}
          </span>
          <div className="grid grid-cols-3 gap-2">
            {RATIO_OPTIONS.map((option) => (
              <Button
                key={option}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setRatio(option)}
                className={cn(
                  "h-8 rounded-lg border text-[10px] font-medium transition-all px-0",
                  ratio === option
                    ? "bg-purple-500/10 dark:bg-purple-500/20 border-purple-500/50 text-purple-600 dark:text-purple-300"
                    : "border-black/5 dark:border-white/5 text-black/40 dark:text-white/20 hover:border-black/20 dark:hover:border-white/20 hover:text-black/80 dark:hover:text-white/60"
                )}
              >
                {option}
              </Button>
            ))}
          </div>
        </div>

        <ModelPicker
          value={selectedModelId ?? ""}
          onChange={(value) => setSelectedModelId(value)}
          modelGroups={modelGroups}
          title={t("model.label")}
          subtitle={t("model.placeholder")}
          searchPlaceholder={t("model.searchPlaceholder")}
          emptyText={t("error.modelUnavailable")}
          noResultsText={t("model.noResults")}
          disabled={isLoadingModels}
          showHeader
          className="bg-transparent shadow-none border-black/10 dark:border-white/10"
          scrollAreaClassName="h-64"
        />

        {status ? (
          <Badge
            variant="secondary"
            className="self-start text-[10px] uppercase tracking-[0.2em] bg-black/5 dark:bg-white/10 text-black/40 dark:text-white/50"
          >
            {status}
          </Badge>
        ) : null}

        <Button
          type="button"
          onClick={handleGenerate}
          disabled={isGenerating || !prompt.trim() || !selectedModelId}
          className="mt-auto w-full h-12 relative group rounded-xl overflow-hidden shadow-lg shadow-purple-500/20 bg-transparent"
        >
          <span className="absolute inset-0 bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 transition-transform duration-300 group-hover:scale-110" />
          <span className="absolute inset-0 opacity-0 group-hover:opacity-100 bg-white/20 transition-opacity" />
          <span className="relative z-10 text-white font-bold text-sm tracking-wide flex items-center justify-center gap-2">
            {t("image.generate")} <Sparkles className="w-3 h-3 fill-white/50" />
          </span>
        </Button>
      </div>
    </div>
  );
}

function ToolbarButton({
  icon,
  label,
  active = false,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      className={cn(
        "p-2.5 rounded-xl transition-all",
        active
          ? "bg-black/10 dark:bg-white/10 text-black dark:text-white shadow-inner"
          : "text-black/30 dark:text-white/30 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5"
      )}
    >
      {icon}
    </Button>
  );
}
