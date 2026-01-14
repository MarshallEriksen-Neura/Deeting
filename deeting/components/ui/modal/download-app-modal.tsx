"use client"

import * as React from "react"
import { Download, Monitor, ShieldCheck, Zap } from "lucide-react"
import { useTranslations } from "next-intl"

import { GlassButton } from "@/components/ui/glass-button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useDownloadModalStore } from "@/store/modal-store"

export function DownloadAppModal() {
  const { isOpen, title, description, closeDownloadModal } = useDownloadModalStore()
  // const t = useTranslations("common.downloadModal") // Assuming you'll add translations later

  const handleDownload = () => {
    // Replace with your actual download link or logic
    window.open("https://github.com/AI-Higress-Gateway/deeting/releases", "_blank")
    closeDownloadModal()
  }

  return (
    <Dialog open={isOpen} onOpenChange={closeDownloadModal}>
      <DialogContent className="sm:max-w-[425px] overflow-hidden p-0 gap-0 border-none shadow-2xl">
        <div className="bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 p-6 text-white text-center">
          <div className="mx-auto bg-white/20 backdrop-blur-md w-16 h-16 rounded-2xl flex items-center justify-center mb-4 shadow-inner ring-1 ring-white/30">
            <Download className="w-8 h-8 text-white drop-shadow-md" />
          </div>
          <DialogTitle className="text-2xl font-bold tracking-tight mb-2">
            {title || "Unlock Full Potential"}
          </DialogTitle>
          <DialogDescription className="text-white/80 font-medium">
            {description || "To use local models and advanced system features, you need our powerful desktop app."}
          </DialogDescription>
        </div>

        <div className="p-6 bg-background space-y-6">
          <div className="space-y-4">
            <FeatureItem 
              icon={<Zap className="w-5 h-5 text-amber-500" />}
              title="Zero Latency"
              desc="Direct connection to local models via localhost."
            />
            <FeatureItem 
              icon={<ShieldCheck className="w-5 h-5 text-emerald-500" />}
              title="Privacy First"
              desc="Your data stays on your device. No cloud processing."
            />
            <FeatureItem 
              icon={<Monitor className="w-5 h-5 text-blue-500" />}
              title="System Integration"
              desc="Global shortcuts, file drag & drop, and more."
            />
          </div>

          <DialogFooter className="flex-col sm:flex-col gap-2 mt-4">
            <GlassButton 
              className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-semibold py-6 shadow-lg hover:shadow-xl transition-all duration-300" 
              onClick={handleDownload}
            >
              Download for Desktop
            </GlassButton>
            <GlassButton 
              variant="ghost" 
              className="w-full text-muted-foreground hover:text-foreground" 
              onClick={closeDownloadModal}
            >
              Maybe Later
            </GlassButton>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function FeatureItem({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-4 p-3 rounded-lg hover:bg-muted/50 transition-colors">
      <div className="mt-1 bg-background p-2 rounded-md shadow-sm border">
        {icon}
      </div>
      <div>
        <h4 className="font-semibold text-foreground text-sm">{title}</h4>
        <p className="text-muted-foreground text-xs leading-relaxed">{desc}</p>
      </div>
    </div>
  )
}
