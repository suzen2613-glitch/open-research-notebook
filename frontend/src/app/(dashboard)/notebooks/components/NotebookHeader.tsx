'use client'

import { useMemo, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Archive, ArchiveRestore, GitBranch, Loader2, StickyNote, Trash2 } from 'lucide-react'

import { NotebookResponse } from '@/lib/types/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useUpdateNotebook } from '@/lib/hooks/use-notebooks'
import { NotebookDeleteDialog } from './NotebookDeleteDialog'
import { getDateLocale } from '@/lib/utils/date-locale'
import { InlineEdit } from '@/components/common/InlineEdit'
import { useTranslation } from '@/lib/hooks/use-translation'
import { cn } from '@/lib/utils'
import { getNotebookThemeClasses, getNotebookTypeLabel } from '@/lib/notebook-appearance'
import { KnowledgeGraphDialog } from './KnowledgeGraphDialog'
import type { SourceWikiCardSlotResponse } from '@/lib/api/wiki-cards'

export interface NotebookOverview {
  sourceTotal: number
  sourceProcessing: number
  sourceFailed: number
  summaryReady: number
  summaryMissing: number
  summaryStale: number
  wikiReady: number
  wikiPending: number
  wikiFailed: number
  wikiMissing: number
  wikiStale: number
  noteTotal: number
}

interface NotebookHeaderProps {
  notebook: NotebookResponse
  overview?: NotebookOverview
  isRefreshing?: boolean
  wikiCardSlots?: SourceWikiCardSlotResponse[]
}

export function NotebookHeader({
  notebook,
  overview,
  isRefreshing = false,
  wikiCardSlots = [],
}: NotebookHeaderProps) {
  const { t, language } = useTranslation()
  const dfLocale = getDateLocale(language)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showGraphDialog, setShowGraphDialog] = useState(false)

  const updateNotebook = useUpdateNotebook()
  const isZh = language?.startsWith('zh')
  const isAcademic = notebook.notebook_type === 'academic'
  const theme = getNotebookThemeClasses(notebook.theme_color)
  const completedWikiCardCount = useMemo(
    () => wikiCardSlots.filter((slot) => slot.status === 'completed' && slot.wiki_card).length,
    [wikiCardSlots]
  )

  const labels = useMemo(() => ({
    sources: isZh ? '来源' : 'Sources',
    summary: isZh ? '总结' : 'Summary',
    wiki: 'Wiki',
    notes: isZh ? '笔记' : 'Notes',
    syncing: isZh ? '后台同步中' : 'Background sync',
    processing: isZh ? '处理中' : 'Processing',
    failed: isZh ? '失败' : 'Failed',
    summaryMissing: isZh ? '待补总结' : 'Summaries missing',
    summaryStale: isZh ? '总结待刷新' : 'Summaries stale',
    wikiPending: isZh ? 'Wiki 生成中' : 'Wiki pending',
    wikiFailed: isZh ? 'Wiki 失败' : 'Wiki failed',
    wikiMissing: isZh ? '待建 Wiki' : 'Wiki missing',
    wikiStale: isZh ? 'Wiki 待刷新' : 'Wiki stale',
    graph: isZh ? '关系图' : 'Knowledge Graph',
  }), [isZh])

  const handleUpdateName = async (name: string) => {
    if (!name || name === notebook.name) return

    await updateNotebook.mutateAsync({
      id: notebook.id,
      data: { name }
    })
  }

  const handleUpdateDescription = async (description: string) => {
    if (description === notebook.description) return

    await updateNotebook.mutateAsync({
      id: notebook.id,
      data: { description: description || undefined }
    })
  }

  const handleArchiveToggle = () => {
    updateNotebook.mutate({
      id: notebook.id,
      data: { archived: !notebook.archived }
    })
  }

  return (
    <>
      <div className={cn('relative overflow-hidden rounded-2xl border p-5', theme.card)}>
        <div className={cn('absolute inset-y-0 left-0 w-1.5', theme.accent)} />
        <div className="space-y-4 pl-2">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
              <InlineEdit
                id="notebook-name"
                name="notebook-name"
                value={notebook.name}
                onSave={handleUpdateName}
                className="text-2xl font-bold"
                inputClassName="text-2xl font-bold"
                placeholder={t.notebooks.namePlaceholder}
              />
              <Badge variant="secondary" className={cn('border', theme.badge)}>
                {getNotebookTypeLabel(notebook.notebook_type, language)}
              </Badge>
              {notebook.archived && <Badge variant="secondary">{t.notebooks.archived}</Badge>}
              {isRefreshing && (
                <Badge variant="outline" className="gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {labels.syncing}
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {isAcademic && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowGraphDialog(true)}
                  className="gap-2"
                >
                  <GitBranch className="h-4 w-4" />
                  {labels.graph}
                  {completedWikiCardCount > 0 && (
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] leading-none text-muted-foreground">
                      {completedWikiCardCount}
                    </span>
                  )}
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={handleArchiveToggle}>
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
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowDeleteDialog(true)}
                className="text-red-600 hover:text-red-700"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {t.common.delete}
              </Button>
            </div>
          </div>

          <InlineEdit
            id="notebook-description"
            name="notebook-description"
            value={notebook.description || ''}
            onSave={handleUpdateDescription}
            className="text-muted-foreground"
            inputClassName="text-muted-foreground"
            placeholder={t.notebooks.addDescription}
            multiline
            emptyText={t.notebooks.addDescription}
          />

          {overview && (
            <div className="flex flex-wrap items-center gap-2">
              {isAcademic ? (
                <>
                  <Badge variant="secondary">{labels.sources} {overview.sourceTotal}</Badge>
                  <Badge variant="secondary">{labels.summary} {overview.summaryReady}/{overview.sourceTotal}</Badge>
                  <Badge variant="secondary">{labels.wiki} {overview.wikiReady}/{overview.sourceTotal}</Badge>
                  <Badge variant="secondary">{labels.notes} {overview.noteTotal}</Badge>
                </>
              ) : (
                <Badge variant="secondary" className="gap-1.5">
                  <StickyNote className="h-3.5 w-3.5" />
                  {labels.notes} {overview.noteTotal}
                </Badge>
              )}

              {isAcademic && overview.sourceProcessing > 0 && (
                <Badge variant="outline">{overview.sourceProcessing} {labels.processing}</Badge>
              )}
              {isAcademic && overview.sourceFailed > 0 && (
                <Badge variant="destructive">{overview.sourceFailed} {labels.failed}</Badge>
              )}
              {isAcademic && overview.summaryMissing > 0 && (
                <Badge variant="outline">{overview.summaryMissing} {labels.summaryMissing}</Badge>
              )}
              {isAcademic && overview.summaryStale > 0 && (
                <Badge variant="outline" className="border-amber-300 text-amber-700">
                  {overview.summaryStale} {labels.summaryStale}
                </Badge>
              )}
              {isAcademic && overview.wikiPending > 0 && (
                <Badge variant="outline">{overview.wikiPending} {labels.wikiPending}</Badge>
              )}
              {isAcademic && overview.wikiFailed > 0 && (
                <Badge variant="destructive">{overview.wikiFailed} {labels.wikiFailed}</Badge>
              )}
              {isAcademic && overview.wikiMissing > 0 && (
                <Badge variant="outline">{overview.wikiMissing} {labels.wikiMissing}</Badge>
              )}
              {isAcademic && overview.wikiStale > 0 && (
                <Badge variant="outline" className="border-amber-300 text-amber-700">
                  {overview.wikiStale} {labels.wikiStale}
                </Badge>
              )}
            </div>
          )}

          <div className="text-sm text-muted-foreground">
            {t.common.created.replace('{time}', formatDistanceToNow(new Date(notebook.created), { addSuffix: true, locale: dfLocale }))} •
            {t.common.updated.replace('{time}', formatDistanceToNow(new Date(notebook.updated), { addSuffix: true, locale: dfLocale }))}
          </div>
        </div>
      </div>

      <KnowledgeGraphDialog
        open={showGraphDialog}
        onOpenChange={setShowGraphDialog}
        notebookName={notebook.name}
        wikiCardSlots={wikiCardSlots}
      />

      <NotebookDeleteDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        notebookId={notebook.id}
        notebookName={notebook.name}
        redirectAfterDelete
      />
    </>
  )
}
