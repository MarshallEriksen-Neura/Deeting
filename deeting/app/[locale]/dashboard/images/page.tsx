import { Suspense } from "react"
import { setRequestLocale } from "next-intl/server"

import { ImageWorkspaceClientWithSearchParams } from "./components/image-workspace-client-with-search-params"

type ImageWorkspacePageProps = {
  params: Promise<{ locale: string }>
}

export default async function ImageWorkspacePage({
  params,
}: ImageWorkspacePageProps) {
  const { locale } = await params
  setRequestLocale(locale)

  return (
    <main className="h-full min-h-0 overflow-y-auto px-5 py-5 md:px-7 md:py-6">
      <div className="mx-auto flex w-full max-w-[1480px] flex-col">
        <Suspense fallback={null}>
          <ImageWorkspaceClientWithSearchParams />
        </Suspense>
      </div>
    </main>
  )
}
