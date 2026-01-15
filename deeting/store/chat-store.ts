"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type MessageRole = "user" | "assistant" | "system";

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: number;
}

interface ChatState {
  input: string;
  messages: Message[];
  isLoading: boolean;
}

interface ChatActions {
  setInput: (input: string) => void;
  addMessage: (role: MessageRole, content: string) => void;
  clearMessages: () => void;
  sendMessage: () => Promise<void>;
}

export const useChatStore = create<ChatState & ChatActions>()(
  persist(
    (set, get) => ({
      input: "",
      messages: [],
      isLoading: false,

      setInput: (input) => set({ input }),

      addMessage: (role, content) => {
        const newMessage: Message = {
          id: crypto.randomUUID(),
          role,
          content,
          createdAt: Date.now(),
        };
        set((state) => ({ messages: [...state.messages, newMessage] }));
      },

      clearMessages: () => set({ messages: [] }),

      sendMessage: async () => {
        const { input, addMessage, setInput } = get();
        if (!input.trim()) return;

        // 1. Add user message
        addMessage("user", input);
        setInput(""); // Clear input immediately for responsiveness
        set({ isLoading: true });

        try {
          // TODO: Replace with actual API call
          // await api.sendMessage(input);
          
          // Mock response
          await new Promise((resolve) => setTimeout(resolve, 1000));
          addMessage("assistant", "This is a simulated response. Connect your API in chat-store.ts!");
        } catch (error) {
          console.error("Failed to send message", error);
          // Optional: Add error message to chat
        } finally {
          set({ isLoading: false });
        }
      },
    }),
    {
      name: "deeting-chat-store",
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({ messages: state.messages }), // Persist messages but not input/loading
    }
  )
);
