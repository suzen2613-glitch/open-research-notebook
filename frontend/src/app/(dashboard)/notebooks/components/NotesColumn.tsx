'use client'

import { useState, useMemo } from 'react'
import { NoteResponse } from '@/lib/types/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Plus, StickyNote, Bot, User, MoreVertical, Trash2, Inbox, PenTool, CheckCircle2 } from 'lucide-react'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { EmptyState } from '@/components/common/EmptyState'
import { Badge } from '@/components/ui/badge'
import { NoteEditorDialog } from './NoteEditorDialog'
import { getDateLocale } from '@/lib/utils/date-locale'
import { formatDistanceToNow } from 'date-fns'
import { ContextToggle } from '@/components/common/ContextToggle'
import { ContextMode } from '../[id]/page'
import { useDeleteNote, useUpdateNote } from '@/lib/hooks/use-notes'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { CollapsibleColumn, createCollapseButton } from '@/components/notebooks/CollapsibleColumn'
import { useNotebookColumnsStore } from '@/lib/stores/notebook-columns-store'
import { useTranslation } from '@/lib/hooks/use-translation'

interface NotesColumnProps {
  notes?: NoteResponse[]
  isLoading: boolean
  notebookId: string
  contextSelections?: Record<string, ContextMode>
  onContextModeChange?: (noteId: string, mode: ContextMode) => void
}

export function NotesColumn({
  notes,
  isLoading,
  notebookId,
  contextSelections,
  onContextModeChange
}: NotesColumnProps) {
  const { t, language } = useTranslation()
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [editingNote, setEditingNote] = useState<NoteResponse | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [noteToDelete, setNoteToDelete] = useState<string | null>(null)

  const deleteNote = useDeleteNote()
  const updateNote = useUpdateNote()

  // Collapsible column state
  const { notesCollapsed, toggleNotes } = useNotebookColumnsStore()
  const collapseButton = useMemo(
    () => createCollapseButton(toggleNotes, t.common.notes),
    [toggleNotes, t.common.notes]
  )

  const handleDeleteClick = (noteId: string) => {
    setNoteToDelete(noteId)
    setDeleteDialogOpen(true)
  }

  const handleDeleteConfirm = async () => {
    if (!noteToDelete) return

    try {
      await deleteNote.mutateAsync(noteToDelete)
      setDeleteDialogOpen(false)
      setNoteToDelete(null)
    } catch (error) {
      console.error('Failed to delete note:', error)
    }
  }

  const moveNote = async (noteId: string, boardColumn: 'inbox' | 'working' | 'final') => {
    try {
      await updateNote.mutateAsync({
        id: noteId,
        data: { board_column: boardColumn },
      })
    } catch (error) {
      console.error('Failed to move note:', error)
    }
  }

  const noteColumns = useMemo(() => {
    const grouped = {
      inbox: [] as NoteResponse[],
      working: [] as NoteResponse[],
      final: [] as NoteResponse[],
    }
    for (const note of notes ?? []) {
      grouped[note.board_column ?? 'inbox'].push(note)
    }
    return grouped
  }, [notes])

  const boardSections = useMemo(() => ([
    {
      key: 'inbox' as const,
      title: t.notebooks.boardInbox,
      description: t.notebooks.boardInboxDesc,
      icon: Inbox,
      notes: noteColumns.inbox,
    },
    {
      key: 'working' as const,
      title: t.notebooks.boardWorking,
      description: t.notebooks.boardWorkingDesc,
      icon: PenTool,
      notes: noteColumns.working,
    },
    {
      key: 'final' as const,
      title: t.notebooks.boardFinal,
      description: t.notebooks.boardFinalDesc,
      icon: CheckCircle2,
      notes: noteColumns.final,
    },
  ]), [noteColumns, t])

  return (
    <>
      <CollapsibleColumn
        isCollapsed={notesCollapsed}
        onToggle={toggleNotes}
        collapsedIcon={StickyNote}
        collapsedLabel={t.common.notes}
      >
        <Card className="h-full flex flex-col flex-1 overflow-hidden">
          <CardHeader className="pb-3 flex-shrink-0">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-lg">{t.common.notes}</CardTitle>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    setEditingNote(null)
                    setShowAddDialog(true)
                  }}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  {t.common.writeNote}
                </Button>
                {collapseButton}
              </div>
            </div>
          </CardHeader>

          <CardContent className="flex-1 overflow-y-auto min-h-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <LoadingSpinner />
              </div>
            ) : !notes || notes.length === 0 ? (
              <EmptyState
                icon={StickyNote}
                title={t.notebooks.noNotesYet}
                description={t.sources.createFirstNote}
              />
            ) : (
              <div className="space-y-4">
                {boardSections.map((section) => {
                  const SectionIcon = section.icon

                  return (
                    <div key={section.key} className="rounded-lg border bg-muted/20 p-3">
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <SectionIcon className="h-4 w-4" />
                            <h3 className="text-sm font-semibold">{section.title}</h3>
                            <Badge variant="secondary">{section.notes.length}</Badge>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">{section.description}</p>
                        </div>
                      </div>

                      {section.notes.length === 0 ? (
                        <div className="rounded-md border border-dashed bg-background/70 p-4 text-xs text-muted-foreground">
                          {t.notebooks.boardEmpty}
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {section.notes.map((note) => (
                            <div
                              key={note.id}
                              className="rounded-lg border bg-background p-3 card-hover group relative cursor-pointer"
                              onClick={() => setEditingNote(note)}
                            >
                              <div className="mb-2 flex items-start justify-between">
                                <div className="flex flex-wrap items-center gap-2">
                                  {note.note_type === 'ai' ? (
                                    <Bot className="h-4 w-4 text-primary" />
                                  ) : (
                                    <User className="h-4 w-4 text-muted-foreground" />
                                  )}
                                  <Badge variant="secondary" className="text-xs">
                                    {note.note_type === 'ai' ? t.common.aiGenerated : t.common.human}
                                  </Badge>
                                  {note.source_id ? (
                                    <Badge variant="outline" className="text-xs">
                                      {t.sources.linkedSourceShort}
                                    </Badge>
                                  ) : null}
                                  {note.source_insight_id ? (
                                    <Badge variant="outline" className="text-xs">
                                      {t.sources.linkedInsightShort}
                                    </Badge>
                                  ) : null}
                                </div>

                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-muted-foreground">
                                    {formatDistanceToNow(new Date(note.updated), {
                                      addSuffix: true,
                                      locale: getDateLocale(language)
                                    })}
                                  </span>

                                  {onContextModeChange && contextSelections?.[note.id] && (
                                    <div onClick={(event) => event.stopPropagation()}>
                                      <ContextToggle
                                        mode={contextSelections[note.id]}
                                        hasInsights={false}
                                        onChange={(mode) => onContextModeChange(note.id, mode)}
                                      />
                                    </div>
                                  )}

                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <MoreVertical className="h-4 w-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="w-52">
                                      {section.key !== 'inbox' ? (
                                        <DropdownMenuItem
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            void moveNote(note.id, 'inbox')
                                          }}
                                        >
                                          {t.notebooks.moveToInbox}
                                        </DropdownMenuItem>
                                      ) : null}
                                      {section.key !== 'working' ? (
                                        <DropdownMenuItem
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            void moveNote(note.id, 'working')
                                          }}
                                        >
                                          {t.notebooks.moveToWorking}
                                        </DropdownMenuItem>
                                      ) : null}
                                      {section.key !== 'final' ? (
                                        <DropdownMenuItem
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            void moveNote(note.id, 'final')
                                          }}
                                        >
                                          {t.notebooks.moveToFinal}
                                        </DropdownMenuItem>
                                      ) : null}
                                      <DropdownMenuItem
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          handleDeleteClick(note.id)
                                        }}
                                        className="text-red-600 focus:text-red-600"
                                      >
                                        <Trash2 className="h-4 w-4 mr-2" />
                                        {t.notebooks.deleteNote}
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                              </div>

                              {note.title && (
                                <h4 className="mb-2 break-all text-sm font-medium">{note.title}</h4>
                              )}

                              {note.content && (
                                <p className="line-clamp-3 break-all text-sm text-muted-foreground">
                                  {note.content}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </CollapsibleColumn>

      <NoteEditorDialog
        open={showAddDialog || Boolean(editingNote)}
        onOpenChange={(open) => {
          if (!open) {
            setShowAddDialog(false)
            setEditingNote(null)
          } else {
            setShowAddDialog(true)
          }
        }}
        notebookId={notebookId}
        note={editingNote ?? undefined}
      />

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={t.notebooks.deleteNote}
        description={t.notebooks.deleteNoteConfirm}
        confirmText={t.common.delete}
        onConfirm={handleDeleteConfirm}
        isLoading={deleteNote.isPending}
        confirmVariant="destructive"
      />
    </>
  )
}
