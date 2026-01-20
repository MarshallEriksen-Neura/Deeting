'use client';
import Image from 'next/image';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { X, Palette, Image as ImageIcon, SlidersHorizontal, Sparkles, ImagePlus, Dices, Plus, MessageSquare, Terminal } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useI18n } from '@/hooks/use-i18n';
import { useChatService } from '@/hooks/use-chat-service';
import { createImageGenerationTask, type ImageGenerationOutputItem } from '@/lib/api/image-generation';
import { openApiSSE } from '@/lib/http';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useImageGenerationStore } from '@/store/image-generation-store';
import { StatusStream, HolographicPulse, useStepProgress } from './status-visuals';
import { buildImageAttachments, UPLOAD_ERROR_CODES } from '@/lib/chat/attachments';
import { createSessionId, normalizeSessionId } from '@/lib/chat/session-id';
import type { ChatImageAttachment } from '@/lib/chat/message-content';
import { ImageLightbox } from '@/components/ui/image-lightbox';
import { useImageGenerationTasks } from '@/lib/swr/use-image-generation-tasks';

const RATIO_OPTIONS = ["1:1", "16:9", "9:16"] as const;
type RatioOption = (typeof RATIO_OPTIONS)[number];


export default function ImageDashboard() {
  const t = useI18n('chat');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { models } = useChatService({
    enabled: true,
    modelCapability: "image_generation",
  });
  const [prompt, setPrompt] = useState("");
  const [ratio, setRatio] = useState<RatioOption>("1:1");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [output, setOutput] = useState<ImageGenerationOutputItem | null>(null);
  const [attachments, setAttachments] = useState<ChatImageAttachment[]>([]);
  
  // Advanced Settings
  const [numOutputs, setNumOutputs] = useState(1);
  const [steps, setSteps] = useState(30);
  const [guidance, setGuidance] = useState(7.5);
  const [seed, setSeed] = useState<number | undefined>();

  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const stopRef = useRef<(() => void) | null>(null);
  const { selectedModelId, setSelectedModelId, sessionId, setSessionId } = useImageGenerationStore();

  const querySessionId = useMemo(
    () => normalizeSessionId(searchParams?.get("session") ?? null),
    [searchParams]
  );

  useEffect(() => {
    if (!querySessionId) return;
    if (querySessionId !== sessionId) {
      setSessionId(querySessionId);
    }
  }, [querySessionId, sessionId, setSessionId]);

  useEffect(() => {
    if (!sessionId) return;
    const params = new URLSearchParams(searchParams?.toString());
    if (params.get("session") === sessionId) return;
    params.set("session", sessionId);
    const basePath = pathname || "/chat/create/image";
    const query = params.toString();
    const url = query ? `${basePath}?${query}` : basePath;
    router.replace(url);
  }, [pathname, router, searchParams, sessionId]);

  const ensureSessionId = () => {
    if (sessionId) return sessionId;
    const nextId = createSessionId();
    setSessionId(nextId);
    return nextId;
  };

  const selectedModel = useMemo(
    () =>
      models.find((model) => model.provider_model_id === selectedModelId || model.id === selectedModelId),
    [models, selectedModelId]
  );

  const outputUrl = output?.asset_url ?? output?.source_url ?? null;

  const {
    items: sessionTasks,
    isLoadingMore: isLoadingSessionTasks,
  } = useImageGenerationTasks(
    {
      size: 12,
      include_outputs: true,
      session_id: sessionId ?? undefined,
    },
    { enabled: Boolean(sessionId) }
  );

  const sessionPreviews = useMemo(() => {
    return sessionTasks
      .map((task) => ({
        task,
        previewUrl: task.preview?.asset_url ?? task.preview?.source_url ?? null,
      }))
      .filter((item) => Boolean(item.previewUrl));
  }, [sessionTasks]);

  useEffect(() => {
    if (isGenerating) return;
    if (outputUrl) return;
    if (!sessionPreviews.length) return;
    const firstPreview = sessionPreviews[0]?.task.preview;
    if (firstPreview) {
      setOutput(firstPreview as ImageGenerationOutputItem);
    }
  }, [isGenerating, outputUrl, sessionPreviews]);

  // Define steps for image generation
  const stepsVisual = useMemo(() => [
    { key: "queue", label: t("status.flow.queue") },
    { key: "process", label: t("status.flow.process") },
    { key: "refine", label: t("status.flow.refine") },
    { key: "finish", label: t("status.flow.finish") },
  ], [t]);

  // Simulate progress when running
  const timerStep = useStepProgress(isGenerating, stepsVisual.length);

  // Determine active step index
  const activeStep = useMemo(() => {
    if (status === 'succeeded') return 3; // Finish
    if (status === 'failed') return 0;
    if (status === 'queued') return 0; // Queue
    if (status === 'running') {
      // While running, ensure we are at least at "process" (1)
      // and use timer to simulate progress through refine/finish
      return Math.max(1, timerStep);
    }
    return 0;
  }, [status, timerStep]);

  useEffect(() => {
    if (!models.length) return;
    const hasSelected = models.some(
      (model) => model.provider_model_id === selectedModelId || model.id === selectedModelId
    );
    if (!hasSelected) {
      setSelectedModelId(models[0].provider_model_id ?? models[0].id);
    }
  }, [models, selectedModelId, setSelectedModelId]);

  useEffect(() => {
    return () => {
      stopRef.current?.();
    };
  }, []);

  const handleFiles = async (files: File[]) => {
    if (!files.length) return;
    setError(null);
    const result = await buildImageAttachments(files);
    
    if (result.skipped > 0 && result.attachments.length === 0) {
      setError(t("input.image.errorInvalid"));
      return;
    }

    if (result.attachments.length) {
      setAttachments(prev => [...prev, ...result.attachments]);
    }

    if (result.rejected > 0) {
      const hasUploadError = result.errors.some((err) =>
        UPLOAD_ERROR_CODES.has(err)
      );
      setError(
        hasUploadError ? t("input.image.errorUpload") : t("input.image.errorRead")
      );
    }
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = event.clipboardData?.items;
    if (!items?.length) return;
    const files = Array.from(items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter(Boolean) as File[];
    if (files.length) {
        event.preventDefault(); 
        void handleFiles(files);
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    if (files.length) {
      await handleFiles(files);
      event.target.value = "";
    }
  };

  const handleGenerate = async () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt && !attachments.length) return;
    if (!selectedModelId) {
      setError(t("error.modelUnavailable"));
      return;
    }

    const activeSessionId = ensureSessionId();

    setIsGenerating(true);
    setError(null);
    setOutput(null);
    setStatus("queued");

    stopRef.current?.();

    try {
      const task = await createImageGenerationTask({
        model: selectedModel?.id ?? selectedModelId,
        prompt: trimmedPrompt || " ", 
        aspect_ratio: ratio,
        num_outputs: numOutputs,
        steps: steps,
        cfg_scale: guidance,
        seed: seed,
        provider_model_id: selectedModelId,
        session_id: activeSessionId,
        image_url: attachments[0]?.url,
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
    <div className="flex flex-col md:flex-row h-full w-full bg-background/50">
      {/* ZONE 1: Style & Tools (Left/Top Sidebar) */}
      <div className="w-full md:w-16 h-auto md:h-full border-b md:border-b-0 md:border-r border-black/5 dark:border-white/5 flex flex-row md:flex-col items-center justify-between md:justify-start p-2 md:py-4 md:gap-4 bg-black/[0.02] dark:bg-white/[0.02] shrink-0">
        <div className="flex flex-row md:flex-col items-center gap-2 md:gap-4">
            
            {/* Mode Switcher */}
            <Popover>
                <PopoverTrigger asChild>
                    <div>
                        <ToolbarButton 
                            icon={<Plus className="w-5 h-5" />} 
                            label={t("controls.menu")} 
                            active={false} // Always inactive style unless open? ToolbarButton handles simple active prop.
                        />
                    </div>
                </PopoverTrigger>
                <PopoverContent 
                    side="right" 
                    align="start" 
                    className="w-48 ml-2 p-1.5 flex flex-col gap-1 backdrop-blur-md bg-white/95 dark:bg-zinc-900/95 border-black/5 dark:border-white/10 shadow-xl rounded-xl"
                >
                    <Link href="/chat" scroll={false} className="flex items-center gap-3 p-2 hover:bg-black/5 dark:hover:bg-white/10 rounded-lg transition-colors group">
                        <div className="w-8 h-8 rounded-md bg-blue-500/10 dark:bg-blue-500/20 flex items-center justify-center text-blue-600 dark:text-blue-400 group-hover:scale-105 transition-transform">
                            <MessageSquare className="w-4 h-4" />
                        </div>
                        <span className="text-sm font-medium text-black/80 dark:text-white/80">Text Chat</span>
                    </Link>
                    <Link href="/chat/create/image" scroll={false} className="flex items-center gap-3 p-2 bg-black/5 dark:bg-white/10 rounded-lg transition-colors group">
                        <div className="w-8 h-8 rounded-md bg-purple-500/10 dark:bg-purple-500/20 flex items-center justify-center text-purple-600 dark:text-purple-400 group-hover:scale-105 transition-transform">
                            <Sparkles className="w-4 h-4" />
                        </div>
                        <span className="text-sm font-medium text-black dark:text-white">Image Gen</span>
                    </Link>
                    <Link href="/chat/coder" scroll={false} className="flex items-center gap-3 p-2 hover:bg-black/5 dark:hover:bg-white/10 rounded-lg transition-colors group">
                        <div className="w-8 h-8 rounded-md bg-green-500/10 dark:bg-green-500/20 flex items-center justify-center text-green-600 dark:text-green-400 group-hover:scale-105 transition-transform">
                            <Terminal className="w-4 h-4" />
                        </div>
                        <span className="text-sm font-medium text-black/80 dark:text-white/80">Code</span>
                    </Link>
                </PopoverContent>
            </Popover>

            <div className="h-4 w-px md:w-4 md:h-px bg-black/10 dark:bg-white/10 mx-1 md:mx-0" />

            <ToolbarButton icon={<Palette className="w-4 h-4" />} label={t("image.toolbar.style")} active />
            <ToolbarButton 
                icon={<ImageIcon className="w-4 h-4" />} 
                label={t("image.toolbar.refImage")} 
                onClick={() => fileInputRef.current?.click()}
            />
            
            {/* Settings Popover */}
            <Popover>
                <PopoverTrigger asChild>
                    <div>
                        <ToolbarButton icon={<SlidersHorizontal className="w-4 h-4" />} label={t("image.toolbar.settings")} />
                    </div>
                </PopoverTrigger>
                <PopoverContent 
                    side="right" 
                    align="start" 
                    className="w-80 ml-2 p-4 flex flex-col gap-4 backdrop-blur-md bg-white/95 dark:bg-zinc-900/95 border-black/5 dark:border-white/10 shadow-xl rounded-2xl max-h-[80vh] overflow-y-auto"
                >
                    {/* Count */}
                    <div className="space-y-3">
                        <div className="flex justify-between items-center">
                            <Label className="text-[10px] uppercase tracking-wider text-black/40 dark:text-white/40 font-medium">{t("image.settings.count")}</Label>
                            <span className="text-[10px] font-mono text-black/60 dark:text-white/60">{numOutputs}</span>
                        </div>
                        <Slider 
                            value={[numOutputs]} 
                            onValueChange={([v]) => setNumOutputs(v)} 
                            max={4} min={1} step={1} 
                            className="[&_[role=slider]]:h-3.5 [&_[role=slider]]:w-3.5"
                        />
                    </div>

                    {/* Steps */}
                    <div className="space-y-3 pt-2 border-t border-black/5 dark:border-white/5">
                        <div className="flex justify-between items-center">
                            <Label className="text-[10px] uppercase tracking-wider text-black/40 dark:text-white/40 font-medium">{t("image.settings.steps")}</Label>
                            <span className="text-[10px] font-mono text-black/60 dark:text-white/60">{steps}</span>
                        </div>
                        <Slider 
                            value={[steps]} 
                            onValueChange={([v]) => setSteps(v)} 
                            max={50} min={10} step={1} 
                            className="[&_[role=slider]]:h-3.5 [&_[role=slider]]:w-3.5"
                        />
                    </div>

                    {/* Guidance */}
                    <div className="space-y-3 pt-2 border-t border-black/5 dark:border-white/5">
                        <div className="flex justify-between items-center">
                            <Label className="text-[10px] uppercase tracking-wider text-black/40 dark:text-white/40 font-medium">{t("image.settings.guidance")}</Label>
                            <span className="text-[10px] font-mono text-black/60 dark:text-white/60">{guidance}</span>
                        </div>
                        <Slider 
                            value={[guidance]} 
                            onValueChange={([v]) => setGuidance(v)} 
                            max={20} min={1} step={0.5} 
                            className="[&_[role=slider]]:h-3.5 [&_[role=slider]]:w-3.5"
                        />
                    </div>

                    {/* Seed */}
                    <div className="space-y-2 pt-2 border-t border-black/5 dark:border-white/5">
                        <Label className="text-[10px] uppercase tracking-wider text-black/40 dark:text-white/40 font-medium">{t("image.settings.seed")}</Label>
                        <div className="flex gap-2">
                            <Input 
                                type="number" 
                                placeholder={t("image.settings.randomize")}
                                value={seed ?? ""} 
                                onChange={(e) => setSeed(e.target.value ? parseInt(e.target.value) : undefined)}
                                className="h-8 text-xs font-mono bg-white/5 border-black/5 dark:border-white/5"
                            />
                            <Button 
                                type="button"
                                variant="outline" 
                                size="icon" 
                                className="h-8 w-8 shrink-0 border-black/5 dark:border-white/5 hover:bg-black/5 dark:hover:bg-white/5"
                                onClick={() => setSeed(Math.floor(Math.random() * 1000000))}
                                title={t("image.settings.randomize")}
                            >
                                <Dices className="w-3.5 h-3.5 opacity-60" />
                            </Button>
                        </div>
                    </div>
                </PopoverContent>
            </Popover>
        </div>

        <div className="hidden md:block mt-auto">
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
        
        {/* Mobile Close Button */}
        <div className="md:hidden">
             <Link href="/chat" scroll={false}>
                <Button
                variant="ghost"
                size="icon"
                className="text-black/30 dark:text-white/30"
                aria-label={t("controls.menu")}
                >
                <X className="w-4 h-4" />
                </Button>
            </Link>
        </div>
      </div>

      {/* ZONE 2: Main Prompt Area (Center) */}
      <div className="flex-1 flex flex-col p-4 md:p-5 gap-4 min-h-0 relative overflow-y-auto">
        <div className="flex-1 flex flex-col min-h-0">
          <Label className="text-xs font-bold text-purple-500/80 dark:text-purple-400/80 mb-2 uppercase tracking-widest flex justify-between items-center">
            <span>{t("image.prompt.label")}</span>
            {attachments.length > 0 && (
                 <span className="text-[10px] text-muted-foreground">{t("input.image.summary", { count: attachments.length })}</span>
            )}
          </Label>

          {/* Attachments Preview Area */}
          {attachments.length > 0 && (
            <div className="flex gap-2 mb-2 overflow-x-auto pb-2">
                {attachments.map((att) => (
                    <div key={att.id} className="relative group shrink-0 w-20 h-20 rounded-md overflow-hidden border border-black/10 dark:border-white/10">
                         <Image 
                            src={att.url || ""} 
                            alt={att.name || "Attachment"} 
                            fill 
                            className="object-cover" 
                            unoptimized
                         />
                         <button 
                            onClick={() => setAttachments(prev => prev.filter(p => p.id !== att.id))}
                            className="absolute top-0.5 right-0.5 bg-black/50 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                         >
                            <X className="w-3 h-3" />
                         </button>
                    </div>
                ))}
            </div>
          )}

          <div className="relative flex-1 min-h-[120px] md:min-h-0 flex flex-col">
            <Textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onPaste={handlePaste}
                placeholder={t("image.prompt.placeholder")}
                className="flex-1 min-h-[120px] overflow-y-auto pr-2 bg-transparent text-black/90 dark:text-white/90 resize-none font-medium text-lg placeholder-black/10 dark:placeholder-white/10 leading-relaxed border-0 shadow-none focus-visible:ring-0"
                autoFocus
            />
            
            <div className="absolute bottom-2 right-2">
                 <Button
                    variant="ghost"
                    size="icon"
                    className="text-black/20 dark:text-white/20 hover:text-black dark:hover:text-white"
                    onClick={() => fileInputRef.current?.click()}
                 >
                    <ImagePlus className="w-5 h-5" />
                 </Button>
            </div>
          </div>
        </div>

        {error ? (
          <Alert variant="destructive" className="border border-red-500/20 bg-red-500/10">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {outputUrl ? (
          <ImageLightbox src={outputUrl} alt={t("input.image.alt")}>
            <div className="relative w-full max-w-xl aspect-square border border-black/5 dark:border-white/10 rounded-2xl overflow-hidden bg-black/[0.02] dark:bg-white/[0.02] mx-auto cursor-zoom-in group">
              <Image
                src={outputUrl}
                alt={t("input.image.alt")}
                fill
                sizes="(max-width: 1024px) 100vw, 512px"
                className="object-cover transition-transform duration-500 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                 <div className="bg-black/50 text-white p-2 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                    <Sparkles className="w-5 h-5" />
                 </div>
              </div>
            </div>
          </ImageLightbox>
        ) : isGenerating ? (
           <div className="relative w-full max-w-xl aspect-square border border-black/5 dark:border-white/10 rounded-2xl overflow-hidden bg-black/[0.02] dark:bg-white/[0.02] flex items-center justify-center p-8 mx-auto">
             <HolographicPulse label={stepsVisual[activeStep]?.label || t("status.placeholder.batch")} className="h-full max-h-32 w-full" />
           </div>
        ) : null}

        {sessionId ? (
          <div className="w-full max-w-5xl mx-auto space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-black/40 dark:text-white/40">
                {t("imageHistory.sessionTitle")}
              </span>
              <span className="text-[10px] text-black/30 dark:text-white/30">
                {sessionId.slice(0, 8)}…
              </span>
            </div>
            {isLoadingSessionTasks && sessionPreviews.length === 0 ? (
              <div className="text-xs text-black/40 dark:text-white/40">
                {t("imageHistory.loading")}
              </div>
            ) : sessionPreviews.length > 0 ? (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {sessionPreviews.map(({ task, previewUrl }) => (
                  <Button
                    key={task.task_id}
                    type="button"
                    variant="ghost"
                    className="relative aspect-square rounded-2xl overflow-hidden border border-black/5 dark:border-white/10 p-0"
                    onClick={() => {
                      if (task.preview) {
                        setOutput(task.preview as ImageGenerationOutputItem);
                      }
                    }}
                  >
                    <Image
                      src={previewUrl ?? ""}
                      alt={t("input.image.alt")}
                      fill
                      sizes="(max-width: 640px) 33vw, 160px"
                      className="object-cover"
                    />
                  </Button>
                ))}
              </div>
            ) : (
              <div className="text-xs text-black/40 dark:text-white/40">
                {t("imageHistory.sessionEmpty")}
              </div>
            )}
          </div>
        ) : null}

        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
          <Badge className="text-[10px] font-medium bg-black/5 dark:bg-white/5 text-black/60 dark:text-white/60 whitespace-nowrap">
            {t("image.badges.cyberpunk")}
          </Badge>
          <Badge className="text-[10px] font-medium bg-black/5 dark:bg-white/5 text-black/60 dark:text-white/60 whitespace-nowrap">
            {t("image.badges.cinematicLighting")}
          </Badge>
          <Badge className="text-[10px] font-medium bg-black/5 dark:bg-white/5 text-black/60 dark:text-white/60 whitespace-nowrap">
            {t("image.badges.resolution")}
          </Badge>
          <Badge
            variant="outline"
            className="text-[10px] font-medium text-black/40 dark:text-white/40 border-dashed border-black/20 dark:border-white/20 whitespace-nowrap"
          >
            {t("image.badges.addNegative")}
          </Badge>
        </div>

        <Input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFileChange}
        />
      </div>

      {/* ZONE 3: Parameters & Action (Right/Bottom Sidebar) */}
      <div className="w-full md:w-80 h-auto md:h-full border-t md:border-t-0 md:border-l border-black/5 dark:border-white/5 bg-black/[0.01] dark:bg-white/[0.01] p-4 flex flex-col gap-4 overflow-y-auto shrink-0">
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

        {isGenerating ? (
            <StatusStream
                steps={stepsVisual}
                activeIndex={activeStep}
                label={t("status.flow.stream")}
                compact={false}
            />
        ) : status ? (
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
          disabled={isGenerating || (!prompt.trim() && !attachments.length) || !selectedModelId}
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
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      onClick={onClick}
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
