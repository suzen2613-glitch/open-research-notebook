'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { NotebookHeader, type NotebookOverview } from '../components/NotebookHeader'
import { SourcesColumn } from '../components/SourcesColumn'
import { SummariesColumn } from '../components/SummariesColumn'
import { WikiCardsColumn } from '../components/WikiCardsColumn'
import { NotesColumn } from '../components/NotesColumn'
import { useNotebook } from '@/lib/hooks/use-notebooks'
import { useNotebookSources } from '@/lib/hooks/use-sources'
import { useNotes } from '@/lib/hooks/use-notes'
import { useNotebookSummaries } from '@/lib/hooks/use-summaries'
import { useNotebookWikiCards } from '@/lib/hooks/use-wiki-cards'
import { useNotebookColumnsStore } from '@/lib/stores/notebook-columns-store'
import { useTranslation } from '@/lib/hooks/use-translation'
import { cn } from '@/lib/utils'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BookMarked, BookText, FileText, StickyNote } from 'lucide-react'

export type ContextMode = 'off' | 'insights' | 'full'
export type SourceArtifactState = 'missing' | 'ready' | 'pending' | 'failed' | 'stale'

export interface ContextSelections {
  sources: Record<string, ContextMode>
  notes: Record<string, ContextMode>
}

const STALE_THRESHOLD_MS = 30 * 1000

function parseTimestamp(value?: string | null) {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

function isStale(targetUpdated?: string | null, referenceUpdated?: string | null) {
  const target = parseTimestamp(targetUpdated)
  const reference = parseTimestamp(referenceUpdated)
  if (!target || !reference) return false
  return reference - target > STALE_THRESHOLD_MS
}

export default function NotebookPage() {
  const { t, language } = useTranslation()
  const params = useParams()

  const notebookId = params?.id ? decodeURIComponent(params.id as string) : ''

  const {
    data: notebook,
    isLoading: notebookLoading,
    isFetching: notebookFetching,
  } = useNotebook(notebookId)

  const isAcademicNotebook = notebook?.notebook_type === 'academic'

  const {
    sources,
    isLoading: sourcesLoading,
    isFetching: sourcesFetching,
    refetch: refetchSources,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useNotebookSources(notebookId, { enabled: isAcademicNotebook })
  const {
    data: notes,
    isLoading: notesLoading,
    isFetching: notesFetching,
  } = useNotes(notebookId)
  const {
    data: summaries,
    isLoading: summariesLoading,
    isFetching: summariesFetching,
  } = useNotebookSummaries(notebookId, { enabled: isAcademicNotebook })
  const {
    data: wikiCards,
    isLoading: wikiCardsLoading,
    isFetching: wikiCardsFetching,
  } = useNotebookWikiCards(notebookId, { enabled: isAcademicNotebook })

  const { sourcesCollapsed, summariesCollapsed, wikiCollapsed, notesCollapsed } = useNotebookColumnsStore()

  const [mobileActiveTab, setMobileActiveTab] = useState<'sources' | 'summaries' | 'wiki' | 'notes'>('sources')
  const [contextSelections, setContextSelections] = useState<ContextSelections>({
    sources: {},
    notes: {},
  })

  const expandedColumnClass = 'flex-1 basis-0 min-w-[18rem]'
  const noteList = useMemo(() => notes ?? [], [notes])
  const summaryList = useMemo(() => summaries ?? [], [summaries])
  const wikiCardSlots = useMemo(() => wikiCards ?? [], [wikiCards])

  useEffect(() => {
    if (!isAcademicNotebook || !sources || sources.length === 0) return

    setContextSelections((prev) => {
      let changed = false
      const newSourceSelections = { ...prev.sources }
      sources.forEach((source) => {
        const currentMode = newSourceSelections[source.id]
        const hasInsights = source.insights_count > 0

        if (currentMode === undefined) {
          newSourceSelections[source.id] = hasInsights ? 'insights' : 'full'
          changed = true
        } else if (currentMode === 'full' && hasInsights) {
          newSourceSelections[source.id] = 'insights'
          changed = true
        }
      })
      return changed ? { ...prev, sources: newSourceSelections } : prev
    })
  }, [isAcademicNotebook, sources])

  useEffect(() => {
    if (noteList.length === 0) return

    setContextSelections((prev) => {
      let changed = false
      const newNoteSelections = { ...prev.notes }
      noteList.forEach((note) => {
        if (!(note.id in newNoteSelections)) {
          newNoteSelections[note.id] = 'full'
          changed = true
        }
      })
      return changed ? { ...prev, notes: newNoteSelections } : prev
    })
  }, [noteList])

  const handleContextModeChange = (itemId: string, mode: ContextMode, type: 'source' | 'note') => {
    setContextSelections((prev) => ({
      ...prev,
      [type === 'source' ? 'sources' : 'notes']: {
        ...(type === 'source' ? prev.sources : prev.notes),
        [itemId]: mode,
      },
    }))
  }

  const summaryLookup = useMemo(() => new Map(summaryList.map((item) => [item.source_id, item])), [summaryList])
  const wikiLookup = useMemo(() => new Map(wikiCardSlots.map((item) => [item.source_id, item])), [wikiCardSlots])

  const sourceSummaryStates = useMemo<Record<string, SourceArtifactState>>(() => {
    if (!isAcademicNotebook) return {}

    const next: Record<string, SourceArtifactState> = {}
    for (const source of sources) {
      const summarySlot = summaryLookup.get(source.id)
      if (!summarySlot?.summary) {
        next[source.id] = 'missing'
        continue
      }
      next[source.id] = isStale(summarySlot.summary.updated, source.updated) ? 'stale' : 'ready'
    }
    return next
  }, [isAcademicNotebook, sources, summaryLookup])

  const sourceWikiStates = useMemo<Record<string, SourceArtifactState>>(() => {
    if (!isAcademicNotebook) return {}

    const next: Record<string, SourceArtifactState> = {}
    for (const source of sources) {
      const summarySlot = summaryLookup.get(source.id)
      const wikiSlot = wikiLookup.get(source.id)
      if (!wikiSlot || wikiSlot.status === 'missing') {
        next[source.id] = 'missing'
        continue
      }
      if (wikiSlot.status === 'pending') {
        next[source.id] = 'pending'
        continue
      }
      if (wikiSlot.status === 'failed') {
        next[source.id] = 'failed'
        continue
      }

      const wikiUpdated = wikiSlot.wiki_card?.updated ?? wikiSlot.source_updated
      const summaryUpdated = summarySlot?.summary?.updated
      const referenceUpdated = summaryUpdated && parseTimestamp(summaryUpdated)
        ? ((parseTimestamp(summaryUpdated) ?? 0) > (parseTimestamp(source.updated) ?? 0)
            ? summaryUpdated
            : source.updated)
        : source.updated

      next[source.id] = isStale(wikiUpdated, referenceUpdated) ? 'stale' : 'ready'
    }
    return next
  }, [isAcademicNotebook, sources, summaryLookup, wikiLookup])

  const overview = useMemo<NotebookOverview>(() => {
    if (!isAcademicNotebook) {
      return {
        sourceTotal: 0,
        sourceProcessing: 0,
        sourceFailed: 0,
        summaryReady: 0,
        summaryMissing: 0,
        summaryStale: 0,
        wikiReady: 0,
        wikiPending: 0,
        wikiFailed: 0,
        wikiMissing: 0,
        wikiStale: 0,
        noteTotal: noteList.length || notebook?.note_count || 0,
      }
    }

    const sourceProcessing = sources.filter((source) => ['new', 'queued', 'running'].includes(source.status ?? 'completed')).length
    const sourceFailed = sources.filter((source) => source.status === 'failed').length
    const summaryReady = summaryList.filter((item) => Boolean(item.summary)).length
    const summaryMissing = sources.filter((source) => sourceSummaryStates[source.id] === 'missing').length
    const summaryStale = sources.filter((source) => sourceSummaryStates[source.id] === 'stale').length
    const wikiReady = Object.values(sourceWikiStates).filter((state) => state === 'ready').length
    const wikiPending = Object.values(sourceWikiStates).filter((state) => state === 'pending').length
    const wikiFailed = Object.values(sourceWikiStates).filter((state) => state === 'failed').length
    const wikiMissing = Object.values(sourceWikiStates).filter((state) => state === 'missing').length
    const wikiStale = Object.values(sourceWikiStates).filter((state) => state === 'stale').length

    return {
      sourceTotal: notebook?.source_count ?? sources.length,
      sourceProcessing,
      sourceFailed,
      summaryReady,
      summaryMissing,
      summaryStale,
      wikiReady,
      wikiPending,
      wikiFailed,
      wikiMissing,
      wikiStale,
      noteTotal: noteList.length || notebook?.note_count || 0,
    }
  }, [
    isAcademicNotebook,
    noteList.length,
    notebook?.note_count,
    notebook?.source_count,
    sourceSummaryStates,
    sourceWikiStates,
    sources,
    summaryList,
  ])

  const hasNotebookData = Boolean(notebook || noteList.length || (isAcademicNotebook && (sources.length || summaryList.length || wikiCardSlots.length)))
  const isNotebookRefreshing = hasNotebookData && (
    notebookFetching || notesFetching || (isAcademicNotebook && (sourcesFetching || summariesFetching || wikiCardsFetching))
  )

  if (!notebook && !notebookLoading) {
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
          {notebook ? (
            <NotebookHeader
              notebook={notebook}
              overview={overview}
              isRefreshing={isNotebookRefreshing}
              wikiCardSlots={isAcademicNotebook ? wikiCardSlots : []}
            />
          ) : (
            <div className="border-b pb-6">
              <div className="space-y-3">
                <div className="h-9 w-72 animate-pulse rounded-md bg-muted" />
                <div className="h-5 w-[28rem] max-w-full animate-pulse rounded-md bg-muted/80" />
                <div className="h-4 w-56 animate-pulse rounded-md bg-muted/60" />
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 p-6 pt-6 overflow-x-auto flex flex-col">
          {isAcademicNotebook ? (
            <>
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
                      isRefreshing={sourcesFetching && !sourcesLoading}
                      notebookId={notebookId}
                      notebookName={notebook?.name}
                      onRefresh={refetchSources}
                      contextSelections={contextSelections.sources}
                      onContextModeChange={(sourceId, mode) => handleContextModeChange(sourceId, mode, 'source')}
                      hasNextPage={hasNextPage}
                      isFetchingNextPage={isFetchingNextPage}
                      fetchNextPage={fetchNextPage}
                      summaryStateBySourceId={sourceSummaryStates}
                      wikiStateBySourceId={sourceWikiStates}
                    />
                  )}
                  {mobileActiveTab === 'notes' && (
                    <NotesColumn
                      notes={noteList}
                      isLoading={notesLoading}
                      isRefreshing={notesFetching && !notesLoading}
                      notebookId={notebookId}
                      contextSelections={contextSelections.notes}
                      onContextModeChange={(noteId, mode) => handleContextModeChange(noteId, mode, 'note')}
                    />
                  )}
                  {mobileActiveTab === 'summaries' && (
                    <SummariesColumn
                      summaries={summaryList}
                      isLoading={summariesLoading}
                      isRefreshing={summariesFetching && !summariesLoading}
                      notebookId={notebookId}
                    />
                  )}
                  {mobileActiveTab === 'wiki' && (
                    <WikiCardsColumn
                      wikiCards={wikiCardSlots}
                      isLoading={wikiCardsLoading}
                      isRefreshing={wikiCardsFetching && !wikiCardsLoading}
                      notebookId={notebookId}
                    />
                  )}
                </div>
              </div>

              <div className={cn('hidden lg:flex h-full min-h-0 gap-5 transition-all duration-300 ease-out', 'flex-row')}>
                <div className={cn('transition-all duration-300 ease-out', sourcesCollapsed ? 'w-12 flex-shrink-0' : expandedColumnClass)}>
                  <SourcesColumn
                    sources={sources}
                    isLoading={sourcesLoading}
                    isRefreshing={sourcesFetching && !sourcesLoading}
                    notebookId={notebookId}
                    notebookName={notebook?.name}
                    onRefresh={refetchSources}
                    contextSelections={contextSelections.sources}
                    onContextModeChange={(sourceId, mode) => handleContextModeChange(sourceId, mode, 'source')}
                    hasNextPage={hasNextPage}
                    isFetchingNextPage={isFetchingNextPage}
                    fetchNextPage={fetchNextPage}
                    summaryStateBySourceId={sourceSummaryStates}
                    wikiStateBySourceId={sourceWikiStates}
                  />
                </div>

                <div className={cn('transition-all duration-300 ease-out', summariesCollapsed ? 'w-12 flex-shrink-0' : expandedColumnClass)}>
                  <SummariesColumn
                    summaries={summaryList}
                    isLoading={summariesLoading}
                    isRefreshing={summariesFetching && !summariesLoading}
                    notebookId={notebookId}
                  />
                </div>

                <div className={cn('transition-all duration-300 ease-out', wikiCollapsed ? 'w-12 flex-shrink-0' : expandedColumnClass)}>
                  <WikiCardsColumn
                    wikiCards={wikiCardSlots}
                    isLoading={wikiCardsLoading}
                    isRefreshing={wikiCardsFetching && !wikiCardsLoading}
                    notebookId={notebookId}
                  />
                </div>

                <div className={cn('transition-all duration-300 ease-out', notesCollapsed ? 'w-12 flex-shrink-0' : expandedColumnClass)}>
                  <NotesColumn
                    notes={noteList}
                    isLoading={notesLoading}
                    isRefreshing={notesFetching && !notesLoading}
                    notebookId={notebookId}
                    contextSelections={contextSelections.notes}
                    onContextModeChange={(noteId, mode) => handleContextModeChange(noteId, mode, 'note')}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 min-h-0">
              <NotesColumn
                notes={noteList}
                isLoading={notesLoading}
                isRefreshing={notesFetching && !notesLoading}
                notebookId={notebookId}
                contextSelections={contextSelections.notes}
                onContextModeChange={(noteId, mode) => handleContextModeChange(noteId, mode, 'note')}
              />
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}
