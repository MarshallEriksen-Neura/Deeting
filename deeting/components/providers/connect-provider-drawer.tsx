"use client"

import * as React from "react"
import { motion, AnimatePresence } from "framer-motion"
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

import { Sheet, SheetContent } from "@/components/ui/sheet"
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

// Types based on the prompt
export interface ProviderPresetConfig {
  name: string
  type: 'system' | 'custom'
  default_endpoint?: string
  protocol: 'openai' | 'anthropic'
  brand_color: string // e.g., '#10a37f'
  icon_key: string
}

interface ConnectProviderDrawerProps {
  isOpen: boolean
  onClose: () => void
  preset: ProviderPresetConfig | null
  onSave: (data: any) => void
}

export function ConnectProviderDrawer({ 
  isOpen, 
  onClose, 
  preset, 
  onSave 
}: ConnectProviderDrawerProps) {
  // If no preset, don't render (or render empty)
  if (!preset) return null

  const isSystem = preset.type === 'system'
  
  // State
  const [baseUrl, setBaseUrl] = React.useState(preset.default_endpoint || "")
  const [apiKey, setApiKey] = React.useState("")
  const [protocol, setProtocol] = React.useState(preset.protocol)
  const [connectionStatus, setConnectionStatus] = React.useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [logs, setLogs] = React.useState<string[]>([])
  
  // Reset state when preset changes
  React.useEffect(() => {
    if (isOpen && preset) {
      setBaseUrl(preset.default_endpoint || "")
      setApiKey("")
      setProtocol(preset.protocol)
      setConnectionStatus('idle')
      setLogs([])
    }
  }, [isOpen, preset])

  // Mock Test Connection
  const handleTestConnection = async () => {
    setConnectionStatus('testing')
    setLogs([])
    
    // Simulation
    setTimeout(() => {
      setLogs(prev => [...prev, "> Resolving host..."])
    }, 500)

    setTimeout(() => {
      setLogs(prev => [...prev, "> Handshake initiated..."])
    }, 1200)

    setTimeout(() => {
      // Random success/fail for demo
      const isSuccess = baseUrl.length > 5 // Simple mock check
      
      if (isSuccess) {
        setConnectionStatus('success')
        setLogs(prev => [...prev, "> Handshake success (24ms)", "> Detected models: [llama3:8b, mistral:v0.3]"])
      } else {
        setConnectionStatus('error')
        setLogs(prev => [...prev, "> Connection Refused. Check your CORS or Docker network."])
      }
    }, 2500)
  }

  const handleSave = () => {
    onSave({
      baseUrl,
      apiKey,
      protocol,
      name: preset.name, // In real app, user might edit name
    })
    onClose()
  }

  // Visual Styles based on mode
  const themeColor = preset.brand_color
  const glowStyle = isSystem 
    ? { boxShadow: `0 0 40px -10px ${themeColor}40` }
    : { boxShadow: `0 0 40px -10px rgba(59, 130, 246, 0.2)` } // Blue neon for custom

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent 
        className="w-full sm:max-w-md p-0 border-l border-white/10 bg-black/40 backdrop-blur-2xl text-[var(--foreground)]"
      >
        <div className="flex flex-col h-full relative overflow-hidden">
          
          {/* Ambient Background Glow */}
          <div 
            className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-64 opacity-20 pointer-events-none"
            style={{ 
              background: `radial-gradient(circle at 50% 0%, ${isSystem ? themeColor : '#3b82f6'}, transparent 70%)` 
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
                  {isSystem ? (
                    // Placeholder for Brand Icon (using generic Globe/Cpu if icon_key fails)
                    <Globe className="size-10" style={{ color: themeColor }} />
                  ) : (
                    // Custom Icon - Maybe interactive in future
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
                  {isSystem ? `Configure ${preset.name}` : "Add Custom Endpoint"}
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
                    {isSystem ? "Official" : "Self-Hosted"}
                  </Badge>
                  {isSystem && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Lock className="size-3" /> Secure Protocol
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Scrollable Content Area */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-8 relative z-10">
            
            {/* Custom Mode: Protocol Switcher */}
            {!isSystem && (
              <div className="space-y-3">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Protocol Interface
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
                  Endpoint URL
                </Label>
                {!isSystem && (
                  <button 
                    onClick={handleTestConnection}
                    className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors"
                  >
                    <Zap className="size-3" /> Ping Check
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
                          log.includes("Refused") ? "text-red-400" : ""
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
                Authentication
                {!isSystem && <span className="ml-2 text-[10px] normal-case opacity-50">(Optional for local)</span>}
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
                  placeholder={isSystem ? "sk-..." : "No auth required"}
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
                  Advanced Settings
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Model ID Mapping Prefix</Label>
                  <Input 
                    placeholder="e.g. azure-deployment-" 
                    className="bg-white/5 border-white/10 h-8 text-xs" 
                  />
                  <p className="text-[10px] text-muted-foreground/50">
                    Useful for Azure or custom deployments with complex model names.
                  </p>
                </div>
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
                Cancel
              </GlassButton>
              
              {isSystem ? (
                // Official Mode: Direct Save
                <GlassButton 
                  className="flex-[2]"
                  onClick={handleSave}
                  style={{ 
                    backgroundColor: themeColor, 
                    borderColor: themeColor, 
                    color: '#fff',
                    textShadow: '0 1px 2px rgba(0,0,0,0.2)' 
                  }}
                >
                  Save Channel
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
                  disabled={connectionStatus === 'testing'}
                >
                  <div className="relative z-10 flex items-center justify-center gap-2">
                    {connectionStatus === 'testing' ? (
                      <>
                        <Zap className="size-4 animate-pulse" /> Testing...
                      </>
                    ) : connectionStatus === 'success' ? (
                      <>
                        <Check className="size-4" /> Save Channel
                      </>
                    ) : (
                      <>
                        <Play className="size-4 fill-current" /> Test Connection
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
                >
                  Save without verifying (Force)
                </button>
              </div>
            )}
          </div>

        </div>
      </SheetContent>
    </Sheet>
  )
}
