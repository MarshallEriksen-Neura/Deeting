"use client"

import * as React from "react"
import { Share2, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useI18n } from "@/hooks/use-i18n"
import { useImageShareActions } from "@/lib/swr/use-image-shares"

interface ImageShareActionProps {
  taskId: string
  disabled?: boolean
}

export function ImageShareAction({ taskId, disabled = false }: ImageShareActionProps) {
  const t = useI18n("chat")
  const { share, unshare } = useImageShareActions()
  const [open, setOpen] = React.useState(false)
  const [confirmed, setConfirmed] = React.useState(false)
  const [tags, setTags] = React.useState<string[]>([])
  const [inputValue, setInputValue] = React.useState("")
  const [shareActive, setShareActive] = React.useState(false)

  const isSubmitting = share.isMutating || unshare.isMutating

  const addTag = React.useCallback(() => {
    const raw = inputValue.trim()
    if (!raw) return
    const normalized = raw.startsWith("#") ? raw : `#${raw}`
    const lower = normalized.toLowerCase()
    if (tags.some((tag) => tag.toLowerCase() === lower)) {
      setInputValue("")
      return
    }
    setTags((prev) => [...prev, normalized])
    setInputValue("")
  }, [inputValue, tags])

  const handleSubmit = async () => {
    if (!confirmed || disabled) return
    try {
      const result = await share.trigger({
        taskId,
        payload: { tags },
      })
      setShareActive(result?.is_active ?? true)
      setTags(result?.tags ?? tags)
      toast.success(t("imageShare.toast.shared"))
      setOpen(false)
    } catch {
      toast.error(t("imageShare.toast.shareFailed"))
    }
  }

  const handleUnshare = async () => {
    try {
      const result = await unshare.trigger({ taskId })
      setShareActive(result?.is_active ?? false)
      setTags(result?.tags ?? tags)
      toast.success(t("imageShare.toast.unshared"))
      setOpen(false)
    } catch {
      toast.error(t("imageShare.toast.unshareFailed"))
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-label={t("imageShare.action")}
      >
        <Share2
          className={shareActive ? "h-4 w-4 text-primary" : "h-4 w-4"}
        />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("imageShare.title")}</DialogTitle>
            <DialogDescription>{t("imageShare.description")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-sm font-medium">{t("imageShare.tagsLabel")}</div>
              <div className="flex flex-wrap gap-2">
                {tags.length ? (
                  tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="gap-1 pr-1">
                      {tag}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-4 w-4 p-0"
                        onClick={() =>
                          setTags((prev) => prev.filter((item) => item !== tag))
                        }
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </Badge>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {t("imageShare.tagsEmpty")}
                  </span>
                )}
              </div>
              <Input
                placeholder={t("imageShare.tagsPlaceholder")}
                value={inputValue}
                onChange={(event) => setInputValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return
                  event.preventDefault()
                  addTag()
                }}
              />
              <div className="text-xs text-muted-foreground">
                {t("imageShare.tagsHint")}
              </div>
            </div>

            <label className="flex items-start gap-3 rounded-lg border border-border/60 bg-muted/40 p-3 text-sm">
              <Checkbox
                checked={confirmed}
                onCheckedChange={(value) => setConfirmed(Boolean(value))}
              />
              <span className="leading-relaxed">
                {t("imageShare.confirm")}
              </span>
            </label>
          </div>

          <DialogFooter className="gap-2">
            {shareActive ? (
              <Button
                type="button"
                variant="secondary"
                onClick={handleUnshare}
                disabled={isSubmitting}
              >
                {t("imageShare.unshare")}
              </Button>
            ) : null}
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={!confirmed || disabled || isSubmitting}
            >
              {t("imageShare.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
