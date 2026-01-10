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

export default function ProviderMarketPage() {
  const [selectedCategory, setSelectedCategory] = React.useState("all")

  const filteredProviders = React.useMemo(() => {
    if (selectedCategory === "all") return PROVIDERS
    if (selectedCategory === "cloud") return PROVIDERS.filter(p => p.category === "Cloud API")
    if (selectedCategory === "local") return PROVIDERS.filter(p => p.category === "Local Hosted")
    if (selectedCategory === "custom") return PROVIDERS.filter(p => p.category === "Custom")
    return PROVIDERS
  }, [selectedCategory])

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
            </p>
          </div>
          {/* Search Placeholder */}
          <div className="relative w-full md:w-[320px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--muted)]" />
            <Input 
              placeholder="Search providers..." 
              className="pl-9 bg-[var(--surface)]/50 border-white/10"
            />
          </div>
        </div>

        {/* Category Tabs */}
        <Tabs defaultValue="all" onValueChange={setSelectedCategory} className="w-full">
          <TabsList className="bg-[var(--surface)]/50 backdrop-blur-md border border-white/5 p-1 h-auto rounded-xl">
            <TabsTrigger value="all" className="rounded-lg px-4 py-2 data-[state=active]:bg-[var(--card)] data-[state=active]:text-[var(--primary)] data-[state=active]:shadow-sm">All Providers</TabsTrigger>
            <TabsTrigger value="cloud" className="rounded-lg px-4 py-2 data-[state=active]:bg-[var(--card)] data-[state=active]:text-[var(--primary)] data-[state=active]:shadow-sm">Cloud API</TabsTrigger>
            <TabsTrigger value="local" className="rounded-lg px-4 py-2 data-[state=active]:bg-[var(--card)] data-[state=active]:text-[var(--primary)] data-[state=active]:shadow-sm">Local Hosted</TabsTrigger>
            <TabsTrigger value="custom" className="rounded-lg px-4 py-2 data-[state=active]:bg-[var(--card)] data-[state=active]:text-[var(--primary)] data-[state=active]:shadow-sm">Custom</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Provider Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {filteredProviders.map((provider, index) => (
          <ProviderCard key={provider.id} provider={provider} index={index} />
        ))}
        
        {/* Placeholder for "Request New" */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
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

function ProviderCard({ provider, index }: { provider: any, index: number }) {
  const Icon = provider.logo

  // Extract color name safely for gradient
  // Assuming logoColor is like "text-emerald-400"
  const colorName = provider.logoColor.split('-')[1]
  
  const gradientMap: Record<string, string> = {
    emerald: "from-emerald-500",
    amber: "from-amber-500",
    blue: "from-blue-500",
    slate: "from-slate-500",
    indigo: "from-indigo-500",
    sky: "from-sky-500",
    purple: "from-purple-500",
  }
  
  const gradientClass = gradientMap[colorName] || "from-gray-500"

  // Define shadow color based on the logo color
  const shadowColorMap: Record<string, string> = {
    emerald: "rgba(16, 185, 129, 0.4)",
    amber: "rgba(245, 158, 11, 0.4)",
    blue: "rgba(59, 130, 246, 0.4)",
    slate: "rgba(100, 116, 139, 0.4)",
    indigo: "rgba(99, 102, 241, 0.4)",
    sky: "rgba(14, 165, 233, 0.4)",
    purple: "rgba(168, 85, 247, 0.4)",
  }
  const shadowColor = shadowColorMap[colorName] || "rgba(156, 163, 175, 0.4)"

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
