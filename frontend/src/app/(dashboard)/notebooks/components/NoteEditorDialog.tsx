'use client'

import { Controller, useForm, useWatch } from 'react-hook-form'
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useCreateNote, useUpdateNote, useNote } from '@/lib/hooks/use-notes'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { MarkdownEditor } from '@/components/ui/markdown-editor'
import { InlineEdit } from '@/components/common/InlineEdit'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from "@/lib/utils";
import { useTranslation } from '@/lib/hooks/use-translation'

const createNoteSchema = z.object({
  title: z.string().optional(),
  content: z.string().min(1, 'Content is required'),
  board_column: z.enum(['inbox', 'working', 'final']),
})

type CreateNoteFormData = z.infer<typeof createNoteSchema>

interface NoteEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  notebookId: string
  note?: {
    id: string
    title: string | null
    content: string | null
    board_column?: 'inbox' | 'working' | 'final'
    source_id?: string | null
    source_insight_id?: string | null
  }
}

export function NoteEditorDialog({ open, onOpenChange, notebookId, note }: NoteEditorDialogProps) {
  const { t } = useTranslation()
  const createNote = useCreateNote()
  const updateNote = useUpdateNote()
  const queryClient = useQueryClient()
  const isEditing = Boolean(note)

  // Ensure note ID has 'note:' prefix for API calls
  const noteIdWithPrefix = note?.id
    ? (note.id.includes(':') ? note.id : `note:${note.id}`)
    : ''

  const { data: fetchedNote, isLoading: noteLoading } = useNote(noteIdWithPrefix, { enabled: open && !!note?.id })
  const isSaving = isEditing ? updateNote.isPending : createNote.isPending
  const {
    handleSubmit,
    control,
    formState: { errors },
    reset,
    setValue,
  } = useForm<CreateNoteFormData>({
    resolver: zodResolver(createNoteSchema),
    defaultValues: {
      title: '',
      content: '',
      board_column: 'inbox',
    },
  })
  const watchTitle = useWatch({ control, name: 'title' })
  const [isEditorFullscreen, setIsEditorFullscreen] = useState(false)

  useEffect(() => {
    if (!open) {
      reset({ title: '', content: '', board_column: 'inbox' })
      return
    }

    const source = fetchedNote ?? note
    const title = source?.title ?? ''
    const content = source?.content ?? ''
    const boardColumn = source?.board_column ?? 'inbox'

    reset({ title, content, board_column: boardColumn })
  }, [open, note, fetchedNote, reset])

  useEffect(() => {
    if (!open) return

    const observer = new MutationObserver(() => {
      setIsEditorFullscreen(!!document.querySelector('.w-md-editor-fullscreen'))
    })
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [open])

  const onSubmit = async (data: CreateNoteFormData) => {
    if (note) {
      await updateNote.mutateAsync({
        id: noteIdWithPrefix,
        data: {
          title: data.title || undefined,
          content: data.content,
          board_column: data.board_column,
        },
      })
      // Only invalidate notebook-specific queries if we have a notebookId
      if (notebookId) {
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.notes(notebookId) })
      }
    } else {
      // Creating a note requires a notebookId
      if (!notebookId) {
        console.error('Cannot create note without notebook_id')
        return
      }
      await createNote.mutateAsync({
        title: data.title || undefined,
        content: data.content,
        note_type: 'human',
        board_column: data.board_column,
        notebook_id: notebookId,
      })
    }
    reset()
    onOpenChange(false)
  }

  const handleClose = () => {
    reset()
    setIsEditorFullscreen(false)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className={cn(
          "sm:max-w-3xl w-full max-h-[90vh] overflow-hidden p-0",
          isEditorFullscreen && "!max-w-screen !max-h-screen border-none w-screen h-screen"
      )}>
        <DialogTitle className="sr-only">
          {isEditing ? t.sources.editNote : t.sources.createNote}
        </DialogTitle>
        <form onSubmit={handleSubmit(onSubmit)} className="flex h-full flex-col min-w-0">
          {isEditing && noteLoading ? (
            <div className="flex-1 flex items-center justify-center py-10">
              <span className="text-sm text-muted-foreground">{t.common.loading}</span>
            </div>
          ) : (
            <>
              <div className="border-b px-6 py-4">
                <InlineEdit
                  id="note-title"
                  name="title"
                  value={watchTitle ?? ''}
                  onSave={(value) => setValue('title', value || '')}
                  placeholder={t.sources.addTitle}
                  emptyText={t.sources.untitledNote}
                  className="text-xl font-semibold"
                  inputClassName="text-xl font-semibold"
                />
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <div className="min-w-[180px]">
                    <Controller
                      control={control}
                      name="board_column"
                      render={({ field }) => (
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="inbox">{t.notebooks.boardInbox}</SelectItem>
                            <SelectItem value="working">{t.notebooks.boardWorking}</SelectItem>
                            <SelectItem value="final">{t.notebooks.boardFinal}</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </div>

                  {(fetchedNote?.source_id ?? note?.source_id) ? (
                    <Badge variant="outline">
                      {t.sources.linkedSourceLabel.replace('{id}', (fetchedNote?.source_id ?? note?.source_id ?? '').replace(/^source:/, ''))}
                    </Badge>
                  ) : null}
                  {(fetchedNote?.source_insight_id ?? note?.source_insight_id) ? (
                    <Badge variant="outline">
                      {t.sources.linkedInsightLabel.replace('{id}', (fetchedNote?.source_insight_id ?? note?.source_insight_id ?? '').replace(/^source_insight:/, ''))}
                    </Badge>
                  ) : null}
                </div>
              </div>

              <div className={cn(
                  "flex-1 overflow-y-auto",
                  !isEditorFullscreen && "px-6 py-4")
              }>
                <Controller
                  control={control}
                  name="content"
                  render={({ field }) => (
                    <MarkdownEditor
                      key={note?.id ?? 'new'}
                      textareaId="note-content"
                      value={field.value}
                      onChange={field.onChange}
                      height={420}
                      placeholder={t.sources.writeNotePlaceholder}
                      className={cn(
                          "w-full h-full min-h-[420px] max-h-[500px] overflow-hidden [&_.w-md-editor]:!static [&_.w-md-editor]:!w-full [&_.w-md-editor]:!h-full [&_.w-md-editor-content]:overflow-y-auto",
                          !isEditorFullscreen && "rounded-md border"
                      )}
                    />
                  )}
                />
                {errors.content && (
                  <p className="text-sm text-red-600 mt-1">{errors.content.message}</p>
                )}
              </div>
            </>
          )}

          <div className="border-t px-6 py-4 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={handleClose}>
              {t.common.cancel}
            </Button>
            <Button
              type="submit"
              disabled={isSaving || (isEditing && noteLoading)}
            >
              {isSaving
                ? isEditing ? `${t.common.saving}...` : `${t.common.creating}...`
                : isEditing
                  ? t.sources.saveNote
                  : t.sources.createNoteBtn}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
