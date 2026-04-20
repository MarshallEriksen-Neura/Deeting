import { create } from 'zustand'

interface DownloadModalState {
  isOpen: boolean
  title?: string
  description?: string
  openDownloadModal: (props?: { title?: string; description?: string }) => void
  closeDownloadModal: () => void
}

export const useDownloadModalStore = create<DownloadModalState>((set) => ({
  isOpen: false,
  title: undefined,
  description: undefined,
  openDownloadModal: (props) => set({ isOpen: true, ...props }),
  closeDownloadModal: () => set({ isOpen: false }),
}))
