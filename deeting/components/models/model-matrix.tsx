"use client"

import * as React from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Play,
  Pencil,
  Check,
  X,
  AlertTriangle,
  ChevronRight,
  MoreHorizontal,
  Copy,
  Trash2,
  Eye,
  EyeOff,
} from "lucide-react"
import { useTranslations } from "next-intl"

import { cn } from "@/lib/utils"
import { GlassCard } from "@/components/ui/glass-card"
import { GlassButton } from "@/components/ui/glass-button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { ProviderModel, ModelCapability } from "./types"
import {
  CAPABILITY_META,
  formatContextWindow,
  formatPrice,
  getPriceColor,
  getPriceTier,
} from "./types"

/**
 * ModelDataStrip - Layer C: The Data Strip
 *
 * A single row representing a model, designed like sci-fi spacecraft components.
 * Shows ID, alias, capabilities, context window, pricing, and actions.
 */

interface ModelDataStripProps {
  model: ProviderModel
  index: number
  onTest: (model: ProviderModel) => void
  onToggleActive: (model: ProviderModel, active: boolean) => void
  onUpdateAlias: (model: ProviderModel, alias: string) => void
  onDelete?: (model: ProviderModel) => void
}

// Capability icons component
function CapabilityIcons({ capabilities }: { capabilities: ModelCapability[] }) {
  const t = useTranslations('models')
  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex items-center gap-1">
        {capabilities.slice(0, 4).map((cap) => {
          const meta = CAPABILITY_META[cap]
          return (
            <Tooltip key={cap}>
              <TooltipTrigger asChild>
                <span
                  className="flex items-center justify-center size-6 rounded-md bg-white/5 text-sm cursor-default hover:bg-white/10 transition-colors"
                >
                  {meta.icon}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                {t(`capabilities.${cap}.label`)}: {t(`capabilities.${cap}.description`)}
              </TooltipContent>
            </Tooltip>
          )
        })}
        {capabilities.length > 4 && (
          <span className="text-xs text-[var(--muted)] ml-1">
            +{capabilities.length - 4}
          </span>
        )}
      </div>
    </TooltipProvider>
  )
}

// Context window visualizer
function ContextWindowBar({ tokens, maxTokens = 200000 }: { tokens: number; maxTokens?: number }) {
  const t = useTranslations('models')
  const percentage = Math.min((tokens / maxTokens) * 100, 100)

  // Color based on context size
  const getBarColor = (pct: number) => {
    if (pct >= 60) return "bg-emerald-500"
    if (pct >= 30) return "bg-yellow-500"
    return "bg-[var(--primary)]"
  }

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-2 min-w-[100px]">
            <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
              <motion.div
                className={cn("h-full rounded-full", getBarColor(percentage))}
                initial={{ width: 0 }}
                animate={{ width: `${percentage}%` }}
                transition={{ duration: 0.5, ease: "easeOut" }}
              />
            </div>
            <span className="text-xs font-mono text-[var(--muted)] min-w-[40px]">
              {formatContextWindow(tokens)}
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {t('list.tooltips.contextWindow', { tokens: tokens.toLocaleString() })}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

// Price display with color coding
function PriceDisplay({ input, output }: { input: number; output: number }) {
  const t = useTranslations('models')
  const inputColor = getPriceColor(input)
  const outputColor = getPriceColor(output)

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1 font-mono text-xs">
            <span className={inputColor}>{formatPrice(input)}</span>
            <span className="text-[var(--muted)]">/</span>
            <span className={outputColor}>{formatPrice(output)}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          <div className="space-y-1">
            <div>{t('list.tooltips.inputPrice', { price: formatPrice(input) })}</div>
            <div>{t('list.tooltips.outputPrice', { price: formatPrice(output) })}</div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

// Editable alias component
function EditableAlias({
  alias,
  modelId,
  onSave,
}: {
  alias?: string
  modelId: string
  onSave: (alias: string) => void
}) {
  const t = useTranslations('models')
  const [isEditing, setIsEditing] = React.useState(false)
  const [value, setValue] = React.useState(alias || "")
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleSave = () => {
    onSave(value)
    setIsEditing(false)
  }

  const handleCancel = () => {
    setValue(alias || "")
    setIsEditing(false)
  }

  if (isEditing) {
    return (
      <div className="flex items-center gap-1">
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave()
            if (e.key === "Escape") handleCancel()
          }}
          className="h-6 w-32 text-xs bg-white/5 border-white/20 px-2"
          placeholder={t('list.actions.setAlias')}
        />
        <button
          onClick={handleSave}
          className="p-1 text-emerald-500 hover:bg-emerald-500/10 rounded"
        >
          <Check className="size-3" />
        </button>
        <button
          onClick={handleCancel}
          className="p-1 text-[var(--muted)] hover:bg-white/5 rounded"
        >
          <X className="size-3" />
        </button>
      </div>
    )
  }

  return (
    <div className="group/alias flex items-center gap-1">
      {alias ? (
        <span className="text-xs text-[var(--muted)]">{alias}</span>
      ) : (
        <span className="text-xs text-[var(--muted)] italic opacity-50">
          {t('list.actions.noAlias')}
        </span>
      )}
      <button
        onClick={() => setIsEditing(true)}
        className="p-0.5 opacity-0 group-hover/alias:opacity-100 text-[var(--muted)] hover:text-[var(--foreground)] transition-opacity"
      >
        <Pencil className="size-3" />
      </button>
    </div>
  )
}

export function ModelDataStrip({
  model,
  index,
  onTest,
  onToggleActive,
  onUpdateAlias,
  onDelete,
}: ModelDataStripProps) {
  const t = useTranslations('models')
  const isDeprecated = !!model.deprecated_at

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03, duration: 0.3 }}
      exit={{ opacity: 0, x: -20 }}
    >
      <GlassCard
        className={cn(
          "group relative transition-all duration-200",
          !model.is_active && "opacity-60",
          isDeprecated && "border-yellow-500/30"
        )}
        padding="none"
        hover="none"
        blur="sm"
      >
        {/* Active hover border effect */}
        <div className="absolute inset-0 border-2 border-transparent transition-colors duration-200 group-hover:border-[var(--primary)]/20 rounded-2xl pointer-events-none" />

        {/* Deprecated warning stripe */}
        {isDeprecated && (
          <div className="absolute top-0 right-0 px-2 py-0.5 bg-yellow-500/20 text-yellow-500 text-[10px] font-medium rounded-bl-lg rounded-tr-2xl flex items-center gap-1">
            <AlertTriangle className="size-3" />
            {t('list.actions.deprecated')}
          </div>
        )}

        <div className="flex items-center gap-4 p-4">
          {/* 1. Identity: ID & Alias */}
          <div className="flex flex-col gap-0.5 min-w-[180px] max-w-[250px]">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-medium text-[var(--foreground)] truncate">
                {model.id}
              </span>
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => navigator.clipboard.writeText(model.id)}
                      className="p-0.5 opacity-0 group-hover:opacity-100 text-[var(--muted)] hover:text-[var(--foreground)] transition-opacity"
                    >
                      <Copy className="size-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    {t('list.actions.copyId')}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <EditableAlias
              alias={model.display_name}
              modelId={model.id}
              onSave={(alias) => onUpdateAlias(model, alias)}
            />
          </div>

          {/* 2. Capabilities */}
          <div className="hidden md:block min-w-[120px]">
            <CapabilityIcons capabilities={model.capabilities} />
          </div>

          {/* 3. Context Window */}
          <div className="hidden lg:block min-w-[140px]">
            <ContextWindowBar tokens={model.context_window} />
          </div>

          {/* 4. Pricing */}
          <div className="hidden md:block min-w-[100px]">
            <PriceDisplay
              input={model.pricing.input}
              output={model.pricing.output}
            />
          </div>

          {/* 5. Status Toggle */}
          <div className="ml-auto flex items-center gap-3">
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center">
                    <Switch
                      checked={model.is_active}
                      onCheckedChange={(checked) => onToggleActive(model, checked)}
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  {model.is_active ? t('list.actions.disable') : t('list.actions.enable')}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* 6. Test Action */}
            <GlassButton
              variant="ghost"
              size="sm"
              onClick={() => onTest(model)}
              className="gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Play className="size-3.5" />
              <span>{t('list.actions.test')}</span>
            </GlassButton>

            {/* More Actions */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <GlassButton
                  variant="ghost"
                  size="icon-sm"
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <MoreHorizontal className="size-4" />
                </GlassButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-48 backdrop-blur-xl bg-[var(--background)]/90"
              >
                <DropdownMenuItem onClick={() => navigator.clipboard.writeText(model.id)}>
                  <Copy className="mr-2 size-4" />
                  {t('list.actions.copyId')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onTest(model)}>
                  <Play className="mr-2 size-4" />
                  {t('list.actions.quickTest')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onToggleActive(model, !model.is_active)}>
                  {model.is_active ? (
                    <>
                      <EyeOff className="mr-2 size-4" />
                      {t('list.actions.disable')}
                    </>
                  ) : (
                    <>
                      <Eye className="mr-2 size-4" />
                      {t('list.actions.enable')}
                    </>
                  )}
                </DropdownMenuItem>
                {onDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => onDelete(model)}
                      className="text-red-500 focus:text-red-500"
                    >
                      <Trash2 className="mr-2 size-4" />
                      {t('list.actions.remove')}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Mobile: Additional info row */}
        <div className="md:hidden border-t border-white/5 px-4 py-2 flex items-center justify-between">
          <CapabilityIcons capabilities={model.capabilities} />
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-[var(--muted)]">
              {formatContextWindow(model.context_window)}
            </span>
            <PriceDisplay
              input={model.pricing.input}
              output={model.pricing.output}
            />
          </div>
        </div>
      </GlassCard>
    </motion.div>
  )
}

/**
 * ModelMatrix - The container for all model data strips
 */
interface ModelMatrixProps {
  models: ProviderModel[]
  onTest: (model: ProviderModel) => void
  onToggleActive: (model: ProviderModel, active: boolean) => void
  onUpdateAlias: (model: ProviderModel, alias: string) => void
  onDelete?: (model: ProviderModel) => void
  className?: string
}

export function ModelMatrix({
  models,
  onTest,
  onToggleActive,
  onUpdateAlias,
  onDelete,
  className,
}: ModelMatrixProps) {
  const t = useTranslations('models')
  return (
    <div className={cn("space-y-2", className)}>
      {/* Header Row */}
      <div className="hidden lg:flex items-center gap-4 px-4 py-2 text-xs font-medium text-[var(--muted)] uppercase tracking-wide">
        <div className="min-w-[180px] max-w-[250px]">{t('list.header.id')}</div>
        <div className="min-w-[120px]">{t('list.header.capabilities')}</div>
        <div className="min-w-[140px]">{t('list.header.context')}</div>
        <div className="min-w-[100px]">{t('list.header.pricing')}</div>
        <div className="ml-auto">{t('list.header.status')}</div>
      </div>

      {/* Model List */}
      <AnimatePresence mode="popLayout">
        {models.map((model, index) => (
          <ModelDataStrip
            key={model.id}
            model={model}
            index={index}
            onTest={onTest}
            onToggleActive={onToggleActive}
            onUpdateAlias={onUpdateAlias}
            onDelete={onDelete}
          />
        ))}
      </AnimatePresence>
    </div>
  )
}

export default ModelMatrix
