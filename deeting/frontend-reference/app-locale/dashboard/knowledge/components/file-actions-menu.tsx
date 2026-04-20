"use client"

import React from "react"
import { useTranslations } from "next-intl"
import {
  MoreHorizontal,
  Eye,
  Download,
  Pencil,
  FolderInput,
  Copy,
  Share2,
  Trash2,
  RotateCcw,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/shadcn/dropdown-menu"
import { GlassButton } from "@/ui/common/glass-button"
import type { FileStatus } from "@/types/knowledge"

interface FileActionsMenuProps {
  type: "file" | "folder"
  status?: FileStatus
  onPreview?: () => void
  onDownload?: () => void
  onRename?: () => void
  onMove?: () => void
  onCopy?: () => void
  onShare?: () => void
  onDelete?: () => void
  onRetry?: () => void
}

const FileActionsMenu = React.memo(
  ({
    type,
    status,
    onPreview,
    onDownload,
    onRename,
    onMove,
    onCopy,
    onShare,
    onDelete,
    onRetry,
  }: FileActionsMenuProps) => {
    const t = useTranslations("knowledge")
    const isFailed = status === "failed"
    const isProcessing = status === "processing"

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <GlassButton variant="ghost" size="icon-sm">
            <MoreHorizontal className="h-4 w-4" />
          </GlassButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {type === "file" && (
            <>
              {isFailed ? (
                <DropdownMenuItem onClick={onRetry}>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  {t("actions.retry")}
                </DropdownMenuItem>
              ) : (
                <>
                  <DropdownMenuItem onClick={onPreview} disabled={isProcessing}>
                    <Eye className="mr-2 h-4 w-4" />
                    {t("actions.preview")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onDownload} disabled={isProcessing}>
                    <Download className="mr-2 h-4 w-4" />
                    {t("actions.download")}
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
            </>
          )}

          <DropdownMenuItem onClick={onRename}>
            <Pencil className="mr-2 h-4 w-4" />
            {t("actions.rename")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onMove}>
            <FolderInput className="mr-2 h-4 w-4" />
            {t("actions.move")}
          </DropdownMenuItem>

          {type === "file" && (
            <>
              <DropdownMenuItem onClick={onCopy}>
                <Copy className="mr-2 h-4 w-4" />
                {t("actions.copy")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onShare}>
                <Share2 className="mr-2 h-4 w-4" />
                {t("actions.share")}
              </DropdownMenuItem>
            </>
          )}

          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onDelete} className="text-red-500 focus:text-red-500">
            <Trash2 className="mr-2 h-4 w-4" />
            {t("actions.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }
)

FileActionsMenu.displayName = "FileActionsMenu"

export { FileActionsMenu }
