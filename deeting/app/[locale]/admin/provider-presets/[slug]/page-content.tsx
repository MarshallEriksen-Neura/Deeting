"use client"

import { PresetEditorConsole } from "../components/preset-editor-console"

export function PageContent({ slug }: { slug: string }) {
  return <PresetEditorConsole mode="edit" slug={slug} />
}
