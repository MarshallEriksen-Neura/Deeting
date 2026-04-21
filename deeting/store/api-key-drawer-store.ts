"use client"

import { create } from "zustand"

interface ApiKeyDrawerState {
  open: boolean
  setOpen: (open: boolean) => void
  openDrawer: () => void
  closeDrawer: () => void
}

export const useApiKeyDrawerStore = create<ApiKeyDrawerState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  openDrawer: () => set({ open: true }),
  closeDrawer: () => set({ open: false }),
}))
