"use client";

import {
  createJSONStorage,
  type PersistStorage,
  type StateStorage,
} from "zustand/middleware";

function clearCorruptEntry(storage: StateStorage, name: string) {
  try {
    storage.removeItem(name);
  } catch {
    // Ignore cleanup failures; the caller still gets a null rehydrate result.
  }
}

export function createSafeJSONStorage<S>(
  getStorage: () => StateStorage,
): PersistStorage<S> | undefined {
  const storage = createJSONStorage<S>(getStorage);

  if (!storage) {
    return storage;
  }

  return {
    getItem(name) {
      try {
        return storage.getItem(name);
      } catch {
        clearCorruptEntry(getStorage(), name);
        return null;
      }
    },
    setItem(name, value) {
      return storage.setItem(name, value);
    },
    removeItem(name) {
      return storage.removeItem(name);
    },
  };
}
