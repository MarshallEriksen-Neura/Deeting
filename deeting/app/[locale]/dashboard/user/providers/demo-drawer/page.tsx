"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { GlassButton } from "@/components/ui/glass-button"
import { ProviderPresetConfig } from "@/components/providers/connect-provider-drawer"

const ConnectProviderDrawer = dynamic(
  () => import("@/components/providers/connect-provider-drawer").then((m) => m.default),
  { ssr: false }
)

export default function DemoDrawerPage() {
  const [isOpen, setIsOpen] = React.useState(false)
  const [selectedPreset, setSelectedPreset] = React.useState<ProviderPresetConfig | null>(null)

  const handleOpenSystem = () => {
    setSelectedPreset({
      name: "OpenAI",
      type: "system",
      default_endpoint: "https://api.openai.com/v1",
      protocol: "openai",
      brand_color: "#10a37f",
      icon_key: "simple-icons:openai"
    })
    setIsOpen(true)
  }

  const handleOpenCustom = () => {
    setSelectedPreset({
      name: "Custom / Local",
      type: "custom",
      default_endpoint: "http://localhost:11434",
      protocol: "openai",
      brand_color: "#3b82f6",
      icon_key: "lucide:server"
    })
    
    setIsOpen(true)
  }

  return (
    <div className="p-10 space-y-8">
      <h1 className="text-2xl font-bold">Connect Provider Drawer Demo</h1>
      
      <div className="flex gap-4">
        <GlassButton onClick={handleOpenSystem}>
          Open Official (OpenAI)
        </GlassButton>
        
        <GlassButton variant="outline" onClick={handleOpenCustom}>
          Open Custom (Local)
        </GlassButton>
      </div>

      <div className="p-4 border rounded-lg bg-black/20 text-sm text-muted-foreground">
        <p>Click buttons above to preview the adaptive drawer UI.</p>
        <p>Current State: {isOpen ? "Open" : "Closed"}</p>
      </div>

      <ConnectProviderDrawer 
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        preset={selectedPreset}
        onSave={(data) => {
          console.log("Saved Config:", data)
          alert("Config Saved (Check Console)")
        }}
      />
    </div>
  )
}
