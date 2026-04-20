"use client"

import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"

import type { UserProfile } from "@/lib/api/user"

interface UserState {
  profile: UserProfile | null
}

interface UserActions {
  setProfile: (profile: UserProfile | null) => void
  clearProfile: () => void
}

type UserStore = UserState & UserActions

const DEFAULT_USER_STATE: UserState = {
  profile: null,
}

/**
 * 用户信息 Store
 * - 持久化到 sessionStorage，随会话清除
 */
export const useUserStore = create<UserStore>()(
  persist(
    (set) => ({
      ...DEFAULT_USER_STATE,
      setProfile: (profile) => set({ profile }),
      clearProfile: () => set(DEFAULT_USER_STATE),
    }),
    {
      name: "deeting-user-store",
      storage: createJSONStorage(() => sessionStorage),
      version: 2,
      migrate: (_state, version) => {
        if (version < 2) {
          return DEFAULT_USER_STATE
        }
        return _state
      },
    }
  )
)
