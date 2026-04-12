'use client'

import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import { SourceListResponse } from '@/lib/types/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Plus, FileText, Link2, ChevronDown, Loader2, Search, Trash2 } from 'lucide-react'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { EmptyState } from '@/components/common/EmptyState'
import { AddSourceDialog } from '@/components/sources/AddSourceDialog'
import { AddExistingSourceDialog } from '@/components/sources/AddExistingSourceDialog'
import { SourceCard } from '@/components/sources/SourceCard'
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
import { CollapsibleColumn, createCollapseButton } from '@/components/notebooks/CollapsibleColumn'
import { useNotebookColumnsStore } from '@/lib/stores/notebook-columns-store'
import { useTranslation } from '@/lib/hooks/use-translation'
import { toast } from 'sonner'
import type { DuplicateSourceGroupResponse } from '@/lib/types/api'

interface SourcesColumnProps {
  sources?: SourceListResponse[]
  isLoading: boolean
  notebookId: string
  notebookName?: string
  onRefresh?: () => void
  contextSelections?: Record<string, ContextMode>
  onContextModeChange?: (sourceId: string, mode: ContextMode) => void
  // Pagination props
  hasNextPage?: boolean
  isFetchingNextPage?: boolean
  fetchNextPage?: () => void
}

export function SourcesColumn({
  sources,
  isLoading,
  notebookId,
  onRefresh,
  contextSelections,
  onContextModeChange,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: SourcesColumnProps) {
  const { t } = useTranslation()
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

  // Collapsible column state
  const { sourcesCollapsed, toggleSources } = useNotebookColumnsStore()
  const collapseButton = useMemo(
    () => createCollapseButton(toggleSources, t.navigation.sources),
    [toggleSources, t.navigation.sources]
  )

  // Scroll container ref for infinite scroll
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Handle scroll for infinite loading
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container || !hasNextPage || isFetchingNextPage || !fetchNextPage) return

    const { scrollTop, scrollHeight, clientHeight } = container
    // Load more when user scrolls within 200px of the bottom
    if (scrollHeight - scrollTop - clientHeight < 200) {
      fetchNextPage()
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  // Attach scroll listener
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
      // Error toast is handled by the hook
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
      // Error toast handled by hook.
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
      // Error toast handled by hook.
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
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-lg">{t.navigation.sources}</CardTitle>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleScanDuplicates}
                  disabled={isLoading || !sources?.length || scanDuplicates.isPending}
                >
                  {scanDuplicates.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4 mr-2" />
                  )}
                  Scan Duplicates
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCleanupDialogOpen(true)}
                  disabled={!duplicateGroups.length || cleanupDuplicates.isPending}
                >
                  {cleanupDuplicates.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4 mr-2" />
                  )}
                  Clean Duplicates
                </Button>
                <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm">
                      <Plus className="h-4 w-4 mr-2" />
                      {t.sources.addSource}
                      <ChevronDown className="h-4 w-4 ml-2" />
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
                {collapseButton}
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
              <div className="flex items-center justify-center py-8">
                <LoadingSpinner />
              </div>
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
                  />
                ))}
                {/* Loading indicator for infinite scroll */}
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
