'use client'

import { Loader2 } from 'lucide-react'

import { sourcesApi } from '@/lib/api/sources'
import { notesApi } from '@/lib/api/notes'
import type { NoteResponse, SourceListResponse } from '@/lib/types/api'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { useTranslation } from '@/lib/hooks/use-translation'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'

import { formatNumber, getSourceDefaultMode } from './podcast-helpers'
import type { ContentSelectionPanelProps } from './podcast-types'

export function ContentSelectionPanel({
  notebooks,
  isLoading,
  selectedNotebookSummaries,
  tokenCount,
  charCount,
  expandedNotebooks,
  setExpandedNotebooks,
  selections,
  sourcesByNotebook,
  notesByNotebook,
  fetchingNotebookIds,
  handleNotebookToggle,
  handleSourceModeChange,
  handleNoteToggle,
  queryClient,
}: ContentSelectionPanelProps) {
  const { t, language } = useTranslation()

  // Cache all translation strings at render time to avoid repeated Proxy accesses in loops
  // This prevents the infinite loop detection from triggering
  const tr = {
    content: t.podcasts.content,
    contentDesc: t.podcasts.contentDesc,
    itemsSelected: t.podcasts.itemsSelected,
    tokens: t.podcasts.tokens,
    chars: t.podcasts.chars,
    loadingNotebooks: t.podcasts.loadingNotebooks,
    noNotebooksFoundInPodcasts: t.podcasts.noNotebooksFoundInPodcasts,
    sources: t.podcasts.sources,
    notes: t.podcasts.notes,
    noContentSelected: t.podcasts.noContentSelected,
    noSources: t.podcasts.noSources,
    untitledSource: t.podcasts.untitledSource,
    link: t.podcasts.link,
    file: t.podcasts.file,
    embedded: t.podcasts.embedded,
    notEmbedded: t.podcasts.notEmbedded,
    selectMode: t.podcasts.selectMode,
    noNotes: t.podcasts.noNotes,
    untitledNote: t.podcasts.untitledNote,
    commonUpdated: t.common.updated,
    summary: t.podcasts.summary,
    fullContent: t.podcasts.fullContent,
  }

  // Pre-compute source modes once to avoid repeated t.podcasts access in loops
  const sourceModes = [
    { value: 'insights', label: tr.summary },
    { value: 'full', label: tr.fullContent },
  ] as const

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {tr.content}
          </h3>
          <p className="text-xs text-muted-foreground">
            {tr.contentDesc}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">
            {tr.itemsSelected.replace(
              '{count}',
              selectedNotebookSummaries.reduce(
                (acc: number, summary) => acc + summary.sources + summary.notes,
                0
              ).toString()
            )}
          </Badge>
          {(tokenCount > 0 || charCount > 0) && (
            <span className="text-xs text-muted-foreground">
              {tokenCount > 0 && tr.tokens.replace('{count}', formatNumber(tokenCount))}
              {tokenCount > 0 && charCount > 0 && ' / '}
              {charCount > 0 && tr.chars.replace('{count}', formatNumber(charCount))}
            </span>
          )}
        </div>
      </div>

      <div className="rounded-lg border bg-muted/30">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {tr.loadingNotebooks}
          </div>
        ) : notebooks.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">
            {tr.noNotebooksFoundInPodcasts}
          </div>
        ) : (
          <ScrollArea className="h-[60vh]">
            <Accordion
              type="multiple"
              value={expandedNotebooks}
              onValueChange={(value) => setExpandedNotebooks(value as string[])}
              className="w-full"
            >
              {notebooks.map((notebook, index) => {
                const sources = sourcesByNotebook[notebook.id] ?? []
                const notes = notesByNotebook[notebook.id] ?? []
                const selection = selections[notebook.id]
                const summary = selectedNotebookSummaries[index]
                const notebookChecked = summary.sources + summary.notes > 0
                const totalItems = sources.length + notes.length
                const isIndeterminate =
                  notebookChecked &&
                  summary.sources + summary.notes > 0 &&
                  summary.sources + summary.notes < totalItems

                return (
                  <AccordionItem key={notebook.id} value={notebook.id}>
                    <div className="flex items-start gap-3 px-4 pt-3">
                      <Checkbox
                        id={`notebook-toggle-${notebook.id}`}
                        checked={isIndeterminate ? 'indeterminate' : notebookChecked}
                        onCheckedChange={(checked) => {
                          handleNotebookToggle(notebook.id, checked)
                          queryClient.prefetchQuery({
                            queryKey: QUERY_KEYS.sources(notebook.id),
                            queryFn: () => sourcesApi.list({ notebook_id: notebook.id }),
                          })
                          queryClient.prefetchQuery({
                            queryKey: QUERY_KEYS.notes(notebook.id),
                            queryFn: () => notesApi.list({ notebook_id: notebook.id }),
                          })
                        }}
                        onClick={(event) => event.stopPropagation()}
                      />
                      <AccordionTrigger className="flex-1 px-0 py-0 hover:no-underline">
                        <Label
                          htmlFor={`notebook-toggle-${notebook.id}`}
                          className="flex w-full items-center justify-between gap-3 pointer-events-none"
                        >
                          <div className="text-left">
                            <p className="font-medium text-sm text-foreground">
                              {notebook.name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {summary.sources + summary.notes > 0
                                ? `${summary.sources} ${tr.sources}, ${summary.notes} ${tr.notes}`
                                : tr.noContentSelected}
                            </p>
                          </div>
                          <Badge variant="outline" className="text-xs">
                            {sources.length} {tr.sources} · {notes.length} {tr.notes}
                          </Badge>
                        </Label>
                      </AccordionTrigger>
                    </div>
                    <AccordionContent>
                      <div className="space-y-4 px-4 pb-4">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              {tr.sources}
                            </h4>
                            {fetchingNotebookIds.has(notebook.id) && (
                              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                            )}
                          </div>
                          {sources.length === 0 ? (
                            <p className="text-xs text-muted-foreground">
                              {tr.noSources}
                            </p>
                          ) : (
                            <div className="space-y-2">
                              {sources.map((source: SourceListResponse) => {
                                const mode = selection?.sources?.[source.id] ?? 'off'
                                return (
                                  <div
                                    key={source.id}
                                    className="flex items-center gap-3 rounded border bg-background px-3 py-2"
                                  >
                                    <Checkbox
                                      id={`source-selection-${source.id}`}
                                      checked={mode !== 'off'}
                                      onCheckedChange={(checked) =>
                                        handleSourceModeChange(
                                          notebook.id,
                                          source.id,
                                          checked ? getSourceDefaultMode(source) : 'off'
                                        )
                                      }
                                    />
                                    <Label
                                      htmlFor={`source-selection-${source.id}`}
                                      className="flex flex-1 flex-col gap-1 cursor-pointer"
                                    >
                                      <span className="text-sm font-medium text-foreground">
                                        {source.title || tr.untitledSource}
                                      </span>
                                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <span>{source.asset?.url ? tr.link : tr.file}</span>
                                        <span>•</span>
                                        <span>{source.embedded ? tr.embedded : tr.notEmbedded}</span>
                                      </div>
                                    </Label>
                                    <Select
                                      value={mode === 'off' ? 'off' : mode}
                                      onValueChange={(value) =>
                                        handleSourceModeChange(
                                          notebook.id,
                                          source.id,
                                          value as import('./podcast-types').SourceMode
                                        )
                                      }
                                      disabled={mode === 'off'}
                                    >
                                      <SelectTrigger className="w-[140px]">
                                        <SelectValue placeholder={tr.selectMode} />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {sourceModes.map((option) => (
                                          <SelectItem
                                            key={option.value}
                                            value={option.value}
                                            disabled={
                                              option.value === 'insights' &&
                                              (!source.insights_count || source.insights_count === 0)
                                            }
                                          >
                                            {option.label}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>

                        <Separator />

                        <div className="space-y-2">
                          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {tr.notes}
                          </h4>
                          {notes.length === 0 ? (
                            <p className="text-xs text-muted-foreground">
                              {tr.noNotes}
                            </p>
                          ) : (
                            <div className="space-y-2">
                              {notes.map((note: NoteResponse) => {
                                const mode = selection?.notes?.[note.id] ?? 'off'
                                return (
                                  <div
                                    key={note.id}
                                    className="flex items-center gap-3 rounded border bg-background px-3 py-2"
                                  >
                                    <Checkbox
                                      id={`note-selection-${note.id}`}
                                      checked={mode !== 'off'}
                                      onCheckedChange={(checked) =>
                                        handleNoteToggle(
                                          notebook.id,
                                          note.id,
                                          Boolean(checked)
                                        )
                                      }
                                    />
                                    <Label
                                      htmlFor={`note-selection-${note.id}`}
                                      className="flex flex-1 flex-col cursor-pointer"
                                    >
                                      <span className="text-sm font-medium text-foreground">
                                        {note.title || tr.untitledNote}
                                      </span>
                                      <span className="text-xs text-muted-foreground">
                                        {tr.commonUpdated}{' '}
                                        {new Date(note.updated).toLocaleString(
                                          language.startsWith('zh') ? language : 'en-US'
                                        )}
                                      </span>
                                    </Label>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                )
              })}
            </Accordion>
          </ScrollArea>
        )}
      </div>
    </div>
  )
}
