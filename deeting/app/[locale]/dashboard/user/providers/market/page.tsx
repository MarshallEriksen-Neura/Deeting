"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { 
  Search, 
  Globe, 
  Cpu, 
  Box, 
  Terminal, 
  ArrowRight,
  Plus
} from "lucide-react"

import { GlassButton } from "@/components/ui/glass-button"
import { GlassCard } from "@/components/ui/glass-card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

// Mock Data for Provider Market
const PROVIDERS = [
  {
    id: "openai",
    name: "OpenAI",
    description: "Industry standard for advanced reasoning and generation.",
    type: "cloud",
    category: "Cloud API",
    logoBg: "bg-emerald-950",
    logoColor: "text-emerald-400",
    logo: Globe, // Placeholder for actual logo
    popular: true,
  },
  {
    id: "anthropic",
    name: "Anthropic",
    description: "Focus on safety and large context windows.",
    type: "cloud",
    category: "Cloud API",
    logoBg: "bg-amber-950",
    logoColor: "text-amber-400",
    logo: Box,
    popular: true,
  },
  {
    id: "google",
    name: "Google Gemini",
    description: "Multimodal capabilities with native video understanding.",
    type: "cloud",
    category: "Cloud API",
    logoBg: "bg-blue-950",
    logoColor: "text-blue-400",
    logo: Globe,
    popular: false,
  },
  {
    id: "ollama",
    name: "Ollama",
    description: "Run Llama 3, Mistral, and other LLMs locally.",
    type: "local",
    category: "Local Hosted",
    logoBg: "bg-slate-950",
    logoColor: "text-white",
    logo: Terminal,
    popular: true,
  },
  {
    id: "vllm",
    name: "vLLM",
    description: "High-throughput and memory-efficient inference engine.",
    type: "local",
    category: "Local Hosted",
    logoBg: "bg-indigo-950",
    logoColor: "text-indigo-400",
    logo: Cpu,
    popular: false,
  },
  {
    id: "azure",
    name: "Azure OpenAI",
    description: "Enterprise-grade OpenAI models on Azure infrastructure.",
    type: "cloud",
    category: "Cloud API",
    logoBg: "bg-sky-900",
    logoColor: "text-sky-300",
    logo: CloudIcon,
    popular: false,
  },
  {
    id: "custom",
    name: "Custom HTTP",
    description: "Connect to any OpenAI-compatible API endpoint.",
    type: "custom",
    category: "Custom",
    logoBg: "bg-purple-950",
    logoColor: "text-purple-400",
    logo: Box, // Placeholder
    popular: false,
  }
]

function CloudIcon(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17.5 19c0-1.7-1.3-3-3-3h-11c-1.7 0-3 1.3-3 3s1.3 3 3 3h11c1.7 0 3-1.3 3-3z" />
      <path d="M17.5 19v-9c0-2.8-2.2-5-5-5s-5 2.2-5 5v2" />
      <path d="M20.5 19h-3" />
    </svg>
  )
}

"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { 
  Search, 
  Globe, 
  Cpu, 
  Box, 
  Terminal, 
  ArrowRight,
  Plus,
  Loader2,
  AlertCircle
} from "lucide-react"
import { Icon } from "@iconify/react"

import { GlassButton } from "@/components/ui/glass-button"
import { GlassCard } from "@/components/ui/glass-card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { useProviderHub } from "@/hooks/use-providers"
import { type ProviderCard as ProviderCardType } from "@/lib/api/providers"

// Category mapping for filtering
const CATEGORY_MAPPING = {
  all: undefined,
  cloud: "cloud",
  local: "local", 
  custom: "custom"
} as const

export default function ProviderMarketPage() {
  const [selectedCategory, setSelectedCategory] = React.useState<keyof typeof CATEGORY_MAPPING>("all")
  const [searchQuery, setSearchQuery] = React.useState("")
  
  // Debounce search query for performance
  const [debouncedQuery, setDebouncedQuery] = React.useState("")
  
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery)
    }, 300)
    
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Fetch providers with optimized parameters
  const queryParams = React.useMemo(() => ({
    category: CATEGORY_MAPPING[selectedCategory],
    q: debouncedQuery || undefined,
    include_public: true,
  }), [selectedCategory, debouncedQuery])

  const { 
    providers, 
    stats, 
    isLoading, 
    isError, 
    error 
  } = useProviderHub(queryParams)

  // Error state
  if (isError) {
    return (
      <div className="space-y-8 p-6 lg:p-10 max-w-[1600px] mx-auto min-h-screen">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Failed to load providers: {error?.message || "Unknown error"}
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="space-y-8 p-6 lg:p-10 max-w-[1600px] mx-auto min-h-screen">
      {/* Header Section */}
      <div className="space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold tracking-tight text-[var(--foreground)]">
              Provider Hub
            </h1>
            <p className="text-[var(--muted)]">
              Browse and connect to AI model providers.
              {stats && (
                <span className="ml-2 text-sm">
                  ({stats.total} providers, {stats.connected} connected)
                </span>
              )}
            </p>
          </div>
          
          {/* Search */}
          <div className="relative w-full md:w-[320px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--muted)]" />
            <Input 
              placeholder="Search providers..." 
              className="pl-9 bg-[var(--surface)]/50 border-white/10"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Category Tabs */}
        <Tabs 
          defaultValue="all" 
          onValueChange={(value) => setSelectedCategory(value as keyof typeof CATEGORY_MAPPING)} 
          className="w-full"
        >
          <TabsList className="bg-[var(--surface)]/50 backdrop-blur-md border border-white/5 p-1 h-auto rounded-xl">
            <TabsTrigger value="all" className="rounded-lg px-4 py-2 data-[state=active]:bg-[var(--card)] data-[state=active]:text-[var(--primary)] data-[state=active]:shadow-sm">
              All Providers
              {stats && <span className="ml-1 text-xs opacity-70">({stats.total})</span>}
            </TabsTrigger>
            <TabsTrigger value="cloud" className="rounded-lg px-4 py-2 data-[state=active]:bg-[var(--card)] data-[state=active]:text-[var(--primary)] data-[state=active]:shadow-sm">
              Cloud API
              {stats?.by_category?.cloud && <span className="ml-1 text-xs opacity-70">({stats.by_category.cloud})</span>}
            </TabsTrigger>
            <TabsTrigger value="local" className="rounded-lg px-4 py-2 data-[state=active]:bg-[var(--card)] data-[state=active]:text-[var(--primary)] data-[state=active]:shadow-sm">
              Local Hosted
              {stats?.by_category?.local && <span className="ml-1 text-xs opacity-70">({stats.by_category.local})</span>}
            </TabsTrigger>
            <TabsTrigger value="custom" className="rounded-lg px-4 py-2 data-[state=active]:bg-[var(--card)] data-[state=active]:text-[var(--primary)] data-[state=active]:shadow-sm">
              Custom
              {stats?.by_category?.custom && <span className="ml-1 text-xs opacity-70">({stats.by_category.custom})</span>}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--muted)]" />
          <span className="ml-2 text-[var(--muted)]">Loading providers...</span>
        </div>
      )}

      {/* Provider Grid */}
      {!isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {providers.map((provider, index) => (
            <ProviderCard key={provider.slug} provider={provider} index={index} />
          ))}
          
          {/* Request New Provider Card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: providers.length * 0.05 + 0.1 }}
          >
            <button className="w-full h-full min-h-[220px] rounded-2xl border-2 border-dashed border-[var(--muted)]/30 hover:border-[var(--primary)]/60 hover:bg-[var(--primary)]/5 transition-all duration-300 flex flex-col items-center justify-center gap-3 group text-[var(--muted)] hover:text-[var(--primary)] cursor-pointer">
              <div className="size-12 rounded-full bg-[var(--surface)]/80 backdrop-blur-sm flex items-center justify-center group-hover:scale-110 transition-transform shadow-sm border border-white/10">
                <Plus className="size-6" />
              </div>
              <span className="font-medium">Request Provider</span>
            </button>
          </motion.div>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && providers.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Box className="h-12 w-12 text-[var(--muted)] mb-4" />
          <h3 className="text-lg font-medium text-[var(--foreground)] mb-2">
            No providers found
          </h3>
          <p className="text-[var(--muted)] max-w-md">
            {searchQuery 
              ? `No providers match "${searchQuery}". Try adjusting your search or category filter.`
              : "No providers available in this category."
            }
          </p>
        </div>
      )}
    </div>
  )
}
          transition={{ delay: filteredProviders.length * 0.05 + 0.1 }}
        >
          <button className="w-full h-full min-h-[220px] rounded-2xl border-2 border-dashed border-[var(--muted)]/30 hover:border-[var(--primary)]/60 hover:bg-[var(--primary)]/5 transition-all duration-300 flex flex-col items-center justify-center gap-3 group text-[var(--muted)] hover:text-[var(--primary)] cursor-pointer">
            <div className="size-12 rounded-full bg-[var(--surface)]/80 backdrop-blur-sm flex items-center justify-center group-hover:scale-110 transition-transform shadow-sm border border-white/10">
              <Plus className="size-6" />
            </div>
            <span className="font-medium">Request Provider</span>
          </button>
        </motion.div>
      </div>
    </div>
  )
}

function ProviderCard({ provider, index }: { provider: ProviderCardType, index: number }) {
  // Get theme color or default
  const themeColor = provider.theme_color || "#6b7280"
  
  // Convert hex to RGB for shadow
  const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 107, g: 116, b: 139 }
  }
  
  const rgb = hexToRgb(themeColor)
  const shadowColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.4)`

  // Default icon based on category
  const getDefaultIcon = (category: string) => {
    switch (category.toLowerCase()) {
      case 'cloud': return Globe
      case 'local': return Terminal
      case 'custom': return Box
      default: return Cpu
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.4 }}
    >
      <GlassCard 
        className="group relative h-full flex flex-col transition-all duration-300 hover:shadow-xl hover:-translate-y-1 cursor-pointer overflow-hidden backdrop-blur-md bg-white/40 dark:bg-black/40 border-white/20"
        padding="lg"
      >
        {/* Background Gradient Effect on Hover */}
        <div 
          className="absolute inset-0 opacity-0 group-hover:opacity-10 transition-opacity duration-500 pointer-events-none"
          style={{
            background: `linear-gradient(135deg, ${themeColor}20 0%, transparent 100%)`
          }}
        />

        <div className="flex flex-col h-full gap-4">
          <div className="flex justify-between items-start">
            <div 
              className="size-14 rounded-2xl flex items-center justify-center shadow-lg ring-1 ring-white/10 group-hover:scale-110 transition-all duration-300 text-white"
              style={{
                backgroundColor: themeColor,
                boxShadow: `0 4px 15px -3px ${shadowColor}`
              }}
            >
              {provider.icon ? (
                <Icon icon={provider.icon} className="size-8" />
              ) : (
                React.createElement(getDefaultIcon(provider.category), { className: "size-8" })
              )}
            </div>
            
            <div className="flex flex-col gap-1">
              {provider.is_popular && (
                <Badge variant="secondary" className="bg-[var(--surface)] text-xs font-normal opacity-80 backdrop-blur-sm">
                  POPULAR
                </Badge>
              )}
              {provider.connected && (
                <Badge variant="default" className="bg-green-500/20 text-green-400 text-xs font-normal border-green-500/30">
                  CONNECTED
                </Badge>
              )}
            </div>
          </div>

          <div className="space-y-2 flex-1">
            <h3 className="text-lg font-bold text-[var(--foreground)] group-hover:text-[var(--primary)] transition-colors">
              {provider.name}
            </h3>
            <p className="text-sm text-[var(--muted)] leading-relaxed line-clamp-2">
              {provider.description || "No description available"}
            </p>
            
            {/* Tags */}
            {provider.tags && provider.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {provider.tags.slice(0, 3).map((tag) => (
                  <span 
                    key={tag}
                    className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[var(--surface)]/50 text-[var(--muted-foreground)] border border-[var(--border)]/30"
                  >
                    {tag}
                  </span>
                ))}
                {provider.tags.length > 3 && (
                  <span className="text-xs text-[var(--muted)]">
                    +{provider.tags.length - 3} more
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="pt-4 flex items-center justify-between border-t border-[var(--border)]/30">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[var(--surface)] text-[var(--muted-foreground)] border border-[var(--border)]/50">
              {provider.category}
            </span>
            
            <div className="flex items-center gap-1 text-xs font-semibold text-[var(--primary)] opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300">
              {provider.connected ? "Manage" : "Connect"} <ArrowRight className="size-3" />
            </div>
          </div>

          {/* Instance count indicator */}
          {provider.instances && provider.instances.length > 0 && (
            <div className="absolute top-3 right-3 size-6 rounded-full bg-[var(--primary)] text-white text-xs font-bold flex items-center justify-center">
              {provider.instances.length}
            </div>
          )}
        </div>
      </GlassCard>
    </motion.div>
  )
}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.4 }}
    >
      <GlassCard 
        className="group relative h-full flex flex-col transition-all duration-300 hover:shadow-xl hover:-translate-y-1 cursor-pointer overflow-hidden backdrop-blur-md bg-white/40 dark:bg-black/40 border-white/20"
        padding="lg"
      >
        {/* Background Gradient Effect on Hover */}
        <div className={`absolute inset-0 opacity-0 group-hover:opacity-10 transition-opacity duration-500 bg-gradient-to-br ${gradientClass} to-transparent pointer-events-none`} />

        <div className="flex flex-col h-full gap-4">
          <div className="flex justify-between items-start">
            <div 
              className={`size-14 rounded-2xl ${provider.logoBg} ${provider.logoColor} flex items-center justify-center shadow-lg ring-1 ring-white/10 group-hover:scale-110 transition-all duration-300`}
              style={{
                boxShadow: `0 4px 15px -3px ${shadowColor}`
              }}
            >
              <Icon className="size-8" />
            </div>
            {provider.popular && (
              <Badge variant="secondary" className="bg-[var(--surface)] text-xs font-normal opacity-80 backdrop-blur-sm">
                POPULAR
              </Badge>
            )}
          </div>

          <div className="space-y-2 flex-1">
            <h3 className="text-lg font-bold text-[var(--foreground)] group-hover:text-[var(--primary)] transition-colors">
              {provider.name}
            </h3>
            <p className="text-sm text-[var(--muted)] leading-relaxed">
              {provider.description}
            </p>
          </div>

          <div className="pt-4 flex items-center justify-between border-t border-[var(--border)]/30">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[var(--surface)] text-[var(--muted-foreground)] border border-[var(--border)]/50">
              {provider.category}
            </span>
            <div className="flex items-center gap-1 text-xs font-semibold text-[var(--primary)] opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300">
              Connect <ArrowRight className="size-3" />
            </div>
          </div>
        </div>
      </GlassCard>
    </motion.div>
  )
}
