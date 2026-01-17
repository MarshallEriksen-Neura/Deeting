"use client"

import * as React from "react"
import { motion, AnimatePresence } from "framer-motion"
import { useTranslations } from "next-intl"
import { 
  Lock, 
  Globe, 
  Key, 
  Terminal, 
  Zap, 
  Check, 
  AlertCircle, 
  Server, 
  ChevronDown,
  Cpu,
  Save,
  Play
} from "lucide-react"

import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { GlassButton } from "@/components/ui/glass-button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import { ProviderIconPicker } from "./provider-icon-picker"
import { useProviderVerify, useCreateProviderInstance, useUpdateProviderInstance } from "@/hooks/use-providers"
import { usePlatform } from "@/lib/platform/provider"
import { Switch } from "@/components/ui/switch"
import { VisuallyHidden } from "@/components/ui/visually-hidden"
import { getIconComponent } from "@/lib/constants/provider-icons"

export interface ProviderPresetConfig {
  slug: string
  name: string
  type: "system" | "custom"
  protocol?: string | null
  default_endpoint?: string | null
  brand_color?: string | null
  icon_key?: string | null
}

interface ConnectProviderInitialValues {
  name?: string
  description?: string | null
  base_url?: string
  api_key?: string | null
  is_enabled?: boolean
  icon?: string | null
  theme_color?: string | null
  resource_name?: string | null
  deployment_name?: string | null
  api_version?: string | null
  project_id?: string | null
  region?: string | null
  protocol?: string | null
}

export interface ConnectProviderDrawerProps {
  isOpen: boolean
  onClose: () => void
  preset: ProviderPresetConfig | null
  mode?: "create" | "edit"
  instanceId?: string | null
  initialValues?: ConnectProviderInitialValues
  onSave: (payload: {
    baseUrl: string
    apiKey: string
    protocol: string
    name: string
    description: string
    is_enabled: boolean
  }) => void | Promise<void>
}

export function ConnectProviderDrawer({ 
  isOpen, 
  onClose, 
  preset, 
  mode = "create",
  instanceId = null,
  initialValues,
  onSave 
}: ConnectProviderDrawerProps) {
  const t = useTranslations("providers")
  const { verify } = useProviderVerify()
  const { create } = useCreateProviderInstance()
  const { update } = useUpdateProviderInstance()
  const { model: modelPlatform } = usePlatform()

  const [presetSlug, setPresetSlug] = React.useState(preset?.slug || "custom")
  const [name, setName] = React.useState(initialValues?.name || preset?.name || "")
  const [description, setDescription] = React.useState(initialValues?.description || "")
  const [baseUrl, setBaseUrl] = React.useState(initialValues?.base_url || preset?.default_endpoint || "")
  const [apiKey, setApiKey] = React.useState(initialValues?.api_key || "")
  const [protocol, setProtocol] = React.useState(initialValues?.protocol || preset?.protocol || "openai")
  const [icon, setIcon] = React.useState(initialValues?.icon || preset?.icon_key || "lucide:server")
  const [customIconUrl, setCustomIconUrl] = React.useState("")
  const [brandColor, setBrandColor] = React.useState(initialValues?.theme_color || preset?.brand_color || "#3b82f6")
  const [enabled, setEnabled] = React.useState(initialValues?.is_enabled ?? true)
  const [connectionStatus, setConnectionStatus] = React.useState<"idle" | "testing" | "success" | "error">("idle")
  const [logs, setLogs] = React.useState<string[]>([])
  const [saving, setSaving] = React.useState(false)
  const [resourceName, setResourceName] = React.useState(initialValues?.resource_name || "")
  const [deploymentName, setDeploymentName] = React.useState(initialValues?.deployment_name || "")
  const [apiVersion, setApiVersion] = React.useState(initialValues?.api_version || "")
  const [projectId, setProjectId] = React.useState(initialValues?.project_id || "")
  const [region, setRegion] = React.useState(initialValues?.region || "")

  React.useEffect(() => {
    if (!isOpen) return
    setPresetSlug(preset?.slug || "custom")
    setName(initialValues?.name || preset?.name || "")
    setDescription(initialValues?.description || "")
    setBaseUrl(initialValues?.base_url || preset?.default_endpoint || "")
    setApiKey(initialValues?.api_key || "")
    setProtocol(initialValues?.protocol || preset?.protocol || "openai")
    setIcon(initialValues?.icon || preset?.icon_key || "lucide:server")
    setCustomIconUrl("")
    setBrandColor(initialValues?.theme_color || preset?.brand_color || "#3b82f6")
    setEnabled(initialValues?.is_enabled ?? true)
    setResourceName(initialValues?.resource_name || "")
    setDeploymentName(initialValues?.deployment_name || "")
    setApiVersion(initialValues?.api_version || "")
    setProjectId(initialValues?.project_id || "")
    setRegion(initialValues?.region || "")
    setLogs([])
    setConnectionStatus("idle")
  }, [isOpen, preset, initialValues])

  const isSystem = preset?.type === "system"
  const normalizedSlug = (presetSlug || "").toLowerCase()
  const resolvedIconId = (customIconUrl || icon || preset?.icon_key || "lucide:server").trim()
  const HeaderIcon = React.useMemo(() => getIconComponent(resolvedIconId), [resolvedIconId])

  const handleTestConnection = async () => {
    // Check if it's a local provider and if we need to intercept
    const category = preset?.slug?.toLowerCase() || ""
    const isLocal = category.includes("local") || category.includes("ollama") || category.includes("lmstudio")
    
    if (isLocal) {
      try {
        await modelPlatform.connect(presetSlug)
      } catch (err: any) {
        if (err.message === 'PLATFORM_RESTRICTED') {
          // The platform service already triggered the modal
          return
        }
      }
    }

    if (!baseUrl) {

      setLogs([`> ${t("drawer.baseUrlRequired")}`])
      setConnectionStatus('error')
      return
    }
    if (!apiKey) {
      setLogs([`> ${t("drawer.apiKeyRequired")}`])
      setConnectionStatus('error')
      return
    }

    setConnectionStatus('testing')
    setLogs([`> ${t("drawer.sendingProbe")}`])
    try {
      const result = await verify({
        preset_slug: presetSlug || "custom",
        base_url: baseUrl,
        api_key: apiKey,
        protocol,
        resource_name: resourceName || undefined,
        deployment_name: deploymentName || undefined,
        api_version: apiVersion || undefined,
        project_id: projectId || undefined,
        region: region || undefined,
      })
      if (result.success) {
        setConnectionStatus('success')
        setLogs([
          `> ${result.message}`,
          `> latency ${result.latency_ms} ms`,
          result.discovered_models.length
            ? `> models: ${result.discovered_models.join(", ")}`
            : "> no models returned",
        ])
      } else {
        setConnectionStatus('error')
        setLogs([
          `> ${result.message}`,
          `> latency ${result.latency_ms} ms`,
        ])
      }
    } catch (err: any) {
      setConnectionStatus('error')
      setLogs([`> ${err?.message || 'Verification failed'}`])
    }
  }

  const handleSave = async () => {
    if (!baseUrl) {
      setLogs([`> ${t("drawer.baseUrlRequired")}`])
      return
    }
    const resolvedIcon = (customIconUrl || icon || preset?.icon_key || "").trim() || null
    setSaving(true)
    setLogs([])
    try {
      if (mode === "create") {
        await create({
          preset_slug: presetSlug || "custom",
          name,
          description: description || null,
          base_url: baseUrl,
          icon: resolvedIcon,
          theme_color: brandColor || null,
          credentials_ref: apiKey ? null : "default",
          api_key: apiKey || null,
          protocol,
          priority: 0,
          is_enabled: enabled,
          resource_name: resourceName || null,
          deployment_name: deploymentName || null,
          api_version: apiVersion || null,
          project_id: projectId || null,
          region: region || null,
        })
      } else if (mode === "edit" && instanceId) {
        await update(instanceId, {
          name,
          description: description || null,
          base_url: baseUrl,
          icon: resolvedIcon,
          theme_color: brandColor || null,
          api_key: apiKey || null,
          is_enabled: enabled,
          resource_name: resourceName || null,
          deployment_name: deploymentName || null,
          api_version: apiVersion || null,
          project_id: projectId || null,
          region: region || null,
        })
      }
      onSave({ baseUrl, apiKey, protocol, name, description, is_enabled: enabled })
      onClose()
    } catch (err: any) {
      setLogs([`> ${err?.message || t("drawer.errorSave", { defaultValue: "Save failed" })}`])
    } finally {
      setSaving(false)
    }
  }

  // Visual Styles based on mode
  const themeColor = brandColor || preset?.brand_color || "#3b82f6"

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent 
        className="w-full sm:max-w-md p-0 border-l border-white/10 bg-black/40 backdrop-blur-2xl text-[var(--foreground)]"
      >
        <VisuallyHidden>
          <SheetTitle>
            {isSystem ? t("drawer.titleSystem", { name: preset?.name ?? t("drawer.titleCustom") }) : t("drawer.titleCustom")}
          </SheetTitle>
          <SheetDescription>
            {t("market.description")}
          </SheetDescription>
        </VisuallyHidden>
        <div className="flex flex-col h-full relative overflow-hidden">
          
          {/* Ambient Background Glow */}
              <div 
                className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-64 opacity-20 pointer-events-none"
                style={{ 
                  background: `radial-gradient(circle at 50% 0%, ${themeColor || '#3b82f6'}, transparent 70%)` 
                }} 
              />

          {/* Zone A: Header (Identity) */}
          <div className="flex-none p-6 pt-10 relative z-10">
            <div className="flex flex-col items-center text-center space-y-4">
              <motion.div 
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="relative"
              >
                <div 
                  className={cn(
                    "size-20 rounded-2xl flex items-center justify-center border border-white/10 bg-gradient-to-br from-white/5 to-transparent",
                    isSystem ? "shadow-lg" : "shadow-[0_0_20px_rgba(59,130,246,0.3)]"
                  )}
                  style={isSystem ? { borderColor: `${themeColor}40` } : {}}
                >
                  {resolvedIconId.startsWith("http") ? (
                    <img
                      src={resolvedIconId}
                      alt="provider icon"
                      className="size-10 object-contain rounded-lg"
                    />
                  ) : HeaderIcon ? (
                    <HeaderIcon className="size-10" style={{ color: themeColor }} />
                  ) : isSystem ? (
                    <Globe className="size-10" style={{ color: themeColor }} />
                  ) : (
                    <Server className="size-10 text-blue-400" />
                  )}
                </div>
                {/* Status Dot */}
                <div className="absolute -bottom-1 -right-1">
                   <span className={cn(
                     "relative flex h-4 w-4",
                   )}>
                     <span className={cn(
                       "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
                       isSystem ? "bg-green-500" : "bg-blue-500"
                     )}></span>
                     <span className={cn(
                       "relative inline-flex rounded-full h-4 w-4 border-2 border-black",
                       isSystem ? "bg-green-500" : "bg-blue-500"
                     )}></span>
                   </span>
                </div>
              </motion.div>

              <div>
                <h2 className="text-2xl font-bold tracking-tight">
                {mode === "edit" ? name : (isSystem ? t("drawer.titleSystem", { name: preset?.name ?? t("drawer.titleCustom") }) : t("drawer.titleCustom"))}
                </h2>
                <div className="flex items-center justify-center gap-2 mt-2">
                  <Badge 
                    variant="outline" 
                    className={cn(
                      "px-2 py-0.5 text-[10px] uppercase tracking-wider border-opacity-30",
                      isSystem 
                        ? "bg-amber-500/10 text-amber-400 border-amber-500"
                        : "bg-blue-500/10 text-blue-400 border-blue-500"
                    )}
                  >
                    {isSystem ? t("drawer.badgeOfficial") : t("drawer.badgeSelfHosted")}
                  </Badge>
                  {isSystem && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Lock className="size-3" /> {t("drawer.secureProtocol")}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Scrollable Content Area */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-8 relative z-10">
            {/* Basic Info */}
            <div className="space-y-3">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {t("drawer.name")}
              </Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("drawer.name")}
                  className="bg-white/5 border-white/10 h-10 text-sm"
              />
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("drawer.description")}
                  className="bg-white/5 border-white/10 h-10 text-sm"
              />
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Switch checked={enabled} onCheckedChange={setEnabled} />
                <span>{enabled ? t("drawer.enabled") : t("drawer.disabled")}</span>
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {t("drawer.iconLabel")}
                </Label>
                <ProviderIconPicker value={icon} onChange={setIcon} />
                <Input
                  value={customIconUrl}
                  onChange={(e) => setCustomIconUrl(e.target.value)}
                  placeholder="https://example.com/icon.png"
                  className="bg-white/5 border-white/10 h-9 text-xs"
                />
                <p className="text-[10px] text-muted-foreground/60">
                  {t("drawer.iconHint")}
                </p>
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {t("drawer.brandColor")}
                </Label>
                <div className="flex items-center gap-3">
                  <Input
                    type="color"
                    value={brandColor}
                    onChange={(e) => setBrandColor(e.target.value)}
                    className="h-10 w-20 p-1 bg-white/5 border-white/10"
                  />
                  <Input
                    value={brandColor}
                    onChange={(e) => setBrandColor(e.target.value)}
                    className="bg-white/5 border-white/10 h-10 text-xs font-mono"
                  />
                </div>
                <p className="text-[10px] text-muted-foreground/60">
                  {t("drawer.colorHint")}
                </p>
              </div>
            </div>
            
            {/* Custom Mode: Protocol Switcher */}
            {!isSystem && (
              <div className="space-y-3">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {t("drawer.protocolLabel")}
                </Label>
                <Tabs 
                  value={protocol} 
                  onValueChange={(v) => setProtocol(v as any)}
                  className="w-full"
                >
                  <TabsList className="w-full grid grid-cols-2 bg-white/5 border border-white/10 p-1">
                    <TabsTrigger value="openai" className="data-[state=active]:bg-white/10">OpenAI</TabsTrigger>
                    <TabsTrigger value="anthropic" className="data-[state=active]:bg-white/10">Anthropic</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            )}

            {/* Zone B: Connection Pipe */}
            <div className="space-y-3 group">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {t("drawer.endpointLabel")}
                </Label>
                {!isSystem && (
                  <button 
                    onClick={handleTestConnection}
                    className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors"
                  >
                    <Zap className="size-3" /> {t("drawer.pingCheck")}
                  </button>
                )}
              </div>
              
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
                  {isSystem ? <Lock className="size-4 opacity-50" /> : <Terminal className="size-4 text-blue-400" />}
                </div>
                <Input
                  value={baseUrl}
                  onChange={(e) => !isSystem && setBaseUrl(e.target.value)}
                  readOnly={isSystem}
                  className={cn(
                    "pl-9 bg-white/5 border-white/10 transition-all duration-300 font-mono text-sm",
                    isSystem 
                      ? "text-muted-foreground cursor-default focus-visible:ring-0" 
                      : "focus:border-blue-500/50 focus:bg-blue-900/10 text-blue-100"
                  )}
                  placeholder="http://localhost:11434"
                />
                
                {/* Visual Feedback Line (Heartbeat) */}
                <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-white/5 overflow-hidden rounded-b-md">
                  {connectionStatus === 'testing' && (
                    <motion.div 
                      className="h-full bg-gradient-to-r from-transparent via-blue-500 to-transparent w-1/2"
                      animate={{ x: ["-100%", "200%"] }}
                      transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                    />
                  )}
                  {connectionStatus === 'success' && (
                    <div className="h-full w-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
                  )}
                  {connectionStatus === 'error' && (
                    <div className="h-full w-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]" />
                  )}
                </div>
              </div>

              {/* Console Log Area (Slide down) */}
              <AnimatePresence>
                {logs.length > 0 && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-2 p-3 rounded-lg bg-black/50 border border-white/10 font-mono text-[10px] text-muted-foreground space-y-1">
                      {logs.map((log, i) => (
                        <div key={i} className={cn(
                          log.includes("success") ? "text-emerald-400" : 
                          log.toLowerCase().includes("fail") ? "text-red-400" : ""
                        )}>
                          {log}
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Zone C: Credentials */}
            <div className="space-y-3">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {t("drawer.secretKey")}
                {!isSystem && <span className="ml-2 text-[10px] normal-case opacity-50">{t("drawer.noAuth")}</span>}
              </Label>
              <div className="relative">
                <Key className={cn(
                  "absolute left-3 top-1/2 -translate-y-1/2 size-4 pointer-events-none transition-colors",
                  apiKey ? (isSystem ? "text-emerald-400" : "text-blue-400") : "text-muted-foreground"
                )} />
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={isSystem ? "sk-..." : t("drawer.noAuth")}
                  className={cn(
                    "pl-9 bg-white/5 border-white/10 h-12 text-base transition-all duration-300",
                    "placeholder:text-muted-foreground/30",
                    apiKey && isSystem && "border-emerald-500/30 shadow-[0_0_15px_-5px_rgba(16,185,129,0.2)] focus:border-emerald-500/50",
                    apiKey && !isSystem && "border-blue-500/30 shadow-[0_0_15px_-5px_rgba(59,130,246,0.2)] focus:border-blue-500/50"
                  )}
                />
              </div>
            </div>

            {/* Advanced Settings (Accordion) */}
            <Collapsible className="group">
              <CollapsibleTrigger asChild>
                <button className="flex items-center gap-2 text-xs text-muted-foreground hover:text-white transition-colors w-full">
                  <ChevronDown className="size-3 group-data-[state=open]:rotate-180 transition-transform" />
                  {t("drawer.advanced")}
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">{t("drawer.modelPrefixLabel")}</Label>
                  <Input 
                    placeholder="e.g. azure-deployment-" 
                    className="bg-white/5 border-white/10 h-8 text-xs" 
                    disabled
                  />
                  <p className="text-[10px] text-muted-foreground/50">
                    {t("drawer.modelsHint")}
                  </p>
                </div>

                {normalizedSlug.includes("azure") && (
                  <div className="space-y-3">
                    <Label className="text-xs text-muted-foreground">{t("drawer.azureResource")}</Label>
                    <Input
                      value={resourceName}
                      onChange={(e) => setResourceName(e.target.value)}
                      placeholder="your-resource"
                      className="bg-white/5 border-white/10 h-9 text-sm"
                    />
                    <Label className="text-xs text-muted-foreground">{t("drawer.azureDeployment")}</Label>
                    <Input
                      value={deploymentName}
                      onChange={(e) => setDeploymentName(e.target.value)}
                      placeholder="gpt-4o"
                      className="bg-white/5 border-white/10 h-9 text-sm"
                    />
                    <Label className="text-xs text-muted-foreground">{t("drawer.azureApiVersion")}</Label>
                    <Input
                      value={apiVersion}
                      onChange={(e) => setApiVersion(e.target.value)}
                      placeholder="2023-05-15"
                      className="bg-white/5 border-white/10 h-9 text-sm"
                    />
                    <p className="text-[10px] text-muted-foreground/50">{t("drawer.azureHint")}</p>
                  </div>
                )}

                {normalizedSlug.includes("vertex") && (
                  <div className="space-y-3">
                    <Label className="text-xs text-muted-foreground">{t("drawer.vertexProject")}</Label>
                    <Input
                      value={projectId}
                      onChange={(e) => setProjectId(e.target.value)}
                      placeholder="my-gcp-project"
                      className="bg-white/5 border-white/10 h-9 text-sm"
                    />
                    <Label className="text-xs text-muted-foreground">{t("drawer.vertexRegion")}</Label>
                    <Input
                      value={region}
                      onChange={(e) => setRegion(e.target.value)}
                      placeholder="us-central1"
                      className="bg-white/5 border-white/10 h-9 text-sm"
                    />
                    <p className="text-[10px] text-muted-foreground/50">{t("drawer.vertexHint")}</p>
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>

          </div>

          {/* Zone D: Action Bar */}
          <div className="flex-none p-6 border-t border-white/10 bg-black/20 backdrop-blur-md relative z-20">
            <div className="flex gap-3">
              <GlassButton 
                variant="ghost" 
                  className="flex-1 text-muted-foreground hover:text-white hover:bg-white/5" 
                  onClick={onClose}
                >
                {t("drawer.cancel")}
                </GlassButton>
              
              {isSystem ? (
                // Official Mode: Direct Save
                <GlassButton 
                  className="flex-[2]"
                  onClick={handleSave}
                  disabled={saving}
                  style={{ 
                    backgroundColor: themeColor, 
                    borderColor: themeColor, 
                    color: '#fff',
                    textShadow: '0 1px 2px rgba(0,0,0,0.2)' 
                  }}
                >
                  {saving ? <span className="flex items-center gap-2"><Save className="size-4 animate-pulse" /> {t("drawer.saving")}</span> : t("drawer.save")}
                </GlassButton>
              ) : (
                // Custom Mode: Test -> Save Flow
                <GlassButton 
                  className={cn(
                    "flex-[2] transition-all duration-500 relative overflow-hidden",
                    connectionStatus === 'success' 
                      ? "bg-emerald-600 border-emerald-500 hover:bg-emerald-500" 
                      : "bg-blue-600 border-blue-500 hover:bg-blue-500"
                  )}
                  onClick={connectionStatus === 'success' ? handleSave : handleTestConnection}
                  disabled={connectionStatus === 'testing' || saving}
                >
                  <div className="relative z-10 flex items-center justify-center gap-2">
                    {connectionStatus === 'testing' ? (
                      <>
                        <Zap className="size-4 animate-pulse" /> {t("drawer.pingCheck")}
                      </>
                    ) : connectionStatus === 'success' ? (
                      <>
                        <Check className="size-4" /> {t("drawer.save")}
                      </>
                    ) : (
                      <>
                        <Play className="size-4 fill-current" /> {t("drawer.pingCheck")}
                      </>
                    )}
                  </div>
                </GlassButton>
              )}
            </div>
            
            {!isSystem && connectionStatus === 'error' && (
              <div className="mt-3 text-center">
                <button 
                  onClick={handleSave}
                  className="text-[10px] text-red-400 hover:text-red-300 underline decoration-red-400/30 underline-offset-2"
                  disabled={saving}
                >
                  {t("drawer.save")}
                </button>
              </div>
            )}
          </div>

        </div>
      </SheetContent>
    </Sheet>
  )
}

export default ConnectProviderDrawer
