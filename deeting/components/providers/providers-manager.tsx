"use client"

import * as React from "react"
// import { useTranslations } from "next-intl" // Pending i18n setup
import { motion, AnimatePresence } from "framer-motion"
import { 
  Activity, 
  MoreHorizontal, 
  Plus, 
  Settings2, 
  Trash2, 
  Server,
  Cloud,
  Cpu,
  Check,
  Loader2,
  Key,
  Globe,
  Save
} from "lucide-react"
import { Line, LineChart, ResponsiveContainer } from "recharts"
import { useRouter } from "next/navigation"

import { GlassButton } from "@/components/ui/glass-button"
import { GlassCard } from "@/components/ui/glass-card"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet"

interface Channel {
  id: string
  name: string
  provider: string
  modelCount: number
  latency: number
  status: string
  type: string
  enabled: boolean
  lastHeartbeat: number[]
  theme: string
  baseUrl: string
  apiKey: string
}

// Mock Data for Active Channels
const ACTIVE_CHANNELS: Channel[] = [
  {
    id: "inst_1",
    name: "Production GPT-4",
    provider: "OpenAI",
    modelCount: 3,
    latency: 450, // ms
    status: "active", // active, error, offline
    type: "cloud",
    enabled: true,
    lastHeartbeat: [420, 450, 430, 460, 440, 410, 480, 450, 430, 420],
    theme: "emerald",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "sk-proj-****************"
  },
  {
    id: "inst_2",
    name: "Local DeepSeek",
    provider: "Ollama",
    modelCount: 1,
    latency: 24, // ms
    status: "active",
    type: "local",
    enabled: true,
    lastHeartbeat: [22, 25, 20, 28, 24, 21, 26, 23, 22, 24],
    theme: "blue",
    baseUrl: "http://localhost:11434",
    apiKey: ""
  },
  {
    id: "inst_3",
    name: "Anthropic Backup",
    provider: "Anthropic",
    modelCount: 2,
    latency: 0,
    status: "offline",
    type: "cloud",
    enabled: false,
    lastHeartbeat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    theme: "amber",
    baseUrl: "https://api.anthropic.com",
    apiKey: "sk-ant-****************"
  }
]

export function ProvidersManager() {
  const router = useRouter()
  // const t = useTranslations("Providers") // Pending i18n setup

  const [selectedChannel, setSelectedChannel] = React.useState<Channel | null>(null)
  const [isSheetOpen, setIsSheetOpen] = React.useState(false)

  const handleConfigure = (channel: Channel) => {
    setSelectedChannel(channel)
    setIsSheetOpen(true)
  }

  return (
    <div className="space-y-8 p-6 lg:p-10 max-w-[1600px] mx-auto">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight text-[var(--foreground)]">
            Neural Links
          </h1>
          <p className="text-[var(--muted)]">
            Manage your active AI provider connections and gateways.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <GlassButton 
            variant="outline" 
            onClick={() => router.push("/dashboard/user/providers/market")}
          >
            <Plus className="mr-2 size-4" />
            Connect New Provider
          </GlassButton>
        </div>
      </div>

      {/* Active Uplinks List */}
      <div className="grid gap-4">
        {ACTIVE_CHANNELS.map((channel, index) => (
          <ChannelRow 
            key={channel.id} 
            channel={channel} 
            index={index} 
            onConfigure={() => handleConfigure(channel)}
          />
        ))}
      </div>

      {/* Configuration Drawer */}
      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetContent className={`backdrop-blur-xl bg-[var(--background)]/80 border-l border-white/10 sm:max-w-md w-full`}>
          {selectedChannel && (
            <ConfigurationPanel channel={selectedChannel} onClose={() => setIsSheetOpen(false)} />
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}

// Theme Mapping for Tailwind
const THEME_MAP: Record<string, { bg: string, border: string, text: string, from: string }> = {
  emerald: {
    bg: "bg-emerald-500/20",
    border: "border-emerald-500/30",
    text: "text-emerald-500",
    from: "from-emerald-500/20"
  },
  blue: {
    bg: "bg-blue-500/20",
    border: "border-blue-500/30",
    text: "text-blue-500",
    from: "from-blue-500/20"
  },
  amber: {
    bg: "bg-amber-500/20",
    border: "border-amber-500/30",
    text: "text-amber-500",
    from: "from-amber-500/20"
  },
  default: {
    bg: "bg-gray-500/20",
    border: "border-gray-500/30",
    text: "text-gray-500",
    from: "from-gray-500/20"
  }
}

function ConfigurationPanel({ channel, onClose }: { channel: Channel, onClose: () => void }) {
  const [apiKey, setApiKey] = React.useState(channel.apiKey)
  const [isValidating, setIsValidating] = React.useState(false)
  const [isValid, setIsValid] = React.useState(false)

  // Simulate API Key Validation
  React.useEffect(() => {
    if (apiKey.startsWith("sk-") && apiKey.length > 10) {
      setIsValidating(true)
      const timer = setTimeout(() => {
        setIsValidating(false)
        setIsValid(true)
      }, 1500)
      return () => clearTimeout(timer)
    } else {
      setIsValid(false)
    }
  }, [apiKey])

  const theme = THEME_MAP[channel.theme] || THEME_MAP.default

  return (
    <div className="flex flex-col h-full">
      <SheetHeader className="pb-6 border-b border-[var(--border)]/20">
        <div className="flex items-center gap-3">
           <div className={`size-10 rounded-xl flex items-center justify-center bg-gradient-to-br ${theme.from} to-transparent border ${theme.border} ${theme.text}`}>
              {channel.provider === "Ollama" ? <Cpu className="size-5" /> : <Cloud className="size-5" />}
           </div>
           <div>
             <SheetTitle>{channel.name}</SheetTitle>
             <SheetDescription>Configure connection settings</SheetDescription>
           </div>
        </div>
      </SheetHeader>

      <div className="flex-1 py-8 px-4 sm:px-6 space-y-8">
        {/* Endpoint Section */}
        <div className="space-y-4">
          <Label className="text-sm font-medium text-[var(--foreground)]">API Endpoint</Label>
          <div className="relative">
            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[var(--muted)]" />
            <Input 
              defaultValue={channel.baseUrl} 
              className="pl-9 bg-[var(--surface)]/50 border-white/10 focus:border-[var(--primary)]/50 transition-colors"
            />
          </div>
        </div>

        {/* API Key Section with Animation */}
        <div className="space-y-4">
          <Label className="text-sm font-medium text-[var(--foreground)]">Secret Key</Label>
          <div className="relative group">
            <Key className={`absolute left-3 top-1/2 -translate-y-1/2 size-4 transition-colors ${isValid ? "text-emerald-500" : "text-[var(--muted)]"}`} />
            <Input 
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className={`pl-9 pr-10 bg-[var(--surface)]/50 border-white/10 transition-all duration-300 ${isValid ? "border-emerald-500/50 shadow-[0_0_15px_-3px_rgba(16,185,129,0.2)]" : "focus:border-[var(--primary)]/50"}`}
              type="password"
              placeholder="sk-..."
            />
            
            {/* Validation Indicator */}
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <AnimatePresence mode="wait">
                {isValidating ? (
                  <motion.div
                    key="loading"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                  >
                    <Loader2 className="size-4 animate-spin text-[var(--primary)]" />
                  </motion.div>
                ) : isValid ? (
                  <motion.div
                    key="valid"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                  >
                    <Check className="size-4 text-emerald-500" />
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          </div>
          <p className="text-xs text-[var(--muted)]">
            {channel.provider} keys are stored encrypted.
          </p>
        </div>

        <div className="space-y-4 pt-4 border-t border-[var(--border)]/20">
             <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Heartbeat Check</Label>
                  <p className="text-xs text-[var(--muted)]">Ping every 30 seconds</p>
                </div>
                <Switch defaultChecked />
             </div>
        </div>
      </div>

      <SheetFooter className="border-t border-[var(--border)]/20 pt-6">
        <GlassButton className="w-full" onClick={onClose}>
          <Save className="mr-2 size-4" />
          Save Changes
        </GlassButton>
      </SheetFooter>
    </div>
  )
}

// Provider Icon Logic (Placeholder)
function ProviderIcon({ provider }: { provider: string }) {
  if (provider === "Ollama") return <Cpu className="size-5" />
  if (provider === "Local") return <Server className="size-5" />
  return <Cloud className="size-5" />
}

function ChannelRow({ channel, index, onConfigure }: { channel: Channel, index: number, onConfigure: () => void }) {
  const isOffline = channel.status === "offline"
  
  // Status Color Logic
  const getStatusColor = (latency: number, status: string) => {
    if (status !== "active") return "text-red-500"
    if (latency < 200) return "text-emerald-500"
    if (latency < 1000) return "text-yellow-500"
    return "text-red-500"
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1, duration: 0.4 }}
    >
      <GlassCard 
        className={`group relative overflow-hidden transition-all duration-300 hover:shadow-lg ${isOffline ? 'opacity-70 grayscale-[0.5]' : ''}`}
        padding="none"
        innerBorder={false} // We'll add custom border logic
      >
        {/* Active Border Glow on Hover */}
        <div className={`absolute inset-0 border-2 border-transparent transition-colors duration-300 group-hover:border-[var(--primary)]/20 rounded-2xl pointer-events-none`} />

        <div className="flex flex-col md:flex-row items-center p-4 gap-6">
          
          {/* 1. Logo & Identity */}
          <div className="flex items-center gap-4 min-w-[240px]">
            <div className={`relative flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-white/10 to-white/5 border border-white/10 shadow-inner ${isOffline ? 'text-gray-400' : 'text-[var(--foreground)]'}`}>
              <ProviderIcon provider={channel.provider} />
              {/* Ping Indicator Ring */}
              {!isOffline && (
                <span className="absolute -top-1 -right-1 flex size-3">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${getStatusColor(channel.latency, channel.status).replace('text-', 'bg-')}`}></span>
                  <span className={`relative inline-flex rounded-full size-3 ${getStatusColor(channel.latency, channel.status).replace('text-', 'bg-')}`}></span>
                </span>
              )}
            </div>
            <div>
              <h3 className="font-semibold text-[var(--foreground)] flex items-center gap-2">
                {channel.name}
                {channel.type === "local" && (
                  <Badge variant="outline" className="text-[10px] h-5 px-1.5 border-[var(--primary)]/30 text-[var(--primary)]">
                    LOCAL
                  </Badge>
                )}
              </h3>
              <p className="text-sm text-[var(--muted)]">{channel.modelCount} Models Synced</p>
            </div>
          </div>

          {/* 2. Sparkline (Heartbeat) */}
          <div className="flex-1 h-[40px] w-full min-w-[100px] opacity-50 group-hover:opacity-100 transition-opacity">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={channel.lastHeartbeat.map((val: number, i: number) => ({ i, val }))}>
                <Line 
                  type="monotone" 
                  dataKey="val" 
                  stroke={isOffline ? "#9ca3af" : (channel.latency < 200 ? "#10b981" : "#f59e0b")} 
                  strokeWidth={2} 
                  dot={false} 
                  isAnimationActive={true}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* 3. Metrics & Controls */}
          <div className="flex items-center gap-6 md:ml-auto">
            {/* Latency */}
            <div className="flex flex-col items-end min-w-[80px]">
              <div className={`flex items-center gap-1.5 text-sm font-medium ${getStatusColor(channel.latency, channel.status)}`}>
                <Activity className="size-3.5" />
                {isOffline ? "OFFLINE" : `${channel.latency}ms`}
              </div>
              <span className="text-xs text-[var(--muted)]">Latency</span>
            </div>

            {/* Toggle */}
            <div className="flex items-center gap-4">
              <Switch checked={channel.enabled} />
              
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <GlassButton variant="ghost" size="icon-sm" className="opacity-0 group-hover:opacity-100 transition-opacity">
                    <MoreHorizontal className="size-4" />
                  </GlassButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[160px]">
                  <DropdownMenuItem onClick={onConfigure}>
                    <Settings2 className="mr-2 size-4" />
                    Configure
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-red-600 focus:text-red-600">
                    <Trash2 className="mr-2 size-4" />
                    Disconnect
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

        </div>
      </GlassCard>
    </motion.div>
  )
}
