import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface NotebookColumnsState {
  sourcesCollapsed: boolean
  summariesCollapsed: boolean
  wikiCollapsed: boolean
  notesCollapsed: boolean
  chatCollapsed: boolean
  toggleSources: () => void
  toggleSummaries: () => void
  toggleWiki: () => void
  toggleNotes: () => void
  toggleChat: () => void
  setSources: (collapsed: boolean) => void
  setSummaries: (collapsed: boolean) => void
  setWiki: (collapsed: boolean) => void
  setNotes: (collapsed: boolean) => void
  setChat: (collapsed: boolean) => void
}

export const useNotebookColumnsStore = create<NotebookColumnsState>()(
  persist(
    (set) => ({
      sourcesCollapsed: false,
      summariesCollapsed: false,
      wikiCollapsed: false,
      notesCollapsed: false,
      chatCollapsed: false,
      toggleSources: () => set((state) => ({ sourcesCollapsed: !state.sourcesCollapsed })),
      toggleSummaries: () => set((state) => ({ summariesCollapsed: !state.summariesCollapsed })),
      toggleWiki: () => set((state) => ({ wikiCollapsed: !state.wikiCollapsed })),
      toggleNotes: () => set((state) => ({ notesCollapsed: !state.notesCollapsed })),
      toggleChat: () => set((state) => ({ chatCollapsed: !state.chatCollapsed })),
      setSources: (collapsed) => set({ sourcesCollapsed: collapsed }),
      setSummaries: (collapsed) => set({ summariesCollapsed: collapsed }),
      setWiki: (collapsed) => set({ wikiCollapsed: collapsed }),
      setNotes: (collapsed) => set({ notesCollapsed: collapsed }),
      setChat: (collapsed) => set({ chatCollapsed: collapsed }),
    }),
    {
      name: 'notebook-columns-storage',
    }
  )
)
