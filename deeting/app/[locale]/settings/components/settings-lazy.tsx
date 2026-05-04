"use client"

import dynamic from "next/dynamic"

export const DeferredAgentSettingsCard = dynamic(
  () => import("./agent-settings-card").then((mod) => mod.AgentSettingsCard),
  { ssr: false }
)

export const DeferredDesktopAiAccessSettingsCard = dynamic(
  () =>
    import("./desktop-ai-access-settings-card").then(
      (mod) => mod.DesktopAiAccessSettingsCard
    ),
  { ssr: false }
)

export const DeferredDesktopSandboxSettingsCard = dynamic(
  () =>
    import("./desktop-sandbox-settings-card").then(
      (mod) => mod.DesktopSandboxSettingsCard
    ),
  { ssr: false }
)

export const DeferredSandboxImageRegistriesCard = dynamic(
  () =>
    import("./sandbox-image-registries-card").then(
      (mod) => mod.SandboxImageRegistriesCard
    ),
  { ssr: false }
)

export const DeferredDesktopVersionManagementCard = dynamic(
  () =>
    import("./desktop-version-management-card").then(
      (mod) => mod.DesktopVersionManagementCard
    ),
  { ssr: false }
)

export const DeferredDesktopWindowSettingsCard = dynamic(
  () =>
    import("./desktop-window-settings-card").then(
      (mod) => mod.DesktopWindowSettingsCard
    ),
  { ssr: false }
)

export const DeferredDesktopShortcutSettingsCard = dynamic(
  () =>
    import("./desktop-shortcut-settings-card").then(
      (mod) => mod.DesktopShortcutSettingsCard
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

export const DeferredDesktopNetworkSettingsCard = dynamic(
  () =>
    import("./desktop-network-settings-card").then(
      (mod) => mod.DesktopNetworkSettingsCard
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

export const DeferredExternalEcosystemSettingsCard = dynamic(
  () =>
    import("./external-ecosystem-settings-card").then(
      (mod) => mod.ExternalEcosystemSettingsCard
    ),
  { ssr: false }
)

export const DeferredSettingsModelPicker = dynamic(
  () => import("@/components/models/model-picker").then((mod) => mod.ModelPicker),
  { ssr: false }
)
