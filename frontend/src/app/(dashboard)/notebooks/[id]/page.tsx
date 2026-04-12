'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { NotebookHeader } from '../components/NotebookHeader'
import { SourcesColumn } from '../components/SourcesColumn'
import { SummariesColumn } from '../components/SummariesColumn'
import { WikiCardsColumn } from '../components/WikiCardsColumn'
import { NotesColumn } from '../components/NotesColumn'
import { useNotebook } from '@/lib/hooks/use-notebooks'
import { useNotebookSources } from '@/lib/hooks/use-sources'
import { useNotes } from '@/lib/hooks/use-notes'
import { useNotebookSummaries } from '@/lib/hooks/use-summaries'
import { useNotebookWikiCards } from '@/lib/hooks/use-wiki-cards'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { useNotebookColumnsStore } from '@/lib/stores/notebook-columns-store'
import { useTranslation } from '@/lib/hooks/use-translation'
import { cn } from '@/lib/utils'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BookMarked, BookText, FileText, StickyNote } from 'lucide-react'

export type ContextMode = 'off' | 'insights' | 'full'

export interface ContextSelections {
  sources: Record<string, ContextMode>
  notes: Record<string, ContextMode>
}

export default function NotebookPage() {
  const { t, language } = useTranslation()
  const params = useParams()

  // Ensure the notebook ID is properly decoded from URL
  const notebookId = params?.id ? decodeURIComponent(params.id as string) : ''

  const { data: notebook, isLoading: notebookLoading } = useNotebook(notebookId)
  const {
    sources,
    isLoading: sourcesLoading,
    refetch: refetchSources,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useNotebookSources(notebookId)
  const { data: notes, isLoading: notesLoading } = useNotes(notebookId)
  const { data: summaries, isLoading: summariesLoading } = useNotebookSummaries(notebookId)
  const { data: wikiCards, isLoading: wikiCardsLoading } = useNotebookWikiCards(notebookId)

  // Get collapse states for dynamic layout
  const { sourcesCollapsed, summariesCollapsed, wikiCollapsed, notesCollapsed } = useNotebookColumnsStore()

  // Mobile tab state
  const [mobileActiveTab, setMobileActiveTab] = useState<'sources' | 'summaries' | 'wiki' | 'notes'>('sources')

  // Context selection state
  const [contextSelections, setContextSelections] = useState<ContextSelections>({
    sources: {},
    notes: {}
  })

  const expandedColumnClass = 'flex-1 basis-0 min-w-[18rem]'

  // Initialize and update selections when sources load or change
  useEffect(() => {
    if (sources && sources.length > 0) {
      setContextSelections(prev => {
        const newSourceSelections = { ...prev.sources }
        sources.forEach(source => {
          const currentMode = newSourceSelections[source.id]
          const hasInsights = source.insights_count > 0

          if (currentMode === undefined) {
            // Initial setup - default based on insights availability
            newSourceSelections[source.id] = hasInsights ? 'insights' : 'full'
          } else if (currentMode === 'full' && hasInsights) {
            // Source gained insights while in 'full' mode - auto-switch to 'insights'
            newSourceSelections[source.id] = 'insights'
          }
        })
        return { ...prev, sources: newSourceSelections }
      })
    }
  }, [sources])

  useEffect(() => {
    if (notes && notes.length > 0) {
      setContextSelections(prev => {
        const newNoteSelections = { ...prev.notes }
        notes.forEach(note => {
          // Only set default if not already set
          if (!(note.id in newNoteSelections)) {
            // Notes default to 'full'
            newNoteSelections[note.id] = 'full'
          }
        })
        return { ...prev, notes: newNoteSelections }
      })
    }
  }, [notes])

  // Handler to update context selection
  const handleContextModeChange = (itemId: string, mode: ContextMode, type: 'source' | 'note') => {
    setContextSelections(prev => ({
      ...prev,
      [type === 'source' ? 'sources' : 'notes']: {
        ...(type === 'source' ? prev.sources : prev.notes),
        [itemId]: mode
      }
    }))
  }

  if (notebookLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (!notebook) {
    return (
      <AppShell>
        <div className="p-6">
          <h1 className="text-2xl font-bold mb-4">{t.notebooks.notFound}</h1>
          <p className="text-muted-foreground">{t.notebooks.notFoundDesc}</p>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex-shrink-0 p-6 pb-0">
          <NotebookHeader notebook={notebook} />
        </div>

        <div className="flex-1 p-6 pt-6 overflow-x-auto flex flex-col">
          {/* Mobile: Tabbed interface */}
          <div className="lg:hidden">
            <div className="mb-4">
              <Tabs value={mobileActiveTab} onValueChange={(value) => setMobileActiveTab(value as 'sources' | 'summaries' | 'wiki' | 'notes')}>
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="sources" className="gap-2">
                    <FileText className="h-4 w-4" />
                    {t.navigation.sources}
                  </TabsTrigger>
                  <TabsTrigger value="summaries" className="gap-2">
                    <BookText className="h-4 w-4" />
                    {t.podcasts.summary}
                  </TabsTrigger>
                  <TabsTrigger value="wiki" className="gap-2">
                    <BookMarked className="h-4 w-4" />
                    {language?.startsWith('zh') ? 'Wiki' : 'Wiki'}
                  </TabsTrigger>
                  <TabsTrigger value="notes" className="gap-2">
                    <StickyNote className="h-4 w-4" />
                    {t.common.notes}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            <div className="flex-1 overflow-hidden">
              {mobileActiveTab === 'sources' && (
                <SourcesColumn
                  sources={sources}
                  isLoading={sourcesLoading}
                  notebookId={notebookId}
                  notebookName={notebook?.name}
                  onRefresh={refetchSources}
                  contextSelections={contextSelections.sources}
                  onContextModeChange={(sourceId, mode) => handleContextModeChange(sourceId, mode, 'source')}
                  hasNextPage={hasNextPage}
                  isFetchingNextPage={isFetchingNextPage}
                  fetchNextPage={fetchNextPage}
                />
              )}
              {mobileActiveTab === 'notes' && (
                <NotesColumn
                  notes={notes}
                  isLoading={notesLoading}
                  notebookId={notebookId}
                  contextSelections={contextSelections.notes}
                  onContextModeChange={(noteId, mode) => handleContextModeChange(noteId, mode, 'note')}
                />
              )}
              {mobileActiveTab === 'summaries' && (
                <SummariesColumn
                  summaries={summaries}
                  isLoading={summariesLoading}
                  notebookId={notebookId}
                />
              )}
              {mobileActiveTab === 'wiki' && (
                <WikiCardsColumn
                  wikiCards={wikiCards}
                  isLoading={wikiCardsLoading}
                  notebookId={notebookId}
                />
              )}
            </div>
          </div>

          {/* Desktop: Collapsible columns layout */}
          <div className={cn(
            'hidden lg:flex h-full min-h-0 gap-5 transition-all duration-300 ease-out',
            'flex-row'
          )}>
            {/* Sources Column */}
            <div className={cn(
              'transition-all duration-300 ease-out',
              sourcesCollapsed ? 'w-12 flex-shrink-0' : expandedColumnClass
            )}>
              <SourcesColumn
                sources={sources}
                isLoading={sourcesLoading}
                notebookId={notebookId}
                notebookName={notebook?.name}
                onRefresh={refetchSources}
                contextSelections={contextSelections.sources}
                onContextModeChange={(sourceId, mode) => handleContextModeChange(sourceId, mode, 'source')}
                hasNextPage={hasNextPage}
                isFetchingNextPage={isFetchingNextPage}
                fetchNextPage={fetchNextPage}
              />
            </div>

            {/* Summaries Column */}
            <div className={cn(
              'transition-all duration-300 ease-out',
              summariesCollapsed ? 'w-12 flex-shrink-0' : expandedColumnClass
            )}>
              <SummariesColumn
                summaries={summaries}
                isLoading={summariesLoading}
                notebookId={notebookId}
              />
            </div>

            {/* Wiki Cards Column */}
            <div className={cn(
              'transition-all duration-300 ease-out',
              wikiCollapsed ? 'w-12 flex-shrink-0' : expandedColumnClass
            )}>
              <WikiCardsColumn
                wikiCards={wikiCards}
                isLoading={wikiCardsLoading}
                notebookId={notebookId}
              />
            </div>

            {/* Notes Column */}
            <div className={cn(
              'transition-all duration-300 ease-out',
              notesCollapsed ? 'w-12 flex-shrink-0' : expandedColumnClass
            )}>
              <NotesColumn
                notes={notes}
                isLoading={notesLoading}
                notebookId={notebookId}
                contextSelections={contextSelections.notes}
                onContextModeChange={(noteId, mode) => handleContextModeChange(noteId, mode, 'note')}
              />
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
