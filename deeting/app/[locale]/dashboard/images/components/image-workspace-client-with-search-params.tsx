"use client"

import { useSearchParams } from "next/navigation"

import { ImageWorkspaceClient } from "./image-workspace-client"

export function ImageWorkspaceClientWithSearchParams() {
  const searchParams = useSearchParams()

  return (
    <ImageWorkspaceClient
      initialSessionId={searchParams.get("session")}
      initialTaskId={searchParams.get("task")}
      source={searchParams.get("source")}
    />
  )
}
