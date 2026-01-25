"use client"

import * as React from "react"
import Image from "next/image"
import { Copy, Download, X } from "lucide-react"
import { Dialog, DialogContent, DialogTitle, VisuallyHidden } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { ImageLightbox } from "@/components/ui/image-lightbox"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { useI18n } from "@/hooks/use-i18n"
import { usePublicImageShareDetail } from "@/lib/swr/use-image-shares"

export interface SharedImage {
  id: string
  url: string
  width: number
  height: number
  model: string
  prompt?: string | null
  promptEncrypted?: boolean
  numOutputs: number
  steps?: number | null
  cfgScale?: number | null
  seed?: number | null
  sharedAt?: string | null
  tags?: string[]
}

interface ImageDetailDialogProps {
  image: SharedImage | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ImageDetailDialog({ image, open, onOpenChange }: ImageDetailDialogProps) {
  const t = useI18n("common")
  const { data: detail } = usePublicImageShareDetail(image?.id ?? null, {
    enabled: open && Boolean(image?.id),
  })

  const detailOutput = detail?.outputs?.[0]
  const detailUrl = detailOutput?.asset_url ?? detailOutput?.source_url ?? null
  const display = React.useMemo(() => {
    if (!image) return null
    const width = detailOutput?.width ?? detail?.width ?? image.width
    const height = detailOutput?.height ?? detail?.height ?? image.height
    return {
      id: image.id,
      url: detailUrl ?? image.url,
      width,
      height,
      model: detail?.model ?? image.model,
      prompt: detail?.prompt ?? image.prompt ?? null,
      promptEncrypted: detail?.prompt_encrypted ?? image.promptEncrypted ?? false,
      numOutputs: detail?.num_outputs ?? image.numOutputs,
      steps: detail?.steps ?? image.steps ?? null,
      cfgScale: detail?.cfg_scale ?? image.cfgScale ?? null,
      seed: detail?.seed ?? image.seed ?? null,
      sharedAt: detail?.shared_at ?? image.sharedAt ?? null,
      tags: detail?.tags ?? image.tags ?? [],
    }
  }, [detail, detailOutput, detailUrl, image])

  if (!display) return null

  const canCopyPrompt = Boolean(display.prompt) && !display.promptEncrypted
  const formattedSharedAt = display.sharedAt
    ? new Date(display.sharedAt).toLocaleString()
    : "-"

  const handleCopyPrompt = async () => {
    if (!canCopyPrompt || !display.prompt) return
    try {
      await navigator.clipboard.writeText(display.prompt)
      toast.success(t("gallery.detail.promptCopied"))
    } catch {
      toast.error(t("gallery.detail.promptCopyFailed"))
    }
  }

  const handleDownload = async () => {
    try {
      const response = await fetch(display.url)
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `deeting-share-${display.id}.jpg`
      document.body.appendChild(link)
      link.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(link)
      toast.success(t("gallery.detail.downloaded"))
    } catch {
      toast.error(t("gallery.detail.downloadFailed"))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[95vw] h-[90vh] p-0 gap-0 overflow-hidden border-none bg-background/80 backdrop-blur-xl md:h-[80vh] md:rounded-2xl">
        <VisuallyHidden>
          <DialogTitle>{t("gallery.detail.title")}</DialogTitle>
        </VisuallyHidden>
        <div className="flex flex-col h-full md:flex-row">
          <div className="relative flex-1 bg-black/5 dark:bg-black/40 flex items-center justify-center p-4 md:p-8 min-h-[40vh]">
            <div className="relative w-full h-full max-h-full flex items-center justify-center">
              <ImageLightbox src={display.url} alt={display.model}>
                <div className="relative w-full h-full max-h-[calc(80vh-4rem)] md:max-h-[calc(80vh-4rem)] flex items-center justify-center">
                  <Image
                    src={display.url}
                    alt={display.model}
                    width={display.width}
                    height={display.height}
                    className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
                    unoptimized
                  />
                </div>
              </ImageLightbox>
            </div>

            <div className="absolute bottom-6 right-6 flex gap-2">
              <Button
                size="icon"
                variant="secondary"
                className="rounded-full bg-white/10 hover:bg-white/20 text-white border-none backdrop-blur-md shadow-lg"
                onClick={handleDownload}
                aria-label={t("gallery.detail.download")}
              >
                <Download className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="w-full md:w-[400px] flex flex-col h-full border-l border-white/10 bg-background/60 backdrop-blur-xl">
            <div className="flex items-center justify-between p-6 border-b border-white/5">
              <div>
                <h3 className="text-sm font-semibold">{display.model}</h3>
                <p className="text-xs text-muted-foreground">{formattedSharedAt}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onOpenChange(false)}
                aria-label={t("gallery.detail.close")}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <ScrollArea className="flex-1 p-6">
              <div className="space-y-6">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium text-muted-foreground">
                      {t("gallery.detail.promptLabel")}
                    </h4>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={handleCopyPrompt}
                      className="h-6 w-6"
                      disabled={!canCopyPrompt}
                      aria-label={t("gallery.detail.copyPrompt")}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                  <div className="p-4 rounded-xl bg-muted/50 text-sm leading-relaxed border border-white/5 font-mono text-xs text-muted-foreground">
                    {display.promptEncrypted
                      ? t("gallery.detail.promptEncrypted")
                      : display.prompt || t("gallery.detail.promptEmpty")}
                  </div>
                </div>

                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-muted-foreground">
                    {t("gallery.detail.parameters")}
                  </h4>
                  <div className="grid grid-cols-2 gap-3">
                    <ParameterItem label={t("gallery.detail.model")} value={display.model} />
                    <ParameterItem
                      label={t("gallery.detail.dimensions")}
                      value={`${display.width} x ${display.height}`}
                    />
                    <ParameterItem
                      label={t("gallery.detail.seed")}
                      value={display.seed?.toString() ?? "-"}
                    />
                    <ParameterItem
                      label={t("gallery.detail.steps")}
                      value={display.steps?.toString() ?? "-"}
                    />
                    <ParameterItem
                      label={t("gallery.detail.cfgScale")}
                      value={display.cfgScale?.toString() ?? "-"}
                    />
                    <ParameterItem
                      label={t("gallery.detail.numOutputs")}
                      value={display.numOutputs?.toString() ?? "-"}
                    />
                    <ParameterItem
                      label={t("gallery.detail.sharedAt")}
                      value={formattedSharedAt}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground">
                    {t("gallery.detail.tagsLabel")}
                  </h4>
                  {display.tags && display.tags.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {display.tags.map((tag) => (
                        <Badge key={tag} variant="secondary" className="gap-1">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {t("gallery.detail.tagsEmpty")}
                    </p>
                  )}
                </div>
              </div>
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ParameterItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded-lg bg-muted/30 border border-white/5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
        {label}
      </div>
      <div className={cn("text-xs font-medium truncate")} title={value}>
        {value}
      </div>
    </div>
  )
}
