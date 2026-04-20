"use client"

import * as React from "react"
import { Github, Loader2 } from "lucide-react"
import { useTranslations } from "next-intl"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/ui/shadcn/dialog"
import { Input } from "@/ui/shadcn/input"
import { Label } from "@/ui/shadcn/label"
import { Button } from "@/ui/shadcn/button"

interface ImportRepoDialogProps {
  onSubmit: (payload: {
    repo_url: string
    revision?: string
    skill_id?: string
  }) => Promise<void>
}

export function ImportRepoDialog({ onSubmit }: ImportRepoDialogProps) {
  const t = useTranslations("plugins")
  const [open, setOpen] = React.useState(false)
  const [repoUrl, setRepoUrl] = React.useState("")
  const [revision, setRevision] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const resetForm = React.useCallback(() => {
    setRepoUrl("")
    setRevision("")
    setError(null)
  }, [])

  React.useEffect(() => {
    if (open) resetForm()
  }, [open, resetForm])

  const isValidUrl = React.useMemo(() => {
    if (!repoUrl.trim()) return false
    try {
      const url = new URL(repoUrl)
      return url.hostname === "github.com" && url.pathname.split("/").filter(Boolean).length >= 2
    } catch {
      return false
    }
  }, [repoUrl])

  const handleSubmit = React.useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!isValidUrl) return

      setSubmitting(true)
      setError(null)
      try {
        await onSubmit({
          repo_url: repoUrl.trim(),
          revision: revision.trim() || undefined,
        })
        setOpen(false)
      } catch {
        setError(t("importRepo.error"))
      } finally {
        setSubmitting(false)
      }
    },
    [isValidUrl, onSubmit, repoUrl, revision, t],
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="rounded-full gap-2">
          <Github size={16} />
          {t("importRepo.trigger")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Github size={18} />
              {t("importRepo.title")}
            </DialogTitle>
            <DialogDescription>
              {t("importRepo.description")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="repo-url">{t("importRepo.urlLabel")}</Label>
              <Input
                id="repo-url"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder={t("importRepo.urlPlaceholder")}
                autoComplete="url"
              />
              {repoUrl && !isValidUrl && (
                <p className="text-xs text-destructive">
                  {t("importRepo.urlInvalid")}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="repo-revision">
                {t("importRepo.revisionLabel")}
              </Label>
              <Input
                id="repo-revision"
                value={revision}
                onChange={(e) => setRevision(e.target.value)}
                placeholder={t("importRepo.revisionPlaceholder")}
              />
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              {t("dialog.cancel")}
            </Button>
            <Button type="submit" disabled={!isValidUrl || submitting}>
              {submitting && <Loader2 size={14} className="mr-1 animate-spin" />}
              {submitting ? t("importRepo.submitting") : t("importRepo.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
