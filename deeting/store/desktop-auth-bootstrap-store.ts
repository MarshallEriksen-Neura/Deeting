"use client"

import { create } from "zustand"

interface DesktopAuthBootstrapState {
  isReady: boolean
  setReady: (ready: boolean) => void
}

const initialReady = process.env.NEXT_PUBLIC_IS_TAURI !== "true"

export const useDesktopAuthBootstrapStore = create<DesktopAuthBootstrapState>()((set) => ({
  isReady: initialReady,
  setReady: (ready) => set({ isReady: ready }),
}))
