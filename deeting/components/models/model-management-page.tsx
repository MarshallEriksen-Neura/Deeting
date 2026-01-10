"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { ArrowLeft, Settings } from "lucide-react"
import { useRouter } from "next/navigation"

import { cn } from "@/lib/utils"
import { GlassButton } from "@/components/ui/glass-button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

import { InstanceDashboard } from "./instance-dashboard"
import { FilterLens } from "./filter-lens"
import { ModelMatrix } from "./model-matrix"
import { TestDrawer } from "./test-drawer"
import { ModelEmptyState } from "./empty-state"
import type {
  ProviderInstance,
  ProviderModel,
  ModelFilterState,
  SyncState,
  TestMessage,
} from "./types"
import { getPriceTier } from "./types"

/**
 * ModelManagementPage - The Model Inventory / Registry Page
 *
 * A comprehensive page for managing AI models from a specific Provider Instance.
 * Features three-layer layout: Instance Dashboard, Filter Lens, and Model Matrix.
 */

// Mock data for demonstration
const MOCK_INSTANCE: ProviderInstance = {
  id: "inst_openai_1",
  name: "My Team OpenAI",
  provider: "openai",
  provider_display_name: "OpenAI",
  base_url: "https://api.openai.com/v1",
  status: "online",
  latency: 24,
  last_synced_at: new Date(Date.now() - 3600000).toISOString(),
  model_count: 15,
  theme_color: "#10a37f",
  is_enabled: true,
  health_check_interval: 30,
}

const MOCK_MODELS: ProviderModel[] = [
  {
    id: "gpt-4-turbo",
    object: "model",
    display_name: "Pro Model",
    capabilities: ["chat", "vision", "code", "reasoning"],
    context_window: 128000,
    pricing: { input: 10, output: 30 },
    is_active: true,
    updated_at: new Date().toISOString(),
    supports_functions: true,
    supports_json_mode: true,
  },
  {
    id: "gpt-4-turbo-preview",
    object: "model",
    capabilities: ["chat", "vision", "code"],
    context_window: 128000,
    pricing: { input: 10, output: 30 },
    is_active: true,
    updated_at: new Date().toISOString(),
    supports_functions: true,
  },
  {
    id: "gpt-4",
    object: "model",
    capabilities: ["chat", "code"],
    context_window: 8192,
    pricing: { input: 30, output: 60 },
    is_active: true,
    updated_at: new Date().toISOString(),
    deprecated_at: "2025-06-01",
  },
  {
    id: "gpt-4-32k",
    object: "model",
    capabilities: ["chat", "code"],
    context_window: 32768,
    pricing: { input: 60, output: 120 },
    is_active: false,
    updated_at: new Date().toISOString(),
    deprecated_at: "2025-06-01",
  },
  {
    id: "gpt-3.5-turbo",
    object: "model",
    display_name: "Fast Model",
    capabilities: ["chat", "code"],
    context_window: 16385,
    pricing: { input: 0.5, output: 1.5 },
    is_active: true,
    updated_at: new Date().toISOString(),
    supports_functions: true,
    supports_json_mode: true,
  },
  {
    id: "gpt-3.5-turbo-instruct",
    object: "model",
    capabilities: ["chat"],
    context_window: 4096,
    pricing: { input: 1.5, output: 2 },
    is_active: true,
    updated_at: new Date().toISOString(),
  },
  {
    id: "gpt-4o",
    object: "model",
    display_name: "Omni Model",
    capabilities: ["chat", "vision", "audio", "code", "reasoning"],
    context_window: 128000,
    pricing: { input: 5, output: 15 },
    is_active: true,
    updated_at: new Date().toISOString(),
    supports_functions: true,
    supports_json_mode: true,
  },
  {
    id: "gpt-4o-mini",
    object: "model",
    capabilities: ["chat", "vision", "code"],
    context_window: 128000,
    pricing: { input: 0.15, output: 0.6 },
    is_active: true,
    updated_at: new Date().toISOString(),
    supports_functions: true,
    supports_json_mode: true,
  },
  {
    id: "text-embedding-3-large",
    object: "model",
    capabilities: ["embedding"],
    context_window: 8191,
    pricing: { input: 0.13, output: 0 },
    is_active: true,
    updated_at: new Date().toISOString(),
  },
  {
    id: "text-embedding-3-small",
    object: "model",
    capabilities: ["embedding"],
    context_window: 8191,
    pricing: { input: 0.02, output: 0 },
    is_active: true,
    updated_at: new Date().toISOString(),
  },
  {
    id: "text-embedding-ada-002",
    object: "model",
    capabilities: ["embedding"],
    context_window: 8191,
    pricing: { input: 0.1, output: 0 },
    is_active: false,
    updated_at: new Date().toISOString(),
    deprecated_at: "2025-01-01",
  },
  {
    id: "whisper-1",
    object: "model",
    capabilities: ["audio"],
    context_window: 0,
    pricing: { input: 0.006, output: 0 },
    is_active: true,
    updated_at: new Date().toISOString(),
  },
  {
    id: "tts-1",
    object: "model",
    capabilities: ["audio"],
    context_window: 4096,
    pricing: { input: 15, output: 0 },
    is_active: true,
    updated_at: new Date().toISOString(),
  },
  {
    id: "tts-1-hd",
    object: "model",
    capabilities: ["audio"],
    context_window: 4096,
    pricing: { input: 30, output: 0 },
    is_active: true,
    updated_at: new Date().toISOString(),
  },
  {
    id: "dall-e-3",
    object: "model",
    capabilities: ["vision"],
    context_window: 0,
    pricing: { input: 40, output: 0 },
    is_active: true,
    updated_at: new Date().toISOString(),
  },
]

// Default filter state
const DEFAULT_FILTERS: ModelFilterState = {
  search: "",
  capabilities: [],
  min_context_window: null,
  active_only: false,
  price_tier: null,
}

interface ModelManagementPageProps {
  instanceId?: string
  className?: string
}

export function ModelManagementPage({
  instanceId,
  className,
}: ModelManagementPageProps) {
  const router = useRouter()

  // State
  const [instance] = React.useState<ProviderInstance>(MOCK_INSTANCE)
  const [models, setModels] = React.useState<ProviderModel[]>(MOCK_MODELS)
  const [filters, setFilters] = React.useState<ModelFilterState>(DEFAULT_FILTERS)
  const [syncState, setSyncState] = React.useState<SyncState>({
    is_syncing: false,
    progress: 0,
    last_sync: MOCK_INSTANCE.last_synced_at || null,
    error: null,
  })
  const [testModel, setTestModel] = React.useState<ProviderModel | null>(null)
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false)

  // Filter models based on current filter state
  const filteredModels = React.useMemo(() => {
    return models.filter((model) => {
      // Search filter
      if (filters.search) {
        const searchLower = filters.search.toLowerCase()
        const matchesId = model.id.toLowerCase().includes(searchLower)
        const matchesAlias = model.display_name?.toLowerCase().includes(searchLower)
        if (!matchesId && !matchesAlias) return false
      }

      // Capability filter
      if (filters.capabilities.length > 0) {
        const hasCapability = filters.capabilities.some((cap) =>
          model.capabilities.includes(cap)
        )
        if (!hasCapability) return false
      }

      // Context window filter
      if (filters.min_context_window !== null) {
        if (model.context_window < filters.min_context_window) return false
      }

      // Active only filter
      if (filters.active_only && !model.is_active) return false

      // Price tier filter
      if (filters.price_tier) {
        const modelTier = getPriceTier(model.pricing.input)
        if (modelTier !== filters.price_tier) return false
      }

      return true
    })
  }, [models, filters])

  // Handlers
  const handleSync = async () => {
    setSyncState((prev) => ({ ...prev, is_syncing: true, progress: 0, error: null }))

    // Simulate sync progress
    for (let i = 0; i <= 100; i += 10) {
      await new Promise((resolve) => setTimeout(resolve, 200))
      setSyncState((prev) => ({ ...prev, progress: i }))
    }

    setSyncState({
      is_syncing: false,
      progress: 100,
      last_sync: new Date().toISOString(),
      error: null,
    })
  }

  const handleToggleActive = (model: ProviderModel, active: boolean) => {
    setModels((prev) =>
      prev.map((m) =>
        m.id === model.id ? { ...m, is_active: active } : m
      )
    )
  }

  const handleUpdateAlias = (model: ProviderModel, alias: string) => {
    setModels((prev) =>
      prev.map((m) =>
        m.id === model.id ? { ...m, display_name: alias || undefined } : m
      )
    )
  }

  const handleTestMessage = async (message: string): Promise<TestMessage> => {
    // Simulate API call delay
    await new Promise((resolve) => setTimeout(resolve, 1000 + Math.random() * 1000))

    // Simulate response
    return {
      id: `msg_${Date.now()}`,
      role: "assistant",
      content: `This is a simulated response from ${testModel?.id}. In production, this would connect to the actual model via the gateway.\n\nYour message: "${message}"`,
      timestamp: new Date().toISOString(),
      latency: Math.floor(500 + Math.random() * 1000),
      tokens: Math.floor(50 + Math.random() * 100),
    }
  }

  const isEmpty = models.length === 0

  return (
    <div className={cn("min-h-screen", className)}>
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-10 py-6 lg:py-10 space-y-6">
        {/* Back Navigation */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
        >
          <GlassButton
            variant="ghost"
            size="sm"
            onClick={() => router.back()}
            className="gap-2 text-[var(--muted)] hover:text-[var(--foreground)]"
          >
            <ArrowLeft className="size-4" />
            Back to Providers
          </GlassButton>
        </motion.div>

        {/* Layer A: Instance Dashboard */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <InstanceDashboard
            instance={instance}
            syncState={syncState}
            onSync={handleSync}
            onSettings={() => setIsSettingsOpen(true)}
          />
        </motion.div>

        {/* Content Area */}
        {isEmpty ? (
          /* Empty State */
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
          >
            <ModelEmptyState
              onSync={handleSync}
              isSyncing={syncState.is_syncing}
              providerName={instance.provider_display_name}
            />
          </motion.div>
        ) : (
          <>
            {/* Layer B: Filter Lens */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <FilterLens
                filters={filters}
                onFiltersChange={setFilters}
                totalModels={models.length}
                filteredCount={filteredModels.length}
              />
            </motion.div>

            {/* Layer C: Model Matrix */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
            >
              <ModelMatrix
                models={filteredModels}
                onTest={setTestModel}
                onToggleActive={handleToggleActive}
                onUpdateAlias={handleUpdateAlias}
              />
            </motion.div>

            {/* No Results State */}
            {filteredModels.length === 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="py-16 text-center"
              >
                <p className="text-[var(--muted)]">
                  No models match your current filters.
                </p>
                <GlassButton
                  variant="ghost"
                  size="sm"
                  onClick={() => setFilters(DEFAULT_FILTERS)}
                  className="mt-4"
                >
                  Clear all filters
                </GlassButton>
              </motion.div>
            )}
          </>
        )}
      </div>

      {/* Test Drawer (Mini-Playground) */}
      <TestDrawer
        isOpen={!!testModel}
        onClose={() => setTestModel(null)}
        model={testModel}
        instanceName={instance.name}
        onSendMessage={handleTestMessage}
      />

      {/* Settings Sheet */}
      <Sheet open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
        <SheetContent className="backdrop-blur-xl bg-[var(--background)]/90 border-l border-white/10 sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Instance Settings</SheetTitle>
            <SheetDescription>
              Configure connection settings for {instance.name}
            </SheetDescription>
          </SheetHeader>

          <div className="py-6 space-y-6">
            <div className="space-y-2">
              <Label>Instance Name</Label>
              <Input
                defaultValue={instance.name}
                className="bg-white/5 border-white/10"
              />
            </div>

            <div className="space-y-2">
              <Label>Base URL</Label>
              <Input
                defaultValue={instance.base_url}
                className="bg-white/5 border-white/10 font-mono text-sm"
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label>Health Check</Label>
                <p className="text-xs text-[var(--muted)] mt-0.5">
                  Ping every {instance.health_check_interval || 30}s
                </p>
              </div>
              <Switch defaultChecked />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label>Auto Sync</Label>
                <p className="text-xs text-[var(--muted)] mt-0.5">
                  Sync models daily
                </p>
              </div>
              <Switch />
            </div>
          </div>

          <SheetFooter>
            <GlassButton className="w-full" onClick={() => setIsSettingsOpen(false)}>
              Save Changes
            </GlassButton>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}

export default ModelManagementPage
