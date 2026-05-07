import type { QueryClient } from '@tanstack/react-query'
import type { NoteResponse, NotebookResponse, SourceListResponse } from '@/lib/types/api'

export type SourceMode = 'off' | 'insights' | 'full'

export interface NotebookSelection {
  sources: Record<string, SourceMode>
  notes: Record<string, SourceMode>
}

export interface NotebookSummary {
  notebookId: string
  sources: number
  notes: number
}

export interface ContentSelectionPanelProps {
  notebooks: NotebookResponse[]
  isLoading: boolean
  selectedNotebookSummaries: NotebookSummary[]
  tokenCount: number
  charCount: number
  expandedNotebooks: string[]
  setExpandedNotebooks: (notebooks: string[]) => void
  selections: Record<string, NotebookSelection>
  sourcesByNotebook: Record<string, SourceListResponse[]>
  notesByNotebook: Record<string, NoteResponse[]>
  fetchingNotebookIds: Set<string>
  handleNotebookToggle: (notebookId: string, checked: boolean | 'indeterminate') => void
  handleSourceModeChange: (notebookId: string, sourceId: string, mode: SourceMode) => void
  handleNoteToggle: (notebookId: string, noteId: string, checked: boolean | 'indeterminate') => void
  queryClient: QueryClient
}
