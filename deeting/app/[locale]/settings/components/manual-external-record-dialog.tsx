"use client"

import { useState } from "react"
import { useI18n } from "@/hooks/use-i18n"
import { Button } from "@/ui/shadcn/button"
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
import { Textarea } from "@/ui/shadcn/textarea"
import { type CreateManualExternalRecordPayload } from "@/lib/api/external-sources"

interface ManualExternalRecordDialogProps {
  children: React.ReactNode
  onCreate: (payload: CreateManualExternalRecordPayload) => Promise<void>
}

export function ManualExternalRecordDialog({
  children,
  onCreate,
}: ManualExternalRecordDialogProps) {
  const t = useI18n("settings")
  const [open, setOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [assetFamily, setAssetFamily] = useState("manual_note")
  const [sourceAssetId, setSourceAssetId] = useState("")
  const [sourceVersion, setSourceVersion] = useState("")
  const [payloadText, setPayloadText] = useState("")
  const [filename, setFilename] = useState("")
  const [contentType, setContentType] = useState("")

  async function handleFileSelected(file: File | undefined) {
    if (!file) return
    const text = await file.text()
    setPayloadText(text)
    setFilename(file.name)
    setContentType(file.type || "text/plain")
    if (!sourceAssetId.trim()) {
      setSourceAssetId(file.name.replace(/\.[^.]+$/, ""))
    }
    if (assetFamily === "manual_note") {
      setAssetFamily(file.name.toLowerCase().endsWith(".md") ? "manual_markdown" : "manual_note")
    }
  }

  async function handleSubmit() {
    setIsSubmitting(true)
    try {
      await onCreate({
        asset_family: assetFamily.trim(),
        source_asset_id: sourceAssetId.trim(),
        source_version: sourceVersion.trim() || undefined,
        payload_text: payloadText,
        filename: filename || undefined,
        content_type: contentType || undefined,
        import_mode: filename ? "file_upload" : "paste",
      })
      setOpen(false)
      setSourceAssetId("")
      setSourceVersion("")
      setPayloadText("")
      setFilename("")
      setContentType("")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("ecosystem.manualRecord.title")}</DialogTitle>
          <DialogDescription>
            {t("ecosystem.manualRecord.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>{t("ecosystem.manualRecord.fileLabel")}</Label>
            <Input
              type="file"
              accept=".md,.txt,.json,text/markdown,text/plain,application/json"
              onChange={(event) => {
                void handleFileSelected(event.target.files?.[0])
              }}
            />
            <p className="text-xs text-muted-foreground">
              {filename || t("ecosystem.manualRecord.fileHelp")}
            </p>
          </div>
          <div className="space-y-2">
            <Label>{t("ecosystem.manualRecord.assetFamilyLabel")}</Label>
            <Input
              value={assetFamily}
              onChange={(event) => setAssetFamily(event.target.value)}
              placeholder="manual_note"
            />
          </div>
          <div className="space-y-2">
            <Label>{t("ecosystem.manualRecord.assetIdLabel")}</Label>
            <Input
              value={sourceAssetId}
              onChange={(event) => setSourceAssetId(event.target.value)}
              placeholder="ticket-123"
            />
          </div>
          <div className="space-y-2">
            <Label>{t("ecosystem.manualRecord.assetVersionLabel")}</Label>
            <Input
              value={sourceVersion}
              onChange={(event) => setSourceVersion(event.target.value)}
              placeholder="v1"
            />
          </div>
          <div className="space-y-2">
            <Label>{t("ecosystem.manualRecord.payloadLabel")}</Label>
            <Textarea
              value={payloadText}
              onChange={(event) => setPayloadText(event.target.value)}
              placeholder={t("ecosystem.manualRecord.payloadPlaceholder")}
              className="min-h-40"
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            {t("ecosystem.create.cancel")}
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || !sourceAssetId.trim() || !payloadText.trim()}
          >
            {isSubmitting
              ? t("ecosystem.manualRecord.importing")
              : t("ecosystem.manualRecord.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
