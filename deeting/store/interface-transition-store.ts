"use client";

import { create } from "zustand";

interface InterfaceTransitionState {
  isLocaleTransitioning: boolean;
  startLocaleTransition: () => void;
  endLocaleTransition: () => void;
}

export const useInterfaceTransitionStore = create<InterfaceTransitionState>((set) => ({
  isLocaleTransitioning: false,
  startLocaleTransition: () => set({ isLocaleTransitioning: true }),
  endLocaleTransition: () => set({ isLocaleTransitioning: false }),
}));
