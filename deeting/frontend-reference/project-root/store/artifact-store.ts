"use client"

import { create } from "zustand"

export interface ArtifactData {
  id?: string
  type: string
  name: string
  payload: any
  metadata?: Record<string, any>
}

interface ArtifactStore {
  activeArtifact: ArtifactData | null
  isOpen: boolean
  setActiveArtifact: (artifact: ArtifactData | null) => void
  setIsOpen: (open: boolean) => void
  closeArtifact: () => void
}

export const useArtifactStore = create<ArtifactStore>((set) => ({
  activeArtifact: null,
  isOpen: false,
  setActiveArtifact: (artifact) => set({ 
    activeArtifact: artifact, 
    isOpen: !!artifact 
  }),
  setIsOpen: (open) => set({ isOpen: open }),
  closeArtifact: () => set({ activeArtifact: null, isOpen: false }),
}))
