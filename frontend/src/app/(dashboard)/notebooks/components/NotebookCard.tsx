'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Archive, ArchiveRestore, BookCopy, FileText, MoreHorizontal, StickyNote, Trash2 } from 'lucide-react'

import { NotebookResponse } from '@/lib/types/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useUpdateNotebook } from '@/lib/hooks/use-notebooks'
import { NotebookDeleteDialog } from './NotebookDeleteDialog'
import { useTranslation } from '@/lib/hooks/use-translation'
import { getDateLocale } from '@/lib/utils/date-locale'
import { cn } from '@/lib/utils'
import { getNotebookThemeClasses, getNotebookTypeLabel } from '@/lib/notebook-appearance'

interface NotebookCardProps {
  notebook: NotebookResponse
}

export function NotebookCard({ notebook }: NotebookCardProps) {
  const { t, language } = useTranslation()
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const router = useRouter()
  const updateNotebook = useUpdateNotebook()
  const theme = getNotebookThemeClasses(notebook.theme_color)
  const isAcademic = notebook.notebook_type === 'academic'

  const handleArchiveToggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    updateNotebook.mutate({
      id: notebook.id,
      data: { archived: !notebook.archived }
    })
  }

  const handleCardClick = () => {
    router.push(`/notebooks/${encodeURIComponent(notebook.id)}`)
  }

  return (
    <>
      <Card
        className={cn('group relative overflow-hidden card-hover', theme.card)}
        onClick={handleCardClick}
        style={{ cursor: 'pointer' }}
      >
        <div className={cn('absolute inset-x-0 top-0 h-1.5', theme.accent)} />
        <CardHeader className="pb-3 pt-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="truncate text-base transition-colors group-hover:text-primary">
                  {notebook.name}
                </CardTitle>
                <Badge variant="secondary" className={cn('border', theme.badge)}>
                  {getNotebookTypeLabel(notebook.notebook_type, language)}
                </Badge>
                {notebook.archived && <Badge variant="secondary">{t.notebooks.archived}</Badge>}
              </div>
              <p className="line-clamp-2 text-sm text-muted-foreground">
                {notebook.description || t.chat.noDescription}
              </p>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem onClick={handleArchiveToggle}>
                  {notebook.archived ? (
                    <>
                      <ArchiveRestore className="mr-2 h-4 w-4" />
                      {t.notebooks.unarchive}
                    </>
                  ) : (
                    <>
                      <Archive className="mr-2 h-4 w-4" />
                      {t.notebooks.archive}
                    </>
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowDeleteDialog(true)
                  }}
                  className="text-red-600"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t.common.delete}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardHeader>

        <CardContent>
          <div className="text-xs text-muted-foreground">
            {t.common.updated.replace('{time}', formatDistanceToNow(new Date(notebook.updated), {
              addSuffix: true,
              locale: getDateLocale(language)
            }))}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t pt-3">
            {isAcademic && (
              <Badge variant="outline" className={cn('flex items-center gap-1 px-1.5 py-0.5 text-xs', theme.badge)}>
                <FileText className="h-3 w-3" />
                <span>{notebook.source_count}</span>
              </Badge>
            )}
            <Badge variant="outline" className={cn('flex items-center gap-1 px-1.5 py-0.5 text-xs', theme.badge)}>
              {isAcademic ? <StickyNote className="h-3 w-3" /> : <BookCopy className="h-3 w-3" />}
              <span>{notebook.note_count}</span>
            </Badge>
          </div>
        </CardContent>
      </Card>

      <NotebookDeleteDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        notebookId={notebook.id}
        notebookName={notebook.name}
      />
    </>
  )
}
