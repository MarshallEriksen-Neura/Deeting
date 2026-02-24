"use client"

import * as React from "react"
import { Shield, GitBranch, Code, Database, Globe } from "lucide-react"
import { useTranslations } from "next-intl"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { PluginMarketSkillItem } from "@/lib/api/plugin-market"

interface PermissionConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  plugin: PluginMarketSkillItem | null
  onConfirm: (skillId: string, alias?: string) => void
  isInstalling?: boolean
}

export function PermissionConfirmDialog({
  open,
  onOpenChange,
  plugin,
  onConfirm,
  isInstalling = false,
}: PermissionConfirmDialogProps) {
  const t = useTranslations("plugins")
  const [alias, setAlias] = React.useState("")

  React.useEffect(() => {
    if (open) setAlias("")
  }, [open])

  if (!plugin) return null

  const permissions = [
    { key: "tool_execution", icon: Code, label: t("permissions.toolExecution") },
    { key: "data_access", icon: Database, label: t("permissions.dataAccess") },
    { key: "network", icon: Globe, label: t("permissions.network") },
  ]

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-amber-500" />
            {t("dialog.title")}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-4 text-sm text-muted-foreground">
              <p>{t("dialog.description", { name: plugin.name })}</p>

              {/* Plugin info */}
              <div className="rounded-lg border bg-muted/50 p-3 space-y-2">
                <div className="font-medium text-foreground">{plugin.name}</div>
                {plugin.description && (
                  <p className="text-xs">{plugin.description}</p>
                )}
                {plugin.source_repo && (
                  <div className="flex items-center gap-1 text-xs">
                    <GitBranch size={12} />
                    <span className="truncate">
                      {plugin.source_repo.replace(/^https?:\/\/github\.com\//, "")}
                    </span>
                  </div>
                )}
              </div>

              {/* Permissions list */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-foreground">
                  {t("dialog.permissionsLabel")}
                </p>
                <ul className="space-y-1.5">
                  {permissions.map(({ key, icon: Icon, label }) => (
                    <li key={key} className="flex items-center gap-2 text-xs">
                      <div className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-500/10">
                        <Icon className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                      </div>
                      <span>{label}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Alias input */}
              <div className="space-y-1.5">
                <Label htmlFor="plugin-alias" className="text-xs">
                  {t("dialog.aliasLabel")}
                </Label>
                <Input
                  id="plugin-alias"
                  value={alias}
                  onChange={(e) => setAlias(e.target.value)}
                  placeholder={t("dialog.aliasPlaceholder")}
                  className="h-8 text-sm"
                />
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isInstalling}>
            {t("dialog.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={isInstalling}
            onClick={(e) => {
              e.preventDefault()
              onConfirm(plugin.id, alias || undefined)
            }}
          >
            {isInstalling ? t("dialog.installing") : t("dialog.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
