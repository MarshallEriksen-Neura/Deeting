"use client"

import { create } from "zustand"

export interface ArtifactData {
  id?: string
  type: string
  name: string
  payload: unknown
  metadata?: Record<string, unknown>
}

export interface ArtifactEditingTarget {
  artifactId: string
  revisionId?: string
  revisionNumber?: number
  fileId?: string
  type: string
  name: string
  contentType?: string
  size?: number
}

interface ArtifactStore {
  activeArtifact: ArtifactData | null
  editingArtifact: ArtifactEditingTarget | null
  isOpen: boolean
  setActiveArtifact: (artifact: ArtifactData | null) => void
  setEditingArtifact: (artifact: ArtifactEditingTarget | null) => void
  clearEditingArtifact: () => void
  setIsOpen: (open: boolean) => void
  closeArtifact: () => void
}

export const useArtifactStore = create<ArtifactStore>((set) => ({
  activeArtifact: null,
  editingArtifact: null,
  isOpen: false,
  setActiveArtifact: (artifact) => set({ 
    activeArtifact: artifact, 
    isOpen: !!artifact 
  }),
  setEditingArtifact: (artifact) => set({ editingArtifact: artifact }),
  clearEditingArtifact: () => set({ editingArtifact: null }),
  setIsOpen: (open) => set({ isOpen: open }),
  closeArtifact: () => set({ activeArtifact: null, isOpen: false }),
}))
