"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { useNotifications } from "@/components/contexts/notification-context"
import { MCPSource } from "@/types/mcp"

interface AddSourceDialogProps {
  children: React.ReactNode
  onCreate: (payload: {
    name: string
    sourceType: MCPSource["type"]
    pathOrUrl: string
    trustLevel: MCPSource["trustLevel"]
    authToken?: string
  }) => void
}

export function AddSourceDialog({ children, onCreate }: AddSourceDialogProps) {
  const t = useTranslations("mcp")
  const { addNotification } = useNotifications()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [sourceType, setSourceType] = useState<MCPSource["type"]>("modelscope")
  const [pathOrUrl, setPathOrUrl] = useState("")
  const [token, setToken] = useState("")

  const handleSubmit = () => {
    if (!name || !pathOrUrl) {
      addNotification({
        type: "warning",
        title: t("toast.missingFields"),
        description: t("addSource.title"),
        timestamp: Date.now(),
      })
      return
    }
    const trustLevel: MCPSource["trustLevel"] =
      sourceType === "modelscope" ? "official" : "community"
    onCreate({
      name,
      sourceType,
      pathOrUrl,
      trustLevel,
      authToken: token || undefined,
    })
    setOpen(false)
    setName("")
    setPathOrUrl("")
    setToken("")
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("addSource.title")}</DialogTitle>
          <DialogDescription>
            {t("addSource.description")}
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
            <div className="space-y-2">
                <Label>{t("addSource.nameLabel")}</Label>
                <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("addSource.placeholders.name")} />
            </div>
            <div className="space-y-2">
                <Label>{t("addSource.typeLabel")}</Label>
                <Select value={sourceType} onValueChange={(value) => setSourceType(value as MCPSource["type"])}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("addSource.placeholders.type")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="modelscope">{t("addSource.types.modelscope")}</SelectItem>
                    <SelectItem value="github">{t("addSource.types.github")}</SelectItem>
                    <SelectItem value="url">{t("addSource.types.url")}</SelectItem>
                  </SelectContent>
                </Select>
            </div>

            <div className="space-y-2">
                <Label>{t("addSource.urlLabel")}</Label>
                <Input value={pathOrUrl} onChange={(event) => setPathOrUrl(event.target.value)} placeholder={t("addSource.placeholders.url")} />
            </div>

            <div className="space-y-2">
                <Label>{t("addSource.tokenLabel")}</Label>
                <Input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder={t("addSource.placeholders.token")} />
            </div>
        </div>

        <DialogFooter>
            <Button type="submit" onClick={handleSubmit}>{t("addSource.submit")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
