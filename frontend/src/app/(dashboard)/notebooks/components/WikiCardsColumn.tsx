'use client'

import { useCallback, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { BookMarked, Eye, FileText, Loader2, RefreshCw, Sparkles } from 'lucide-react'
import { toast } from 'sonner'

import { EmptyState } from '@/components/common/EmptyState'
import {
  CollapsibleColumn,
  createCollapseButton,
  NotebookListColumnSkeleton,
} from '@/components/notebooks/CollapsibleColumn'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { insightsApi } from '@/lib/api/insights'
import { QUERY_KEYS } from '@/lib/api/query-client'
import {
  type SourceWikiCardResponse,
  type SourceWikiCardSlotResponse,
  type WikiCardStatus,
  wikiCardsApi,
} from '@/lib/api/wiki-cards'
import { useModelResolver, useBatchProgressReset, useFormattedDates } from '@/lib/hooks/use-model-resolver'
import { useModalManager } from '@/lib/hooks/use-modal-manager'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useNotebookColumnsStore } from '@/lib/stores/notebook-columns-store'
import { WikiCardDialog } from './WikiCardDialog'
import { getBatchProgressTitle, getStatusLabel, getBadgeVariant } from '@/components/notebooks/wiki-card-helpers'

interface WikiCardsColumnProps {
  wikiCards?: SourceWikiCardSlotResponse[]
  isLoading: boolean
  isRefreshing?: boolean
  notebookId: string
}

type WikiCardBatchProgressState = {
  mode: 'generate_missing' | 'refresh_existing'
  total: number
  completed: number
  failed: number
  pendingSourceIds: Set<string>
}

type FilterValue = 'all' | WikiCardStatus

export function WikiCardsColumn({
  wikiCards,
  isLoading,
  isRefreshing = false,
  notebookId,
}: WikiCardsColumnProps) {
  const { t, language } = useTranslation()
  const { openModal } = useModalManager()
  const queryClient = useQueryClient()
  const { wikiCollapsed, toggleWiki } = useNotebookColumnsStore()
  const { resolveModelId, getErrorMessage, validateModel } = useModelResolver()
  const { parseValidDate, formatRelativeDate } = useFormattedDates()

  const wikiLabel = t.wikiCards.wikiCard
  const openExportLabel = t.wikiCards.openExport
  const retryLabel = t.wikiCards.retryWikiCard
  const refreshReadyLabel = t.wikiCards.ready
  const refreshExistingLabel = t.wikiCards.refreshExisting
  const createMissingLabel = t.wikiCards.createMissing
  const collapseButton = useMemo(
    () => createCollapseButton(toggleWiki, wikiLabel),
    [toggleWiki, wikiLabel]
  )

  const [selectedWikiCard, setSelectedWikiCard] = useState<SourceWikiCardResponse | null>(null)
  const [statusFilter, setStatusFilter] = useState<FilterValue>('all')
  const [generatingSourceIds, setGeneratingSourceIds] = useState<Set<string>>(() => new Set())
  const [refreshingWikiCardIds, setRefreshingWikiCardIds] = useState<Set<string>>(() => new Set())
  const [isBatchGenerating, setIsBatchGenerating] = useState(false)
  const [batchProgress, setBatchProgress] = useState<WikiCardBatchProgressState | null>(null)

  const { batchProcessedCount, batchProgressPercent, isBatchProgressComplete } =
    useBatchProgressReset(batchProgress, setBatchProgress)

  const missingWikiCardSourceIds = useMemo(
    () => (wikiCards ?? []).filter((item) => item.status === 'missing').map((item) => item.source_id),
    [wikiCards]
  )

  const refreshableWikiCards = useMemo(
    () =>
      (wikiCards ?? []).filter(
        (item): item is SourceWikiCardSlotResponse & { wiki_card: SourceWikiCardResponse } =>
          item.status !== 'missing' && item.status !== 'pending' && Boolean(item.wiki_card?.id)
      ),
    [wikiCards]
  )

  const filteredWikiCards = useMemo(() => {
    if (!wikiCards) return []
    if (statusFilter === 'all') return wikiCards
    return wikiCards.filter((item) => item.status === statusFilter)
  }, [statusFilter, wikiCards])

  const missingWikiCardCount = missingWikiCardSourceIds.length
  const refreshableWikiCardCount = refreshableWikiCards.length
  const pendingWikiCardCount = useMemo(
    () => (wikiCards ?? []).filter((item) => item.status === 'pending').length,
    [wikiCards]
  )
  const failedWikiCardCount = useMemo(
    () => (wikiCards ?? []).filter((item) => item.status === 'failed').length,
    [wikiCards]
  )
  const completedWikiCardCount = useMemo(
    () => (wikiCards ?? []).filter((item) => item.status === 'completed').length,
    [wikiCards]
  )
  const batchPendingCount = batchProgress?.pendingSourceIds.size ?? 0

  const invalidateWikiCardData = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: QUERY_KEYS.wikiCards(notebookId),
      refetchType: 'active',
    })
    void queryClient.invalidateQueries({
      queryKey: QUERY_KEYS.sourcesInfinite(notebookId),
      refetchType: 'active',
    })
    void queryClient.invalidateQueries({
      queryKey: QUERY_KEYS.sources(notebookId),
      refetchType: 'active',
    })
    void queryClient.invalidateQueries({
      queryKey: ['wiki-cards', 'source'],
      refetchType: 'inactive',
    })
  }, [notebookId, queryClient])

  const markSourceGenerating = useCallback((sourceId: string) => {
    setGeneratingSourceIds((previous) => {
      const next = new Set(previous)
      next.add(sourceId)
      return next
    })
  }, [])

  const clearSourceGenerating = useCallback((sourceId: string) => {
    setGeneratingSourceIds((previous) => {
      if (!previous.has(sourceId)) return previous
      const next = new Set(previous)
      next.delete(sourceId)
      return next
    })
  }, [])

  const markWikiCardRefreshing = useCallback((wikiCardId: string) => {
    setRefreshingWikiCardIds((previous) => {
      const next = new Set(previous)
      next.add(wikiCardId)
      return next
    })
  }, [])

  const clearWikiCardRefreshing = useCallback((wikiCardId: string) => {
    setRefreshingWikiCardIds((previous) => {
      if (!previous.has(wikiCardId)) return previous
      const next = new Set(previous)
      next.delete(wikiCardId)
      return next
    })
  }, [])

  const updateBatchProgress = useCallback((sourceId: string, status: 'completed' | 'failed') => {
    setBatchProgress((previous) => {
      if (!previous || !previous.pendingSourceIds.has(sourceId)) return previous
      const nextPendingSourceIds = new Set(previous.pendingSourceIds)
      nextPendingSourceIds.delete(sourceId)
      return {
        ...previous,
        completed: previous.completed + (status === 'completed' ? 1 : 0),
        failed: previous.failed + (status === 'failed' ? 1 : 0),
        pendingSourceIds: nextPendingSourceIds,
      }
    })
  }, [])

  const getSourceWikiCardStatus = useCallback(async (sourceId: string) => {
    try {
      const slot = await wikiCardsApi.getForSource(sourceId)
      return slot.status
    } catch {
      return null
    }
  }, [])

  const trackWikiCardCommand = useCallback(async ({
    commandId,
    sourceId,
    wikiCardId,
  }: {
    commandId?: string
    sourceId?: string
    wikiCardId?: string
  }) => {
    const resolveSourceStatus = async () => {
      if (!sourceId) return null
      const sourceStatus = await getSourceWikiCardStatus(sourceId)
      if (sourceStatus === 'completed' || sourceStatus === 'failed') {
        updateBatchProgress(sourceId, sourceStatus)
        invalidateWikiCardData()
        window.setTimeout(invalidateWikiCardData, 1500)
        return sourceStatus
      }
      return null
    }

    try {
      if (!commandId) {
        const resolvedStatus = await resolveSourceStatus()
        if (!resolvedStatus) {
          invalidateWikiCardData()
          window.setTimeout(invalidateWikiCardData, 1500)
        }
        return
      }

      const maxAttempts = 120
      const intervalMs = 2000

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        try {
          const status = await insightsApi.getCommandStatus(commandId)
          if (status.status === 'completed') {
            const resolvedStatus = await resolveSourceStatus()
            if (!resolvedStatus) {
              if (sourceId) updateBatchProgress(sourceId, 'completed')
              invalidateWikiCardData()
              window.setTimeout(invalidateWikiCardData, 1500)
            }
            return
          }

          if (status.status === 'failed' || status.status === 'canceled') {
            const resolvedStatus = await resolveSourceStatus()
            if (resolvedStatus) return
            if (sourceId) updateBatchProgress(sourceId, 'failed')
            toast.error(status.error_message || t.common.error)
            return
          }

          if (attempt % 5 === 4) {
            const resolvedStatus = await resolveSourceStatus()
            if (resolvedStatus) return
          }
        } catch (error) {
          console.error('Error checking wiki card command status:', error)
          const resolvedStatus = await resolveSourceStatus()
          if (resolvedStatus) return
        }

        await new Promise(resolve => setTimeout(resolve, intervalMs))
      }

      const resolvedStatus = await resolveSourceStatus()
      if (resolvedStatus) return

      if (sourceId) updateBatchProgress(sourceId, 'failed')
      toast.error('Wiki card generation timed out while waiting for background processing.')
    } finally {
      if (sourceId) clearSourceGenerating(sourceId)
      if (wikiCardId) clearWikiCardRefreshing(wikiCardId)
    }
  }, [
    clearSourceGenerating,
    clearWikiCardRefreshing,
    getSourceWikiCardStatus,
    invalidateWikiCardData,
    t.common.error,
    updateBatchProgress,
  ])

  const queueWikiCardGeneration = useCallback(async (
    sourceId: string,
    modelId: string,
    options?: { showToast?: boolean }
  ) => {
    markSourceGenerating(sourceId)
    try {
      const response = await wikiCardsApi.create(sourceId, modelId)
      if (options?.showToast ?? true) {
        toast.success(`${wikiLabel} generation started`)
      }
      void trackWikiCardCommand({ commandId: response.command_id, sourceId, wikiCardId: response.wiki_card_id })
      return true
    } catch (error) {
      clearSourceGenerating(sourceId)
      throw error
    }
  }, [clearSourceGenerating, markSourceGenerating, trackWikiCardCommand, wikiLabel])

  const handleGenerateWikiCard = useCallback(async (sourceId: string) => {
    if (generatingSourceIds.has(sourceId)) return
    const modelId = resolveModelId()
    if (!modelId) return
    try {
      const isModelValid = await validateModel(modelId)
      if (!isModelValid) return
      await queueWikiCardGeneration(sourceId, modelId)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }, [generatingSourceIds, getErrorMessage, queueWikiCardGeneration, resolveModelId, validateModel])

  const handleGenerateMissingWikiCards = useCallback(async () => {
    const sourceIds = missingWikiCardSourceIds.filter((sourceId) => !generatingSourceIds.has(sourceId))
    if (sourceIds.length === 0) return
    const modelId = resolveModelId()
    if (!modelId) return
    try {
      setIsBatchGenerating(true)
      setBatchProgress({
        mode: 'generate_missing',
        total: sourceIds.length,
        completed: 0,
        failed: 0,
        pendingSourceIds: new Set(sourceIds),
      })
      const isModelValid = await validateModel(modelId)
      if (!isModelValid) {
        setBatchProgress(null)
        return
      }
      const results = await Promise.allSettled(
        sourceIds.map((sourceId) => queueWikiCardGeneration(sourceId, modelId, { showToast: false }))
      )
      const queuedCount = results.filter(
        (result): result is PromiseFulfilledResult<boolean> => result.status === 'fulfilled' && result.value
      ).length
      if (queuedCount > 0) toast.success(`${wikiLabel} generation started`)
      const firstRejectedResult = results.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected'
      )
      if (firstRejectedResult) {
        results.forEach((result, index) => {
          if (result.status === 'rejected') {
            const sourceId = sourceIds[index]
            if (sourceId) updateBatchProgress(sourceId, 'failed')
          }
        })
        toast.error(getErrorMessage(firstRejectedResult.reason))
      }
    } finally {
      setIsBatchGenerating(false)
    }
  }, [generatingSourceIds, getErrorMessage, missingWikiCardSourceIds, queueWikiCardGeneration, resolveModelId, updateBatchProgress, validateModel, wikiLabel])

  const handleRefreshWikiCard = useCallback(async (wikiCardId: string) => {
    if (refreshingWikiCardIds.has(wikiCardId)) return
    const modelId = resolveModelId()
    if (!modelId) return
    try {
      const isModelValid = await validateModel(modelId)
      if (!isModelValid) return
      markWikiCardRefreshing(wikiCardId)
      const response = await wikiCardsApi.refresh(wikiCardId, modelId)
      toast.success(`${wikiLabel} refresh started`)
      void trackWikiCardCommand({ commandId: response.command_id, wikiCardId, sourceId: response.source_id })
    } catch (error) {
      clearWikiCardRefreshing(wikiCardId)
      toast.error(getErrorMessage(error))
    }
  }, [clearWikiCardRefreshing, getErrorMessage, markWikiCardRefreshing, refreshingWikiCardIds, resolveModelId, trackWikiCardCommand, validateModel, wikiLabel])

  const handleRefreshAllWikiCards = useCallback(async () => {
    const items = refreshableWikiCards.filter(
      (item) => item.wiki_card?.id && !refreshingWikiCardIds.has(item.wiki_card.id)
    )
    if (items.length === 0) return
    const modelId = resolveModelId()
    if (!modelId) return
    try {
      setIsBatchGenerating(true)
      setBatchProgress({
        mode: 'refresh_existing',
        total: items.length,
        completed: 0,
        failed: 0,
        pendingSourceIds: new Set(items.map((item) => item.source_id)),
      })
      const isModelValid = await validateModel(modelId)
      if (!isModelValid) {
        setBatchProgress(null)
        return
      }
      const results = await Promise.allSettled(
        items.map(async (item) => {
          const wikiCardId = item.wiki_card.id
          markWikiCardRefreshing(wikiCardId)
          const response = await wikiCardsApi.refresh(wikiCardId, modelId)
          void trackWikiCardCommand({
            commandId: response.command_id,
            wikiCardId,
            sourceId: response.source_id,
          })
          return true
        })
      )
      const queuedCount = results.filter(
        (result): result is PromiseFulfilledResult<boolean> => result.status === 'fulfilled' && result.value
      ).length
      if (queuedCount > 0) toast.success(`${wikiLabel} refresh started`)
      const firstRejectedResult = results.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected'
      )
      if (firstRejectedResult) {
        results.forEach((result, index) => {
          if (result.status === 'rejected') {
            const item = items[index]
            if (item?.wiki_card?.id) clearWikiCardRefreshing(item.wiki_card.id)
            if (item?.source_id) updateBatchProgress(item.source_id, 'failed')
          }
        })
        toast.error(getErrorMessage(firstRejectedResult.reason))
      }
    } finally {
      setIsBatchGenerating(false)
    }
  }, [clearWikiCardRefreshing, getErrorMessage, markWikiCardRefreshing, refreshableWikiCards, refreshingWikiCardIds, resolveModelId, trackWikiCardCommand, updateBatchProgress, validateModel, wikiLabel])

  const previewContent = useCallback((item: SourceWikiCardSlotResponse) => {
    const content = item.wiki_card?.summary_text || item.wiki_card?.obsidian_markdown || ''
    if (!content) return ''
    return content
      .replace(/^---[\s\S]*?---/, '')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
      .trim()
  }, [])

  return (
    <>
      <CollapsibleColumn
        isCollapsed={wikiCollapsed}
        onToggle={toggleWiki}
        collapsedIcon={BookMarked}
        collapsedLabel={wikiLabel}
      >
        <Card className="h-full flex flex-col flex-1 overflow-hidden">
          <CardHeader className="pb-3 flex-shrink-0">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CardTitle className="text-lg">{wikiLabel}</CardTitle>
                {isRefreshing && !isLoading && (
                  <Badge variant="outline" className="text-xs">
                    {language.startsWith('zh') ? '同步中' : 'Syncing'}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                {refreshableWikiCardCount > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleRefreshAllWikiCards()}
                    disabled={isBatchGenerating || Boolean(batchProgress)}
                  >
                    {isBatchGenerating ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-4 w-4" />
                    )}
                    {refreshExistingLabel}
                  </Button>
                )}
                {missingWikiCardCount > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleGenerateMissingWikiCards()}
                    disabled={isBatchGenerating || Boolean(batchProgress)}
                  >
                    {isBatchGenerating ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="mr-2 h-4 w-4" />
                    )}
                    {createMissingLabel}
                  </Button>
                )}
                {collapseButton}
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as FilterValue)}>
                <SelectTrigger size="sm" className="min-w-[9rem]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{getStatusLabel('all', t)}</SelectItem>
                  <SelectItem value="missing">{getStatusLabel('missing', t)}</SelectItem>
                  <SelectItem value="pending">{getStatusLabel('pending', t)}</SelectItem>
                  <SelectItem value="completed">{getStatusLabel('completed', t)}</SelectItem>
                  <SelectItem value="failed">{getStatusLabel('failed', t)}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {filteredWikiCards.length} / {wikiCards?.length ?? 0}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline">{`${refreshReadyLabel}: ${refreshableWikiCardCount}`}</Badge>
              <Badge variant="outline">{`${getStatusLabel('completed', t)}: ${completedWikiCardCount}`}</Badge>
              <Badge variant="outline">{`${getStatusLabel('pending', t)}: ${pendingWikiCardCount}`}</Badge>
              <Badge variant={failedWikiCardCount > 0 ? 'destructive' : 'outline'}>
                {`${getStatusLabel('failed', t)}: ${failedWikiCardCount}`}
              </Badge>
              <Badge variant="outline">{`${getStatusLabel('missing', t)}: ${missingWikiCardCount}`}</Badge>
            </div>
            {batchProgress && (
              <div className="rounded-md border bg-muted/30 p-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium">
                    {getBatchProgressTitle(batchProgress.mode, t, isBatchProgressComplete)}
                  </span>
                  <span className="text-muted-foreground">
                    {batchProcessedCount} / {batchProgress.total}
                  </span>
                </div>
                <Progress value={batchProgressPercent} className="mt-2 h-2" />
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{t.common.progress}: {batchProgressPercent}%</span>
                  <span>{language.startsWith('zh') ? '本次总数' : 'Batch total'}: {batchProgress.total}</span>
                  <span>{batchProgress.completed} {t.common.completed}</span>
                  {batchProgress.failed > 0 && (
                    <span>{batchProgress.failed} {t.common.failed}</span>
                  )}
                  {batchPendingCount > 0 && (
                    <span>{batchPendingCount} {t.common.processing}</span>
                  )}
                </div>
              </div>
            )}
          </CardHeader>

          <CardContent className="flex-1 overflow-y-auto min-h-0">
            {isLoading ? (
              <NotebookListColumnSkeleton itemCount={3} />
            ) : !wikiCards || wikiCards.length === 0 ? (
              <EmptyState
                icon={BookMarked}
                title={wikiLabel}
                description={t.sources.createFirstSource}
              />
            ) : filteredWikiCards.length === 0 ? (
              <EmptyState
                icon={BookMarked}
                title={wikiLabel}
                description={language.startsWith('zh') ? '当前筛选条件下没有卡片。' : 'No cards match the current filter.'}
              />
            ) : (
              <div className="space-y-3">
                {filteredWikiCards.map((item) => {
                  const wikiCard = item.wiki_card
                  const isGenerating = generatingSourceIds.has(item.source_id)
                  const isRefreshingCard = wikiCard?.id ? refreshingWikiCardIds.has(wikiCard.id) : false
                  const canOpen = item.status === 'completed' && Boolean(wikiCard)
                  const preview = previewContent(item)

                  return (
                    <div
                      key={item.source_id}
                      className="rounded-lg border bg-background p-3 transition-colors hover:bg-accent/30"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div
                          className={canOpen ? 'min-w-0 flex-1 cursor-pointer' : 'min-w-0 flex-1'}
                          onClick={() => {
                            if (canOpen && wikiCard) setSelectedWikiCard(wikiCard)
                          }}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-semibold break-words">
                              {item.source_title || t.sources.untitledSource}
                            </h3>
                            <Badge variant={getBadgeVariant(item.status)}>
                              {getStatusLabel(item.status, t)}
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t.common.updated.replace(
                              '{time}',
                              formatRelativeDate(wikiCard?.updated || item.source_updated)
                            )}
                          </p>
                          {item.status === 'completed' && preview ? (
                            <p className="mt-3 line-clamp-6 whitespace-pre-wrap text-sm text-muted-foreground">
                              {preview}
                            </p>
                          ) : item.status === 'failed' ? (
                            <p className="mt-3 text-sm text-destructive">
                              {wikiCard?.error_message || (language.startsWith('zh') ? '生成失败。' : 'Generation failed.')}
                            </p>
                          ) : item.status === 'pending' ? (
                            <p className="mt-3 text-sm text-muted-foreground">
                              {language.startsWith('zh') ? 'Wiki 卡片生成中。' : 'Wiki card generation is in progress.'}
                            </p>
                          ) : null}
                        </div>
                      </div>

                      {wikiCard?.concept_names && wikiCard.concept_names.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {wikiCard.concept_names.slice(0, 4).map((concept) => (
                            <Badge key={concept} variant="outline">
                              {concept}
                            </Badge>
                          ))}
                        </div>
                      )}

                      <div className="mt-4 flex flex-wrap gap-2">
                        {item.status === 'completed' && wikiCard?.id ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(event) => {
                                event.stopPropagation()
                                void handleRefreshWikiCard(wikiCard.id)
                              }}
                              disabled={isRefreshingCard || isGenerating}
                            >
                              {isRefreshingCard ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : (
                                <RefreshCw className="mr-2 h-4 w-4" />
                              )}
                              {isRefreshingCard ? t.common.processing : t.common.refresh}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(event) => {
                                event.stopPropagation()
                                setSelectedWikiCard(wikiCard)
                              }}
                            >
                              <Eye className="mr-2 h-4 w-4" />
                              {openExportLabel}
                            </Button>
                          </>
                        ) : item.status === 'pending' ? (
                          <Button size="sm" disabled>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            {t.common.processing}
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            onClick={(event) => {
                              event.stopPropagation()
                              void handleGenerateWikiCard(item.source_id)
                            }}
                            disabled={isGenerating}
                          >
                            {isGenerating ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Sparkles className="mr-2 h-4 w-4" />
                            )}
                            {isGenerating
                              ? t.common.processing
                              : item.status === 'failed'
                                ? retryLabel
                                : `${t.common.create} ${wikiLabel}`}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(event) => {
                            event.stopPropagation()
                            openModal('source', item.source_id)
                          }}
                        >
                          <FileText className="mr-2 h-4 w-4" />
                          {t.sources.viewSource}
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </CollapsibleColumn>

      <WikiCardDialog
        open={Boolean(selectedWikiCard)}
        onOpenChange={(open) => {
          if (!open) setSelectedWikiCard(null)
        }}
        wikiCard={selectedWikiCard}
        title={wikiLabel}
        sourceLabel={t.sources.viewSource}
      />
    </>
  )
}
