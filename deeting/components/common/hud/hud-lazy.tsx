"use client"

import dynamic from "next/dynamic"

const loadModelPicker = () =>
  import("@/components/models/model-picker").then((module) => module.ModelPicker)

const loadHudControlCenterPanel = () =>
  import("./hud-control-center-panel").then((module) => module.HudControlCenterPanel)

const loadHudSystemMenuPanel = () =>
  import("./hud-system-menu-panel").then((module) => module.HudSystemMenuPanel)

export const DeferredModelPicker = dynamic(loadModelPicker, {
  ssr: false,
})

export const DeferredHudControlCenterPanel = dynamic(loadHudControlCenterPanel, {
  ssr: false,
})

export const DeferredHudSystemMenuPanel = dynamic(loadHudSystemMenuPanel, {
  ssr: false,
})

export function preloadHudDeferredSurfaces() {
  void loadModelPicker()
  void loadHudControlCenterPanel()
  void loadHudSystemMenuPanel()
}
