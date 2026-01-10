"use client";

import { create } from "zustand";

export type ComparisonStatus = "running" | "succeeded" | "failed";

export interface ComparisonVariant {
  id: string;
  model: string;
  status: ComparisonStatus;
  created_at: string;
  content?: string;
  error_message?: string;
}

type StoreState = {
  variantsByKey: Record<string, ComparisonVariant[]>;
  addVariant: (key: string, variant: ComparisonVariant) => void;
  updateVariant: (
    key: string,
    id: string,
    patch: Partial<ComparisonVariant>
  ) => void;
  getVariants: (key: string) => ComparisonVariant[];
  clearByConversation: (conversationId: string) => void;
};

export const useChatComparisonStore = create<StoreState>((set, get) => ({
  variantsByKey: {},

  addVariant: (key, variant) =>
    set((state) => {
      const current = state.variantsByKey[key] ?? [];
      return {
        variantsByKey: { ...state.variantsByKey, [key]: [...current, variant] },
      };
    }),

  updateVariant: (key, id, patch) =>
    set((state) => {
      const current = state.variantsByKey[key] ?? [];
      const next = current.map((v) => (v.id === id ? { ...v, ...patch } : v));
      return { variantsByKey: { ...state.variantsByKey, [key]: next } };
    }),

  getVariants: (key) => get().variantsByKey[key] ?? [],

  clearByConversation: (conversationId) =>
    set((state) => {
      const next: Record<string, ComparisonVariant[]> = {};
      const prefix = `${conversationId}:`;
      for (const [k, v] of Object.entries(state.variantsByKey)) {
        if (!k.startsWith(prefix)) next[k] = v;
      }
      return { variantsByKey: next };
    }),
}));

