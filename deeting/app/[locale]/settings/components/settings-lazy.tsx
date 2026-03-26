"use client"

import dynamic from "next/dynamic"

export const DeferredAgentSettingsCard = dynamic(
  () => import("./agent-settings-card").then((mod) => mod.AgentSettingsCard),
  { ssr: false }
)

export const DeferredDesktopSandboxSettingsCard = dynamic(
  () =>
    import("./desktop-sandbox-settings-card").then(
      (mod) => mod.DesktopSandboxSettingsCard
    ),
  { ssr: false }
)

export const DeferredDesktopBrowserAgentPanelCard = dynamic(
  () =>
    import("./desktop-browser-agent-panel-card").then(
      (mod) => mod.DesktopBrowserAgentPanelCard
    ),
  { ssr: false }
)

export const DeferredDesktopObjectStorageSettingsCard = dynamic(
  () =>
    import("./desktop-object-storage-settings-card").then(
      (mod) => mod.DesktopObjectStorageSettingsCard
    ),
  { ssr: false }
)

export const DeferredDesktopScoutSettingsCard = dynamic(
  () =>
    import("./desktop-scout-settings-card").then(
      (mod) => mod.DesktopScoutSettingsCard
    ),
  { ssr: false }
)

export const DeferredSettingsModelPicker = dynamic(
  () => import("@/components/models/model-picker").then((mod) => mod.ModelPicker),
  { ssr: false }
)
