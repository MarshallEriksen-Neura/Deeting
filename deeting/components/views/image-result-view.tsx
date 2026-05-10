"use client"

import { memo } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import ImageResultPanel, { type ImageResultPanelPayload } from "@/components/image/image-result-panel"
import { useI18n } from "@/hooks/use-i18n"
import { useChatRuntimeStore } from "@/store/chat-runtime-store"
import type { NativeViewProps } from "./registry"

function toPayload(data: unknown): ImageResultPanelPayload | null {
  if (!data || typeof data !== "object") {
    return null
  }
  return data as ImageResultPanelPayload
}

const ImageResultView = memo<NativeViewProps>(function ImageResultView({ data }) {
  const t = useI18n("chat")
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const runtimeSessionId = useChatRuntimeStore((state) => state.sessionId)
  const payload = toPayload(data)
  if (!payload) {
    return null
  }

  const currentSessionId =
    searchParams.get("session")?.trim() || runtimeSessionId?.trim() || ""
  const openWorkspaceAction =
    pathname.includes("/chat") && currentSessionId
      ? {
          label: t("imageHistory.openSessionWorkspace"),
          onClick: () =>
            router.push(
              `/dashboard/images?session=${encodeURIComponent(currentSessionId)}&source=chat`
            ),
        }
      : null

  return <ImageResultPanel payload={payload} contextAction={openWorkspaceAction} />
})

export default ImageResultView
