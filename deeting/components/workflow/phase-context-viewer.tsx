"use client"

import { useState } from "react"
import { Copy, Check } from "lucide-react"
import { useI18n } from "@/hooks/use-i18n"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/ui/shadcn/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/shadcn/tabs"
import { ScrollArea } from "@/ui/shadcn/scroll-area"
import { Button } from "@/ui/shadcn/button"

interface PhaseContextViewerProps {
  open: boolean
  onClose: () => void
  phaseId: string
  phaseTitle: string
  contextMd: string | null
  contextJson: Record<string, unknown> | null
}

export function PhaseContextViewer({
  open,
  onClose,
  phaseId,
  phaseTitle,
  contextMd,
  contextJson,
}: PhaseContextViewerProps) {
  const t = useI18n("workflow")
  const [copied, setCopied] = useState(false)

  async function handleCopy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard API may not be available
    }
  }

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full max-w-lg p-0">
        <SheetHeader className="px-4 py-3 border-b border-border/50">
          <SheetTitle className="text-base">{t("context.title")}</SheetTitle>
          <SheetDescription className="text-xs">
            {phaseId}: {phaseTitle}
          </SheetDescription>
        </SheetHeader>

        <Tabs defaultValue="markdown" className="flex h-[calc(100%-64px)] flex-col">
          <TabsList className="mx-4 mt-2 w-fit">
            <TabsTrigger value="markdown" className="text-xs">
              {t("context.tabMarkdown")}
            </TabsTrigger>
            <TabsTrigger value="json" className="text-xs">
              {t("context.tabJson")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="markdown" className="flex-1 mt-0">
            <div className="relative h-full">
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-4 top-2 h-7 w-7 z-10"
                onClick={() => contextMd && handleCopy(contextMd)}
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Button>
              <ScrollArea className="h-full">
                <div className="p-4 pt-2">
                  <pre className="whitespace-pre-wrap text-sm text-muted-foreground font-sans leading-relaxed">
                    {contextMd ?? t("result.noResults")}
                  </pre>
                </div>
              </ScrollArea>
            </div>
          </TabsContent>

          <TabsContent value="json" className="flex-1 mt-0">
            <div className="relative h-full">
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-4 top-2 h-7 w-7 z-10"
                onClick={() =>
                  contextJson && handleCopy(JSON.stringify(contextJson, null, 2))
                }
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Button>
              <ScrollArea className="h-full">
                <div className="p-4 pt-2">
                  <pre className="whitespace-pre-wrap text-xs text-muted-foreground font-mono leading-relaxed">
                    {contextJson
                      ? JSON.stringify(contextJson, null, 2)
                      : t("result.noResults")}
                  </pre>
                </div>
              </ScrollArea>
            </div>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}
