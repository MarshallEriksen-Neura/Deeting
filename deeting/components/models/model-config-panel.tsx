"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { GlassCard } from "@/components/ui/common/glass-card";
import { GlassButton } from "@/components/ui/common/glass-button";
import { Badge } from "@/components/ui/shadcn/badge";
import { Label } from "@/components/ui/shadcn/label";
import { Input } from "@/components/ui/shadcn/input";
import { Separator } from "@/components/ui/shadcn/separator";
import { cn } from "@/lib/utils";
import type { ProviderModel, ModelCapability } from "./types";
import { CAPABILITY_META } from "./types";
import type { ProviderModelUpdate } from "@/lib/api/providers";
import { Check } from "lucide-react";

const CHAT_COMPLETIONS_PATH = "chat/completions";
const RESPONSES_PATH = "responses";
type RequestMode = "chat_completions" | "responses" | "custom";
type ChatContentCompatibilityMode = "auto" | "structured" | "string_only";
const CHAT_CONTENT_COMPATIBILITY_KEY = "chat_content_compatibility";

function parseChatContentCompatibilityMode(configOverride?: Record<string, unknown> | null): ChatContentCompatibilityMode {
  const raw = configOverride?.[CHAT_CONTENT_COMPATIBILITY_KEY];
  if (raw === "structured") return "structured";
  return raw === "string_only" ? "string_only" : "auto";
}

function normalizeUpstreamPath(value?: string | null) {
  return String(value || "").trim().replace(/^\/+/, "");
}

function detectRequestMode(value?: string | null): RequestMode {
  const path = normalizeUpstreamPath(value).toLowerCase();
  if (!path || path === CHAT_COMPLETIONS_PATH) return "chat_completions";
  if (path === RESPONSES_PATH) return "responses";
  return "custom";
}

function inferRequestBase(requestUrl?: string | null, upstreamPath?: string | null) {
  const url = String(requestUrl || "").trim();
  if (!url) return "";
  const normalizedPath = normalizeUpstreamPath(upstreamPath);
  if (normalizedPath && url.endsWith(`/${normalizedPath}`)) return url.slice(0, -(normalizedPath.length + 1));
  if (url.endsWith(`/${CHAT_COMPLETIONS_PATH}`)) return url.slice(0, -(CHAT_COMPLETIONS_PATH.length + 1));
  if (url.endsWith(`/${RESPONSES_PATH}`)) return url.slice(0, -(RESPONSES_PATH.length + 1));
  return url;
}

function NumberInput({ label, value, onChange, placeholder, suffix }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; suffix?: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="ws-meta text-[10px] tracking-wider mb-1 block">{label}</Label>
      <div className="flex items-center gap-2 group">
        <Input 
          type="number" 
          inputMode="decimal" 
          value={value} 
          onChange={(event) => onChange(event.target.value)} 
          placeholder={placeholder} 
          className="ws-control h-10 border-[var(--hairline)] bg-[var(--panel-bg-inset)] focus:border-[var(--accent-border)] focus:ring-1 focus:ring-[var(--accent-soft)] transition-all" 
        />
        {suffix ? <span className="ws-num whitespace-nowrap text-[10px] font-bold text-[var(--ink-4)] uppercase">{suffix}</span> : null}
      </div>
    </div>
  );
}

function TextInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="ws-meta text-[10px] tracking-wider mb-1 block">{label}</Label>
      <Input 
        value={value} 
        onChange={(event) => onChange(event.target.value)} 
        placeholder={placeholder} 
        className="ws-control h-10 border-[var(--hairline)] bg-[var(--panel-bg-inset)] focus:border-[var(--accent-border)] focus:ring-1 focus:ring-[var(--accent-soft)] transition-all" 
      />
    </div>
  );
}

function ReadonlyInput({ label, value, placeholder }: { label: string; value: string; placeholder?: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="ws-meta text-[10px] tracking-wider mb-1 block">{label}</Label>
      <Input 
        value={value} 
        placeholder={placeholder} 
        readOnly 
        className="ws-num h-10 border-[var(--hairline-subtle)] bg-[var(--panel-bg-inset)]/50 text-[11px] text-[var(--ink-4)] select-all cursor-default" 
      />
    </div>
  );
}

export function ModelConfigPanel({ model, showChatContentCompatibility = false, onSave }: { model: ProviderModel; showChatContentCompatibility?: boolean; onSave?: (model: ProviderModel, payload: ProviderModelUpdate) => Promise<void> }) {
  const t = useTranslations("models.form");
  const tCap = useTranslations("models.capabilities");
  const [displayName, setDisplayName] = React.useState(model.display_name || "");
  const [unifiedModelId, setUnifiedModelId] = React.useState(model.unified_model_id || model.id);
  const [upstreamPath, setUpstreamPath] = React.useState(model.upstream_path || "");
  const [requestMode, setRequestMode] = React.useState<RequestMode>(detectRequestMode(model.upstream_path));
  const [chatContentCompatibility, setChatContentCompatibility] = React.useState<ChatContentCompatibilityMode>(parseChatContentCompatibilityMode(model.config_override));
  const [weight, setWeight] = React.useState(model.weight?.toString() || "");
  const [priority, setPriority] = React.useState(model.priority?.toString() || "");
  const [inputPrice, setInputPrice] = React.useState(model.pricing.input?.toString() || "");
  const [outputPrice, setOutputPrice] = React.useState(model.pricing.output?.toString() || "");
  const [maxOutputTokens, setMaxOutputTokens] = React.useState(model.max_output_tokens?.toString() || "");
  const [rpm, setRpm] = React.useState(model.rpm?.toString() || "");
  const [tpm, setTpm] = React.useState(model.tpm?.toString() || "");
  const [maxInputImages, setMaxInputImages] = React.useState(model.max_input_images?.toString() || "");
  const [contextWindow, setContextWindow] = React.useState(model.context_window ? model.context_window.toString() : "");
  const [capabilities, setCapabilities] = React.useState<ModelCapability[]>(model.capabilities?.length ? model.capabilities : ["chat"]);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const initialSnapshot = React.useRef<Record<string, unknown> | null>(null);

  const normalizeNumber = React.useCallback((value: string) => {
    if (!value) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }, []);

  const snapshot = React.useCallback(() => ({
    displayName: displayName.trim(),
    unifiedModelId: unifiedModelId.trim(),
    upstreamPath: upstreamPath.trim(),
    chatContentCompatibility,
    weight: weight.trim(),
    priority: priority.trim(),
    inputPrice: inputPrice.trim(),
    outputPrice: outputPrice.trim(),
    maxOutputTokens: maxOutputTokens.trim(),
    rpm: rpm.trim(),
    tpm: tpm.trim(),
    maxInputImages: maxInputImages.trim(),
    contextWindow: contextWindow.trim(),
    capabilities: [...capabilities].sort(),
  }), [capabilities, chatContentCompatibility, contextWindow, displayName, inputPrice, maxInputImages, maxOutputTokens, outputPrice, priority, rpm, tpm, unifiedModelId, upstreamPath, weight]);

  const hasChanges = React.useMemo(() => {
    if (!initialSnapshot.current) return false;
    return JSON.stringify(snapshot()) !== JSON.stringify(initialSnapshot.current);
  }, [snapshot]);

  const requestBase = React.useMemo(() => inferRequestBase(model.request_url, model.upstream_path), [model.request_url, model.upstream_path]);
  const requestUrlPreview = React.useMemo(() => {
    if (!requestBase) return model.request_url || "";
    const path = normalizeUpstreamPath(upstreamPath);
    return path ? `${requestBase}/${path}` : requestBase;
  }, [model.request_url, requestBase, upstreamPath]);

  const handleUpstreamPathChange = React.useCallback((value: string) => {
    setUpstreamPath(value);
    setRequestMode(detectRequestMode(value));
  }, []);

  const applyRequestMode = React.useCallback((mode: RequestMode) => {
    setRequestMode(mode);
    if (mode === "chat_completions") {
      setUpstreamPath(CHAT_COMPLETIONS_PATH);
      return;
    }
    if (mode === "responses") {
      setUpstreamPath(RESPONSES_PATH);
    }
  }, []);

  const buildPayload = React.useCallback((): ProviderModelUpdate => {
    const payload: ProviderModelUpdate = {};
    const display = displayName.trim();
    if (display) payload.display_name = display;
    payload.upstream_path = upstreamPath.trim();
    const weightNum = normalizeNumber(weight);
    if (weightNum !== undefined) payload.weight = weightNum;
    const priorityNum = normalizeNumber(priority);
    if (priorityNum !== undefined) payload.priority = priorityNum;
    const inputNum = normalizeNumber(inputPrice);
    const outputNum = normalizeNumber(outputPrice);
    const pricing: Record<string, number> = {};
    if (inputNum !== undefined) pricing.input_per_1k = inputNum;
    if (outputNum !== undefined) pricing.output_per_1k = outputNum;
    if (Object.keys(pricing).length) payload.pricing_config = pricing;
    const maxOutNum = normalizeNumber(maxOutputTokens);
    const rpmNum = normalizeNumber(rpm);
    const tpmNum = normalizeNumber(tpm);
    const limits: Record<string, number> = {};
    if (maxOutNum !== undefined) limits.max_output_tokens = maxOutNum;
    if (rpmNum !== undefined) limits.rpm = rpmNum;
    if (tpmNum !== undefined) limits.tpm = tpmNum;
    if (Object.keys(limits).length) payload.limit_config = limits;
    const contextNum = normalizeNumber(contextWindow);
    if (contextNum !== undefined) payload.tokenizer_config = { context_window: contextNum };
    const routing: Record<string, unknown> = {};
    if (capabilities.length) routing.capabilities = capabilities;
    const maxInputImagesNum = normalizeNumber(maxInputImages);
    if (capabilities.includes("image_generation") && maxInputImagesNum !== undefined) routing.max_input_images = maxInputImagesNum;
    const alias = unifiedModelId.trim();
    if (alias && alias !== model.id) routing.unified_model_alias = alias;
    if (Object.keys(routing).length) payload.routing_config = routing;
    if (showChatContentCompatibility && capabilities.includes("chat")) {
      if (chatContentCompatibility === "string_only" || chatContentCompatibility === "structured") {
        payload.config_override = { ...(model.config_override || {}), [CHAT_CONTENT_COMPATIBILITY_KEY]: chatContentCompatibility };
      } else if (model.config_override?.[CHAT_CONTENT_COMPATIBILITY_KEY] != null) {
        const nextConfigOverride = { ...(model.config_override || {}) };
        delete nextConfigOverride[CHAT_CONTENT_COMPATIBILITY_KEY];
        payload.config_override = nextConfigOverride;
      }
    }
    return payload;
  }, [capabilities, chatContentCompatibility, contextWindow, displayName, inputPrice, maxInputImages, maxOutputTokens, model.config_override, model.id, normalizeNumber, outputPrice, priority, rpm, showChatContentCompatibility, tpm, unifiedModelId, upstreamPath, weight]);

  const handleSave = React.useCallback(async () => {
    if (!onSave) return;
    try {
      setSaving(true);
      setError(null);
      await onSave(model, buildPayload());
      initialSnapshot.current = snapshot();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [buildPayload, model, onSave, snapshot]);

  const handleReset = React.useCallback(() => {
    const snap = initialSnapshot.current;
    if (!snap) return;
    setDisplayName((snap.displayName as string) || "");
    setUnifiedModelId((snap.unifiedModelId as string) || model.id);
    setUpstreamPath((snap.upstreamPath as string) ?? model.upstream_path ?? "");
    setChatContentCompatibility(((snap.chatContentCompatibility as ChatContentCompatibilityMode) || "auto"));
    setWeight((snap.weight as string) || "");
    setPriority((snap.priority as string) || "");
    setInputPrice((snap.inputPrice as string) || "");
    setOutputPrice((snap.outputPrice as string) || "");
    setMaxOutputTokens((snap.maxOutputTokens as string) || "");
    setRpm((snap.rpm as string) || "");
    setTpm((snap.tpm as string) || "");
    setMaxInputImages((snap.maxInputImages as string) || "");
    setContextWindow((snap.contextWindow as string) || "");
    setCapabilities(((snap.capabilities as ModelCapability[]) || ["chat"]) as ModelCapability[]);
    setError(null);
  }, [model.id, model.upstream_path]);

  React.useEffect(() => {
    const initial = {
      displayName: model.display_name || "",
      unifiedModelId: model.unified_model_id || model.id,
      upstreamPath: model.upstream_path || "",
      chatContentCompatibility: parseChatContentCompatibilityMode(model.config_override),
      weight: model.weight?.toString() || "",
      priority: model.priority?.toString() || "",
      inputPrice: model.pricing.input?.toString() || "",
      outputPrice: model.pricing.output?.toString() || "",
      maxOutputTokens: model.max_output_tokens?.toString() || "",
      rpm: model.rpm?.toString() || "",
      tpm: model.tpm?.toString() || "",
      maxInputImages: model.max_input_images?.toString() || "",
      contextWindow: model.context_window ? model.context_window.toString() : "",
      capabilities: model.capabilities?.length ? model.capabilities : ["chat"],
    };
    setDisplayName(initial.displayName);
    setUnifiedModelId(initial.unifiedModelId);
    setUpstreamPath(initial.upstreamPath);
    setRequestMode(detectRequestMode(initial.upstreamPath));
    setWeight(initial.weight);
    setPriority(initial.priority);
    setInputPrice(initial.inputPrice);
    setOutputPrice(initial.outputPrice);
    setMaxOutputTokens(initial.maxOutputTokens);
    setRpm(initial.rpm);
    setTpm(initial.tpm);
    setMaxInputImages(initial.maxInputImages);
    setContextWindow(initial.contextWindow);
    setCapabilities(initial.capabilities as ModelCapability[]);
    setError(null);
    setSaving(false);
    initialSnapshot.current = { ...initial, capabilities: [...(initial.capabilities as ModelCapability[])].sort() };
  }, [model]);

  return (
    <div className="space-y-8">
        <Section title={t("basic.title")} description={t("basic.desc")}>
          <div className="grid gap-6 md:grid-cols-2 mt-4">
            <TextInput label={t("basic.displayName")} value={displayName} onChange={setDisplayName} placeholder={model.id} />
            <TextInput label={t("basic.unifiedId")} value={unifiedModelId} onChange={setUnifiedModelId} placeholder={model.unified_model_id || model.id} />
            
            {capabilities.includes("chat") && (
              <div className="space-y-3 md:col-span-2">
                <Label className="ws-meta text-[10px] tracking-wider mb-2 block">{t("basic.requestMode")}</Label>
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: "chat_completions" as const, label: t("basic.requestModes.chatCompletions") },
                    { id: "responses" as const, label: t("basic.requestModes.responses") },
                    { id: "custom" as const, label: t("basic.requestModes.custom") },
                  ].map((option) => {
                    const active = requestMode === option.id;
                    return (
                      <button 
                        key={option.id} 
                        type="button" 
                        onClick={() => applyRequestMode(option.id)} 
                        className={cn(
                          "ws-control h-10 rounded-xl border px-4 text-[12px] font-bold transition-all flex items-center gap-2", 
                          active 
                            ? "border-[var(--accent-strong)] bg-[var(--accent-soft)] text-[var(--accent-ink)] shadow-sm" 
                            : "border-[var(--hairline)] bg-[var(--panel-bg-inset)]/50 text-[var(--ink-3)] hover:bg-[var(--panel-bg)]"
                        )}
                      >
                        {option.label}
                        {active && <Check className="size-3.5" />}
                      </button>
                    );
                  })}
                </div>
                <p className="ws-caption text-[11px] opacity-60 italic">{t("basic.requestModeHint")}</p>
              </div>
            )}
            
            <TextInput label={t("basic.upstreamPath")} value={upstreamPath} onChange={handleUpstreamPathChange} placeholder={t("basic.upstreamPathPlaceholder")} />
            
            {showChatContentCompatibility && capabilities.includes("chat") && (
              <div className="space-y-3 md:col-span-2">
                <Label className="ws-meta text-[10px] tracking-wider mb-2 block">{t("basic.chatContentCompatibility")}</Label>
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: "auto" as const, label: t("basic.chatContentCompatibilityModes.auto") },
                    { id: "structured" as const, label: t("basic.chatContentCompatibilityModes.structured") },
                    { id: "string_only" as const, label: t("basic.chatContentCompatibilityModes.stringOnly") },
                  ].map((option) => {
                    const active = chatContentCompatibility === option.id;
                    return (
                      <button 
                        key={option.id} 
                        type="button" 
                        onClick={() => setChatContentCompatibility(option.id)} 
                        className={cn(
                          "ws-control h-10 rounded-xl border px-4 text-[12px] font-bold transition-all flex items-center gap-2", 
                          active 
                            ? "border-[var(--accent-strong)] bg-[var(--accent-soft)] text-[var(--accent-ink)] shadow-sm" 
                            : "border-[var(--hairline)] bg-[var(--panel-bg-inset)]/50 text-[var(--ink-3)] hover:bg-[var(--panel-bg)]"
                        )}
                      >
                        {option.label}
                        {active && <Check className="size-3.5" />}
                      </button>
                    );
                  })}
                </div>
                <p className="ws-caption text-[11px] opacity-60 italic">{t("basic.chatContentCompatibilityHint")}</p>
              </div>
            )}
            
            <ReadonlyInput label={t("basic.requestUrl")} value={requestUrlPreview} placeholder={requestUrlPreview ? undefined : "-"} />
            <NumberInput label={t("basic.weight")} value={weight} onChange={setWeight} placeholder="0" />
            <NumberInput label={t("basic.priority")} value={priority} onChange={setPriority} placeholder="0" />
          </div>
        </Section>
        
        <Separator className="bg-[var(--hairline)]" />
        
        <Section title={t("capabilities.title")} description={t("capabilities.desc")}>
          <div className="flex flex-wrap gap-2 mt-4">
            {(["chat", "image_generation", "text_to_speech", "speech_to_text", "video_generation", "embedding"] as ModelCapability[]).map((capability) => {
              const active = capabilities.includes(capability);
              return (
                <button 
                   key={capability}
                   onClick={() => setCapabilities((prev) => prev.includes(capability) ? prev.filter((value) => value !== capability) : [...prev, capability])}
                   className={cn(
                     "ws-control h-9 px-4 rounded-full border text-[11px] font-bold uppercase tracking-wider flex items-center gap-2 transition-all",
                     active 
                       ? "bg-[var(--accent-strong)] border-[var(--accent-strong)] text-white shadow-lg shadow-[var(--accent-soft)]" 
                       : "border-[var(--hairline)] bg-[var(--panel-bg-inset)] text-[var(--ink-3)] hover:bg-[var(--panel-bg)] hover:border-[var(--hairline-strong)]"
                   )}
                >
                  <span className="text-xs">{CAPABILITY_META[capability].icon}</span>
                  {tCap(`${capability}.label`)}
                </button>
              );
            })}
          </div>
        </Section>

        <Separator className="bg-[var(--hairline)]" />

        <Section title={t("pricing.title")} description={t("pricing.desc")}>
          <div className="grid gap-6 md:grid-cols-2 mt-4">
            <NumberInput label={t("pricing.input")} value={inputPrice} onChange={setInputPrice} placeholder="0.0015" suffix="$ / 1k tokens" />
            <NumberInput label={t("pricing.output")} value={outputPrice} onChange={setOutputPrice} placeholder="0.002" suffix="$ / 1k tokens" />
          </div>
        </Section>

        <Separator className="bg-[var(--hairline)]" />

        <Section title={t("limits.title")} description={t("limits.desc")}>
          <div className="grid gap-6 md:grid-cols-3 mt-4">
            <NumberInput label={t("limits.maxOutput")} value={maxOutputTokens} onChange={setMaxOutputTokens} placeholder="4096" suffix="tokens" />
            <NumberInput label={t("limits.rpm")} value={rpm} onChange={setRpm} placeholder="60" suffix="req/min" />
            <NumberInput label={t("limits.tpm")} value={tpm} onChange={setTpm} placeholder="90000" suffix="tokens/min" />
            {capabilities.includes("image_generation") && <NumberInput label={t("limits.maxInputImages")} value={maxInputImages} onChange={setMaxInputImages} placeholder="1" suffix="images" />}
          </div>
        </Section>

        <Separator className="bg-[var(--hairline)]" />

        <Section title={t("tokenizer.title")} description={t("tokenizer.desc")}>
          <div className="grid gap-6 md:grid-cols-2 mt-4">
            <NumberInput label={t("tokenizer.context")} value={contextWindow} onChange={setContextWindow} placeholder="128000" suffix="tokens" />
          </div>
        </Section>

        {error && (
          <div className="p-4 rounded-xl bg-[var(--danger-soft)] border border-[var(--danger-border)] flex items-start gap-3">
             <div className="ws-dot mt-1.5" data-tone="danger" />
             <div className="ws-body text-[12px] text-[var(--danger)] font-medium leading-relaxed">{error}</div>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-6 border-t border-[var(--hairline)]">
          <GlassButton 
            variant="ghost" 
            size="sm" 
            onClick={handleReset} 
            disabled={!hasChanges || saving}
            className="rounded-xl px-6 h-10 ws-control font-bold opacity-60 hover:opacity-100"
          >
            {t("actions.reset").toUpperCase()}
          </GlassButton>
          <button 
            onClick={(event) => { event.stopPropagation(); void handleSave(); }} 
            disabled={!hasChanges || saving}
            className={cn(
              "ws-control h-10 px-8 rounded-xl bg-[var(--accent-strong)] text-white font-bold text-[12px] shadow-lg shadow-[var(--accent-soft)] hover:brightness-110 active:scale-95 disabled:opacity-50 transition-all",
              saving && "animate-pulse"
            )}
          >
            {saving ? t("actions.saving").toUpperCase() : t("actions.save").toUpperCase()}
          </button>
        </div>
    </div>
  );
}

function Section({ title, description, className, children }: { title: string; description?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="space-y-1">
        <h3 className="ws-pane-title text-[15px] tracking-tight">{title}</h3>
        {description ? <p className="ws-body text-xs opacity-60 leading-relaxed max-w-2xl">{description}</p> : null}
      </div>
      {children}
    </div>
  );
}
