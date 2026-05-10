import { setRequestLocale } from "next-intl/server"

import { ImageWorkspaceClient } from "./components/image-workspace-client"

type ImageWorkspacePageProps = {
  params: Promise<{ locale: string }>
  searchParams?: Promise<{
    session?: string | string[]
    task?: string | string[]
    source?: string | string[]
  }>
}

function getSingleParam(
  value: string | string[] | undefined
): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default async function ImageWorkspacePage({
  params,
  searchParams,
}: ImageWorkspacePageProps) {
  const { locale } = await params
  setRequestLocale(locale)

  const resolvedSearchParams = searchParams ? await searchParams : {}
  const initialSessionId = getSingleParam(resolvedSearchParams.session) ?? null
  const initialTaskId = getSingleParam(resolvedSearchParams.task) ?? null
  const source = getSingleParam(resolvedSearchParams.source) ?? null

  return (
    <main className="h-full min-h-0 overflow-y-auto px-5 py-5 md:px-7 md:py-6">
      <div className="mx-auto flex w-full max-w-[1480px] flex-col">
        <ImageWorkspaceClient
          initialSessionId={initialSessionId}
          initialTaskId={initialTaskId}
          source={source}
        />
      </div>
    </main>
  )
}
