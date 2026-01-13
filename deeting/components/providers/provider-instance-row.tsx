"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { useTranslations } from "next-intl"
import { Activity, MoreHorizontal, Settings2, Trash2, Cloud, Cpu, Server } from "lucide-react"
import { Line, LineChart, ResponsiveContainer } from "recharts"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

import { GlassCard } from "@/components/ui/glass-card"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { GlassButton } from "@/components/ui/glass-button"

type InstanceRowData = {
  id: string
  name: string
  presetName: string
  presetSlug: string
  category?: string
  icon?: string | null
  latency_ms?: number
  health_status?: string
  is_enabled?: boolean
  models_count?: number
  sparkline?: number[]
}

interface Props {
  data: InstanceRowData
  index: number
  onToggle: (id: string, enabled: boolean) => Promise<void> | void
  onDelete: (id: string) => Promise<void> | void
  onViewModels?: (id: string) => void
  onEdit?: (id: string) => void
}

export default function ProviderInstanceRow({ data, index, onToggle, onDelete, onViewModels, onEdit }: Props) {
  const t = useTranslations("providers.list")
  const [history, setHistory] = React.useState<number[]>(data.sparkline || [])
  const [confirmOpen, setConfirmOpen] = React.useState(false)

  React.useEffect(() => {
    if (typeof data.latency_ms === "number") {
      setHistory((prev) => {
        const next = [...prev, data.latency_ms ?? 0].slice(-20)
        return next
      })
    }
  }, [data.latency_ms])

  const isEnabled = data.is_enabled !== false
  const isOffline = (data.health_status || "").toLowerCase() === "down" || !isEnabled

  const latencyColor = React.useMemo(() => {
    if (isOffline) return "#ef4444"
    const lat = data.latency_ms ?? 0
    if (lat < 200) return "#10b981"
    if (lat < 1000) return "#f59e0b"
    return "#ef4444"
  }, [data.latency_ms, isOffline])

  const category = (data.category || "").toLowerCase()
  const iconElement = category.includes("local") ? (
    <Server className="size-5" />
  ) : category.includes("custom") ? (
    <Cpu className="size-5" />
  ) : (
    <Cloud className="size-5" />
  )

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.35 }}
    >
      <GlassCard
        className={`group relative overflow-hidden transition-all duration-300 hover:shadow-lg ${isOffline ? "opacity-75 grayscale-[0.3]" : ""}`}
        padding="none"
        innerBorder={false}
      >
        <div className="absolute inset-0 border-2 border-transparent transition-colors duration-300 group-hover:border-[var(--primary)]/20 rounded-2xl pointer-events-none" />

        <div className="flex flex-col md:flex-row items-center p-4 gap-6">
          {/* Identity */}
          <div className="flex items-center gap-4 min-w-[240px]">
            <div className={`relative flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-white/10 to-white/5 border border-white/10 shadow-inner ${isOffline ? "text-gray-400" : "text-[var(--foreground)]"}`}>
              {iconElement}
              {!isOffline && (
                <span className="absolute -top-1 -right-1 flex size-3">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75`} style={{ backgroundColor: latencyColor }}></span>
                  <span className="relative inline-flex rounded-full size-3" style={{ backgroundColor: latencyColor }}></span>
                </span>
              )}
            </div>
            <div>
              <h3 className="font-semibold text-[var(--foreground)] flex items-center gap-2">
                {data.name}
                {data.category?.toLowerCase().includes("local") && (
                  <Badge variant="outline" className="text-[10px] h-5 px-1.5 border-[var(--primary)]/30 text-[var(--primary)]">
                    LOCAL
                  </Badge>
                )}
              </h3>
              <p className="text-sm text-[var(--muted)]">{data.presetName}</p>
            </div>
          </div>

          {/* Sparkline */}
          <div className="flex-1 h-[40px] w-full min-w-[120px] opacity-60 group-hover:opacity-100 transition-opacity">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history.map((val, i) => ({ i, val }))}>
                <Line
                  type="monotone"
                  dataKey="val"
                  stroke={latencyColor}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={true}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Metrics & Actions */}
          <div className="flex items-center gap-6 md:ml-auto">
            <div className="flex flex-col items-end min-w-[90px]">
              <div className="flex items-center gap-1.5 text-sm font-medium" style={{ color: latencyColor }}>
                <Activity className="size-3.5" />
                {isOffline ? t("offline") : `${data.latency_ms ?? 0}ms`}
              </div>
              <span className="text-xs text-[var(--muted)]">{t("latency")}</span>
            </div>

              <div className="flex items-center gap-4">
              <Switch
                checked={isEnabled}
                onCheckedChange={(v) => onToggle(data.id, v)}
              />

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <GlassButton variant="ghost" size="icon-sm" className="opacity-0 group-hover:opacity-100 transition-opacity">
                    <MoreHorizontal className="size-4" />
                  </GlassButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[160px]">
                  <DropdownMenuItem onClick={() => onToggle(data.id, !isEnabled)}>
                    <Settings2 className="mr-2 size-4" />
                    {isEnabled ? t("actions.disable") : t("actions.enable")}
                  </DropdownMenuItem>
                  {onViewModels && (
                    <DropdownMenuItem onClick={() => onViewModels(data.id)}>
                      <Server className="mr-2 size-4" />
                      {t("actions.models")}
                    </DropdownMenuItem>
                  )}
                  {onEdit && (
                    <DropdownMenuItem onClick={() => onEdit(data.id)}>
                      <Settings2 className="mr-2 size-4" />
                      {t("actions.edit")}
                    </DropdownMenuItem>
                  )}
                  <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                    <AlertDialogTrigger asChild>
                      <DropdownMenuItem
                        className="text-red-600 focus:text-red-600"
                        onSelect={(e) => {
                          e.preventDefault()
                          setConfirmOpen(true)
                        }}
                      >
                        <Trash2 className="mr-2 size-4" />
                        {t("actions.remove")}
                      </DropdownMenuItem>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t("confirmTitle")}</AlertDialogTitle>
                        <AlertDialogDescription>
                          {t("confirmRemove")}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t("actions.cancel")}</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-red-600 hover:bg-red-500 text-white"
                          onClick={() => {
                            onDelete(data.id)
                            setConfirmOpen(false)
                          }}
                        >
                          {t("actions.remove")}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </GlassCard>
    </motion.div>
  )
}
