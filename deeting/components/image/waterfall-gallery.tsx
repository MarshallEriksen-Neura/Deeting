"use client"

import * as React from "react"
import Image from "next/image"
import { Loader2 } from "lucide-react"
import { GlassCard } from "@/components/ui/glass-card"
import { CardSkeleton } from "@/components/ui/loading-skeletons"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useI18n } from "@/hooks/use-i18n"
import { usePublicImageShares } from "@/lib/swr/use-image-shares"
import type { ImageShareItem } from "@/lib/api/image-generation"
import { ImageDetailDialog, type SharedImage } from "./image-detail-dialog"

interface WaterfallGalleryProps {
  className?: string
  searchQuery?: string
}

const FALLBACK_SIZE = 512

function resolveSharePreview(item: ImageShareItem) {
  return item.preview?.asset_url ?? item.preview?.source_url ?? null
}

function mapShareItem(item: ImageShareItem): SharedImage | null {
  const previewUrl = resolveSharePreview(item)
  if (!previewUrl) return null
  const width = item.preview?.width ?? item.width ?? FALLBACK_SIZE
  const height = item.preview?.height ?? item.height ?? FALLBACK_SIZE
  return {
    id: item.share_id,
    url: previewUrl,
    width,
    height,
    model: item.model,
    prompt: item.prompt ?? null,
    promptEncrypted: item.prompt_encrypted ?? false,
    numOutputs: item.num_outputs,
    steps: item.steps ?? null,
    cfgScale: item.cfg_scale ?? null,
    seed: item.seed ?? null,
    sharedAt: item.shared_at ?? null,
    tags: item.tags ?? [],
  }
}

export function WaterfallGallery({ className, searchQuery = "" }: WaterfallGalleryProps) {
  const t = useI18n("common")
  const {
    items,
    isLoading,
    isLoadingMore,
    hasMore,
    loadMore,
    reset,
    error,
  } = usePublicImageShares({ size: 20 })
  const [selectedImage, setSelectedImage] = React.useState<SharedImage | null>(null)
  const [isDialogOpen, setIsDialogOpen] = React.useState(false)

  const images = React.useMemo(() => {
    return items
      .map((item) => mapShareItem(item))
      .filter((item): item is SharedImage => Boolean(item))
  }, [items])

  const filteredImages = React.useMemo(() => {
    if (!searchQuery.trim()) return images
    const query = searchQuery.trim().toLowerCase()
    return images.filter((img) => {
      const prompt = img.prompt?.toLowerCase() ?? ""
      const model = img.model.toLowerCase()
      const tags = img.tags?.join(" ").toLowerCase() ?? ""
      return prompt.includes(query) || model.includes(query) || tags.includes(query)
    })
  }, [images, searchQuery])

  const handleImageClick = (image: SharedImage) => {
    setSelectedImage(image)
    setIsDialogOpen(true)
  }

  const isInitialLoading = isLoading && images.length === 0

  return (
    <div className="space-y-6">
      {isInitialLoading ? (
        <div className={cn("columns-2 md:columns-3 lg:columns-4 gap-4 space-y-4", className)}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="break-inside-avoid">
              <CardSkeleton />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-full bg-muted/30 flex items-center justify-center mb-4">
            <Loader2 className="h-8 w-8 text-muted-foreground/50" />
          </div>
          <h3 className="text-lg font-medium text-foreground">{t("gallery.loadFailed")}</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-xs">
            {t("gallery.loadFailedDesc")}
          </p>
          <Button className="mt-4" onClick={reset}>
            {t("gallery.retry")}
          </Button>
        </div>
      ) : filteredImages.length > 0 ? (
        <div className={cn("columns-2 md:columns-3 lg:columns-4 gap-4 space-y-4", className)}>
          {filteredImages.map((image) => (
            <div key={image.id} className="break-inside-avoid">
              <GlassCard
                hover="lift"
                padding="none"
                className="group mb-4 cursor-pointer"
                onClick={() => handleImageClick(image)}
              >
                <div className="relative w-full overflow-hidden rounded-t-2xl">
                  <div
                    className="relative w-full bg-muted/20"
                    style={{ aspectRatio: `${image.width} / ${image.height}` }}
                  >
                    <Image
                      src={image.url}
                      alt={image.model}
                      fill
                      sizes="(max-width: 768px) 50vw, (max-width: 1200px) 33vw, 25vw"
                      className="object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                  </div>

                  <div className="absolute bottom-0 left-0 right-0 p-4 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                    <div className="flex flex-wrap gap-2">
                      {image.tags?.slice(0, 3).map((tag) => (
                        <Badge key={tag} variant="secondary" className="bg-black/40 text-white border-white/20">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                    <div className="mt-2 text-xs text-white/80 truncate">{image.model}</div>
                  </div>
                </div>

                <div className="p-3 space-y-2">
                  <div className="text-xs font-medium text-muted-foreground truncate">{image.model}</div>
                  {image.tags && image.tags.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {image.tags.slice(0, 4).map((tag) => (
                        <Badge key={tag} variant="secondary" className="gap-1">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {t("gallery.noTags")}
                    </span>
                  )}
                </div>
              </GlassCard>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-full bg-muted/30 flex items-center justify-center mb-4">
            <Loader2 className="h-8 w-8 text-muted-foreground/50" />
          </div>
          <h3 className="text-lg font-medium text-foreground">
            {searchQuery.trim() ? t("gallery.noResultsTitle") : t("gallery.emptyTitle")}
          </h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-xs">
            {searchQuery.trim() ? t("gallery.noResultsDescription") : t("gallery.emptyDescription")}
          </p>
        </div>
      )}

      {hasMore ? (
        <div className="flex justify-center pt-2">
          <Button onClick={loadMore} disabled={isLoadingMore} className="min-w-[160px]">
            {isLoadingMore ? t("gallery.loading") : t("gallery.loadMore")}
          </Button>
        </div>
      ) : null}

      <ImageDetailDialog
        image={selectedImage}
        open={isDialogOpen}
        onOpenChange={(nextOpen) => {
          setIsDialogOpen(nextOpen)
          if (!nextOpen) {
            setSelectedImage(null)
          }
        }}
      />
    </div>
  )
}
