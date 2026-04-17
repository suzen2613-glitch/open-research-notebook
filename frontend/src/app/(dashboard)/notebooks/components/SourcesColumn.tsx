'use client'

import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import { SourceListResponse } from '@/lib/types/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Plus, FileText, Link2, ChevronDown, Loader2, Search, Trash2 } from 'lucide-react'
import { EmptyState } from '@/components/common/EmptyState'
import { AddSourceDialog } from '@/components/sources/AddSourceDialog'
import { AddExistingSourceDialog } from '@/components/sources/AddExistingSourceDialog'
import { SourceCard, type SourceArtifactState } from '@/components/sources/SourceCard'
import {
  useCleanupNotebookDuplicateSources,
  useDeleteSource,
  useRemoveSourceFromNotebook,
  useRetrySource,
  useScanNotebookDuplicateSources,
} from '@/lib/hooks/use-sources'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { useModalManager } from '@/lib/hooks/use-modal-manager'
import { ContextMode } from '../[id]/page'
import {
  CollapsibleColumn,
  createCollapseButton,
  NotebookListColumnSkeleton,
} from '@/components/notebooks/CollapsibleColumn'
import { useNotebookColumnsStore } from '@/lib/stores/notebook-columns-store'
import { useTranslation } from '@/lib/hooks/use-translation'
import { toast } from 'sonner'
import type { DuplicateSourceGroupResponse } from '@/lib/types/api'

interface SourcesColumnProps {
  sources?: SourceListResponse[]
  isLoading: boolean
  isRefreshing?: boolean
  notebookId: string
  notebookName?: string
  onRefresh?: () => void
  contextSelections?: Record<string, ContextMode>
  onContextModeChange?: (sourceId: string, mode: ContextMode) => void
  hasNextPage?: boolean
  isFetchingNextPage?: boolean
  fetchNextPage?: () => void
  summaryStateBySourceId?: Record<string, SourceArtifactState>
  wikiStateBySourceId?: Record<string, SourceArtifactState>
}

export function SourcesColumn({
  sources,
  isLoading,
  isRefreshing = false,
  notebookId,
  onRefresh,
  contextSelections,
  onContextModeChange,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  summaryStateBySourceId,
  wikiStateBySourceId,
}: SourcesColumnProps) {
  const { t, language } = useTranslation()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [addExistingDialogOpen, setAddExistingDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [sourceToDelete, setSourceToDelete] = useState<string | null>(null)
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false)
  const [sourceToRemove, setSourceToRemove] = useState<string | null>(null)
  const [cleanupDialogOpen, setCleanupDialogOpen] = useState(false)
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateSourceGroupResponse[]>([])

  const { openModal } = useModalManager()
  const deleteSource = useDeleteSource()
  const retrySource = useRetrySource()
  const removeFromNotebook = useRemoveSourceFromNotebook()
  const scanDuplicates = useScanNotebookDuplicateSources()
  const cleanupDuplicates = useCleanupNotebookDuplicateSources()

  const { sourcesCollapsed, toggleSources } = useNotebookColumnsStore()
  const collapseButton = useMemo(
    () => createCollapseButton(toggleSources, t.navigation.sources),
    [toggleSources, t.navigation.sources]
  )

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const isZh = language?.startsWith('zh')

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container || !hasNextPage || isFetchingNextPage || !fetchNextPage) return

    const { scrollTop, scrollHeight, clientHeight } = container
    if (scrollHeight - scrollTop - clientHeight < 200) {
      fetchNextPage()
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [handleScroll])

  const handleDeleteClick = (sourceId: string) => {
    setSourceToDelete(sourceId)
    setDeleteDialogOpen(true)
  }

  const handleDeleteConfirm = async () => {
    if (!sourceToDelete) return

    try {
      await deleteSource.mutateAsync(sourceToDelete)
      setDeleteDialogOpen(false)
      setSourceToDelete(null)
      onRefresh?.()
    } catch (error) {
      console.error('Failed to delete source:', error)
    }
  }

  const handleRemoveFromNotebook = (sourceId: string) => {
    setSourceToRemove(sourceId)
    setRemoveDialogOpen(true)
  }

  const handleRemoveConfirm = async () => {
    if (!sourceToRemove) return

    try {
      await removeFromNotebook.mutateAsync({
        notebookId,
        sourceId: sourceToRemove
      })
      setRemoveDialogOpen(false)
      setSourceToRemove(null)
    } catch (error) {
      console.error('Failed to remove source from notebook:', error)
    }
  }

  const handleRetry = async (sourceId: string) => {
    try {
      await retrySource.mutateAsync(sourceId)
    } catch (error) {
      console.error('Failed to retry source:', error)
    }
  }

  const handleSourceClick = (sourceId: string) => {
    openModal('source', sourceId)
  }

  const duplicateStats = useMemo(() => {
    const groupCount = duplicateGroups.length
    const duplicateCount = duplicateGroups.reduce((total, group) => total + group.duplicate_count, 0)
    return { groupCount, duplicateCount }
  }, [duplicateGroups])

  const duplicateSummary = useMemo(() => {
    if (!duplicateGroups.length) {
      return 'No duplicate sources found in this notebook.'
    }

    const preview = duplicateGroups
      .slice(0, 4)
      .map((group) => {
        const keepTitle = group.keep_title || group.normalized_title
        return `Keep "${keepTitle}" and remove ${group.duplicate_count} duplicate source${group.duplicate_count === 1 ? '' : 's'}`
      })
      .join('; ')

    const extraGroups =
      duplicateGroups.length > 4 ? `; plus ${duplicateGroups.length - 4} more duplicate group${duplicateGroups.length - 4 === 1 ? '' : 's'}` : ''

    return `Found ${duplicateStats.duplicateCount} duplicate source${duplicateStats.duplicateCount === 1 ? '' : 's'} in ${duplicateStats.groupCount} group${duplicateStats.groupCount === 1 ? '' : 's'}. ${preview}${extraGroups}.`
  }, [duplicateGroups, duplicateStats])

  const handleScanDuplicates = async () => {
    try {
      const result = await scanDuplicates.mutateAsync(notebookId)
      setDuplicateGroups(result)
      if (result.length === 0) {
        toast.success('No duplicate sources found.')
        return
      }
      setCleanupDialogOpen(true)
    } catch {
    }
  }

  const handleCleanupDuplicates = async () => {
    try {
      const result = await cleanupDuplicates.mutateAsync(notebookId)
      setCleanupDialogOpen(false)
      setDuplicateGroups([])
      onRefresh?.()
      if (result.removed_count === 0 && result.unlinked_count === 0) {
        toast.success('No duplicate sources needed cleanup.')
      }
    } catch {
    }
  }

  return (
    <>
      <CollapsibleColumn
        isCollapsed={sourcesCollapsed}
        onToggle={toggleSources}
        collapsedIcon={FileText}
        collapsedLabel={t.navigation.sources}
      >
        <Card className="h-full flex flex-col flex-1 overflow-hidden">
          <CardHeader className="pb-3 flex-shrink-0">
            <div className="flex flex-col gap-3">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <CardTitle className="min-w-0 truncate text-lg">{t.navigation.sources}</CardTitle>
                  {isRefreshing && !isLoading && (
                    <Badge variant="outline" className="text-xs shrink-0">
                      {isZh ? '同步中' : 'Syncing'}
                    </Badge>
                  )}
                </div>
                <div className="shrink-0">{collapseButton}</div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleScanDuplicates}
                  disabled={isLoading || !sources?.length || scanDuplicates.isPending}
                  className="max-w-full"
                >
                  {scanDuplicates.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin shrink-0" />
                  ) : (
                    <Search className="h-4 w-4 mr-2 shrink-0" />
                  )}
                  <span className="truncate">Scan Duplicates</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCleanupDialogOpen(true)}
                  disabled={!duplicateGroups.length || cleanupDuplicates.isPending}
                  className="max-w-full"
                >
                  {cleanupDuplicates.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin shrink-0" />
                  ) : (
                    <Trash2 className="h-4 w-4 mr-2 shrink-0" />
                  )}
                  <span className="truncate">Clean Duplicates</span>
                </Button>
                <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" className="max-w-full">
                      <Plus className="h-4 w-4 mr-2 shrink-0" />
                      <span className="truncate">{t.sources.addSource}</span>
                      <ChevronDown className="h-4 w-4 ml-2 shrink-0" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => { setDropdownOpen(false); setAddDialogOpen(true); }}>
                      <Plus className="h-4 w-4 mr-2" />
                      {t.sources.addSource}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { setDropdownOpen(false); setAddExistingDialogOpen(true); }}>
                      <Link2 className="h-4 w-4 mr-2" />
                      {t.sources.addExistingTitle}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </CardHeader>

          <CardContent ref={scrollContainerRef} className="flex-1 overflow-y-auto min-h-0">
            {duplicateGroups.length > 0 && (
              <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Found {duplicateStats.duplicateCount} duplicate source{duplicateStats.duplicateCount === 1 ? '' : 's'} in {duplicateStats.groupCount} group{duplicateStats.groupCount === 1 ? '' : 's'}.
              </div>
            )}
            {isLoading ? (
              <NotebookListColumnSkeleton itemCount={4} />
            ) : !sources || sources.length === 0 ? (
              <EmptyState
                icon={FileText}
                title={t.sources.noSourcesYet}
                description={t.sources.createFirstSource}
              />
            ) : (
              <div className="space-y-3">
                {sources.map((source) => (
                  <SourceCard
                    key={source.id}
                    source={source}
                    onClick={handleSourceClick}
                    onDelete={handleDeleteClick}
                    onRetry={handleRetry}
                    onRemoveFromNotebook={handleRemoveFromNotebook}
                    onRefresh={onRefresh}
                    showRemoveFromNotebook={true}
                    contextMode={contextSelections?.[source.id]}
                    onContextModeChange={onContextModeChange
                      ? (mode) => onContextModeChange(source.id, mode)
                      : undefined
                    }
                    summaryState={summaryStateBySourceId?.[source.id] ?? 'missing'}
                    wikiState={wikiStateBySourceId?.[source.id] ?? 'missing'}
                  />
                ))}
                {isFetchingNextPage && (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </CollapsibleColumn>

      <AddSourceDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        defaultNotebookId={notebookId}
      />

      <AddExistingSourceDialog
        open={addExistingDialogOpen}
        onOpenChange={setAddExistingDialogOpen}
        notebookId={notebookId}
        onSuccess={onRefresh}
      />

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={t.sources.delete}
        description={t.sources.deleteConfirm}
        confirmText={t.common.delete}
        onConfirm={handleDeleteConfirm}
        isLoading={deleteSource.isPending}
        confirmVariant="destructive"
      />

      <ConfirmDialog
        open={removeDialogOpen}
        onOpenChange={setRemoveDialogOpen}
        title={t.sources.removeFromNotebook}
        description={t.sources.removeConfirm}
        confirmText={t.common.remove}
        onConfirm={handleRemoveConfirm}
        isLoading={removeFromNotebook.isPending}
        confirmVariant="default"
      />

      <ConfirmDialog
        open={cleanupDialogOpen}
        onOpenChange={setCleanupDialogOpen}
        title="Clean duplicate sources?"
        description={duplicateSummary}
        confirmText="Clean Duplicates"
        onConfirm={handleCleanupDuplicates}
        isLoading={cleanupDuplicates.isPending}
        confirmVariant="destructive"
      />
    </>
  )
}
