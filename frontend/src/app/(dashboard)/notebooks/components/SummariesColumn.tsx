'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isAxiosError } from 'axios'
import { useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { BookText, FileText, Loader2, RefreshCw, Sparkles } from 'lucide-react'
import { toast } from 'sonner'

import { SourceInsightDialog } from '@/components/source/SourceInsightDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { CollapsibleColumn, createCollapseButton } from '@/components/notebooks/CollapsibleColumn'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { insightsApi } from '@/lib/api/insights'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { type NotebookSourceSummaryResponse, summariesApi } from '@/lib/api/summaries'
import { modelsApi } from '@/lib/api/models'
import { useModels, useModelDefaults, useProviders } from '@/lib/hooks/use-models'
import { useModalManager } from '@/lib/hooks/use-modal-manager'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useNotebookColumnsStore } from '@/lib/stores/notebook-columns-store'
import { getDateLocale } from '@/lib/utils/date-locale'

interface SummariesColumnProps {
  summaries?: NotebookSourceSummaryResponse[]
  isLoading: boolean
  notebookId: string
}

type SelectedSummaryState = {
  id: string
  insight_type?: string
  content?: string
  created?: string
  source_id?: string
}

type SummaryBatchProgressState = {
  total: number
  completed: number
  failed: number
  pendingSourceIds: Set<string>
}

export function SummariesColumn({
  summaries,
  isLoading,
  notebookId,
}: SummariesColumnProps) {
  const { t, language } = useTranslation()
  const { data: models = [] } = useModels()
  const { data: modelDefaults } = useModelDefaults()
  const { data: providerAvailability } = useProviders()
  const queryClient = useQueryClient()
  const { openModal } = useModalManager()
  const [selectedSummary, setSelectedSummary] = useState<SelectedSummaryState | null>(null)
  const [generatingSourceIds, setGeneratingSourceIds] = useState<Set<string>>(() => new Set())
  const [refreshingSummaryIds, setRefreshingSummaryIds] = useState<Set<string>>(() => new Set())
  const [isBatchGenerating, setIsBatchGenerating] = useState(false)
  const [batchProgress, setBatchProgress] = useState<SummaryBatchProgressState | null>(null)
  const validatedModelIdsRef = useRef<Set<string>>(new Set())
  const batchProgressResetTimeoutRef = useRef<number | null>(null)

  const { summariesCollapsed, toggleSummaries } = useNotebookColumnsStore()
  const collapseButton = useMemo(
    () => createCollapseButton(toggleSummaries, t.podcasts.summary),
    [t.podcasts.summary, toggleSummaries]
  )

  const languageModels = useMemo(
    () =>
      [...models]
        .filter((model) => model.type === 'language')
        .sort((a, b) => a.name.localeCompare(b.name)),
    [models]
  )

  const availableProviderNames = useMemo(
    () => new Set((providerAvailability?.available ?? []).map(provider => provider.toLowerCase())),
    [providerAvailability?.available]
  )

  const availableLanguageModels = useMemo(() => {
    if (!providerAvailability) {
      return languageModels
    }

    return languageModels.filter((model) =>
      availableProviderNames.has(model.provider.replaceAll('_', '-').toLowerCase())
    )
  }, [availableProviderNames, languageModels, providerAvailability])

  const preferredSummaryModelId = useMemo(() => {
    const preferredIds = [
      modelDefaults?.default_transformation_model,
      modelDefaults?.default_chat_model,
    ].filter((value): value is string => Boolean(value))

    for (const preferredId of preferredIds) {
      if (availableLanguageModels.some((model) => model.id === preferredId)) {
        return preferredId
      }
    }

    return availableLanguageModels[0]?.id
  }, [
    availableLanguageModels,
    modelDefaults?.default_chat_model,
    modelDefaults?.default_transformation_model,
  ])

  const missingSummarySourceIds = useMemo(
    () => (summaries ?? []).filter((item) => !item.summary).map((item) => item.source_id),
    [summaries]
  )

  const missingSummaryCount = missingSummarySourceIds.length
  const batchProcessedCount = (batchProgress?.completed ?? 0) + (batchProgress?.failed ?? 0)
  const batchPendingCount = batchProgress?.pendingSourceIds.size ?? 0
  const batchProgressPercent = batchProgress?.total
    ? Math.round((batchProcessedCount / batchProgress.total) * 100)
    : 0
  const isBatchProgressComplete = Boolean(
    batchProgress && batchProcessedCount >= batchProgress.total
  )

  useEffect(() => {
    if (batchProgressResetTimeoutRef.current) {
      window.clearTimeout(batchProgressResetTimeoutRef.current)
      batchProgressResetTimeoutRef.current = null
    }

    if (!batchProgress || !isBatchProgressComplete) {
      return
    }

    batchProgressResetTimeoutRef.current = window.setTimeout(() => {
      setBatchProgress(null)
      batchProgressResetTimeoutRef.current = null
    }, 4000)

    return () => {
      if (batchProgressResetTimeoutRef.current) {
        window.clearTimeout(batchProgressResetTimeoutRef.current)
        batchProgressResetTimeoutRef.current = null
      }
    }
  }, [batchProgress, isBatchProgressComplete])

  const parseValidDate = useCallback((value?: string | null) => {
    if (!value) {
      return null
    }

    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }, [])

  const formatRelativeDate = useCallback((value?: string | null) => {
    const date = parseValidDate(value)
    if (!date) {
      return t.common.unknown
    }

    return formatDistanceToNow(date, {
      addSuffix: true,
      locale: getDateLocale(language),
    })
  }, [language, parseValidDate, t.common.unknown])

  const resolveSummaryModelId = useCallback(() => {
    if (preferredSummaryModelId) {
      return preferredSummaryModelId
    }

    toast.error(t.apiErrors.pleaseConfigureModels)
    return null
  }, [preferredSummaryModelId, t.apiErrors.pleaseConfigureModels])

  const getSummaryErrorMessage = useCallback((error: unknown) => {
    if (isAxiosError(error)) {
      const detail =
        typeof error.response?.data === 'object' &&
        error.response?.data &&
        'detail' in error.response.data
          ? String(error.response.data.detail)
          : null
      return detail || error.message || t.common.error
    }

    if (error instanceof Error) {
      return error.message
    }

    return t.common.error
  }, [t.common.error])

  const validateSummaryModel = useCallback(async (modelId: string) => {
    if (validatedModelIdsRef.current.has(modelId)) {
      return true
    }

    try {
      const result = await modelsApi.testModel(modelId)
      if (result.success) {
        validatedModelIdsRef.current.add(modelId)
        return true
      }

      toast.error(result.message || t.apiErrors.pleaseConfigureModels)
      return false
    } catch (error) {
      toast.error(getSummaryErrorMessage(error))
      return false
    }
  }, [getSummaryErrorMessage, t.apiErrors.pleaseConfigureModels])

  const invalidateSummaryData = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: QUERY_KEYS.summaries(notebookId),
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
      queryKey: ['sources'],
      refetchType: 'active',
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
      if (!previous.has(sourceId)) {
        return previous
      }

      const next = new Set(previous)
      next.delete(sourceId)
      return next
    })
  }, [])

  const markSummaryRefreshing = useCallback((summaryId: string) => {
    setRefreshingSummaryIds((previous) => {
      const next = new Set(previous)
      next.add(summaryId)
      return next
    })
  }, [])

  const clearSummaryRefreshing = useCallback((summaryId: string) => {
    setRefreshingSummaryIds((previous) => {
      if (!previous.has(summaryId)) {
        return previous
      }

      const next = new Set(previous)
      next.delete(summaryId)
      return next
    })
  }, [])

  const updateBatchProgress = useCallback((
    sourceId: string,
    status: 'completed' | 'failed'
  ) => {
    setBatchProgress((previous) => {
      if (!previous || !previous.pendingSourceIds.has(sourceId)) {
        return previous
      }

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

  const trackSummaryCommand = useCallback(async ({
    commandId,
    sourceId,
    summaryId,
  }: {
    commandId?: string
    sourceId?: string
    summaryId?: string
  }) => {
    try {
      if (!commandId) {
        invalidateSummaryData()
        window.setTimeout(invalidateSummaryData, 1500)
        return
      }

      const result = await insightsApi.waitForCommand(commandId, {
        maxAttempts: 120,
        intervalMs: 2000,
      })

      if (!result.success) {
        if (sourceId) {
          updateBatchProgress(sourceId, 'failed')
        }
        toast.error(result.errorMessage || t.common.error)
        return
      }

      if (sourceId) {
        updateBatchProgress(sourceId, 'completed')
      }
      invalidateSummaryData()
      window.setTimeout(invalidateSummaryData, 1500)
    } finally {
      if (sourceId) {
        clearSourceGenerating(sourceId)
      }
      if (summaryId) {
        clearSummaryRefreshing(summaryId)
      }
    }
  }, [
    clearSourceGenerating,
    clearSummaryRefreshing,
    invalidateSummaryData,
    t.common.error,
    updateBatchProgress,
  ])

  const queueSummaryGeneration = useCallback(async (
    sourceId: string,
    modelId: string,
    options?: { showToast?: boolean }
  ) => {
    markSourceGenerating(sourceId)

    try {
      const response = await summariesApi.create(sourceId, modelId)
      if (options?.showToast ?? true) {
        toast.success(t.sources.insightGenerationStarted)
      }
      void trackSummaryCommand({ commandId: response.command_id, sourceId })
      return true
    } catch (error) {
      clearSourceGenerating(sourceId)
      throw error
    }
  }, [
    clearSourceGenerating,
    markSourceGenerating,
    t.sources.insightGenerationStarted,
    trackSummaryCommand,
  ])

  const handleGenerateSummary = useCallback(async (sourceId: string) => {
    if (generatingSourceIds.has(sourceId)) {
      return
    }

    const modelId = resolveSummaryModelId()
    if (!modelId) {
      return
    }

    try {
      const isModelValid = await validateSummaryModel(modelId)
      if (!isModelValid) {
        return
      }

      await queueSummaryGeneration(sourceId, modelId)
    } catch (error) {
      toast.error(getSummaryErrorMessage(error))
    }
  }, [
    generatingSourceIds,
    getSummaryErrorMessage,
    queueSummaryGeneration,
    resolveSummaryModelId,
    validateSummaryModel,
  ])

  const handleGenerateMissingSummaries = useCallback(async () => {
    const sourceIds = missingSummarySourceIds.filter((sourceId) => !generatingSourceIds.has(sourceId))
    if (sourceIds.length === 0) {
      return
    }

    const modelId = resolveSummaryModelId()
    if (!modelId) {
      return
    }

    try {
      setIsBatchGenerating(true)
      setBatchProgress({
        total: sourceIds.length,
        completed: 0,
        failed: 0,
        pendingSourceIds: new Set(sourceIds),
      })
      const isModelValid = await validateSummaryModel(modelId)
      if (!isModelValid) {
        setBatchProgress(null)
        return
      }

      const results = await Promise.allSettled(
        sourceIds.map((sourceId) => queueSummaryGeneration(sourceId, modelId, { showToast: false }))
      )

      const queuedCount = results.filter(
        (result): result is PromiseFulfilledResult<boolean> => result.status === 'fulfilled' && result.value
      ).length

      if (queuedCount > 0) {
        toast.success(t.sources.insightGenerationStarted)
      }

      const firstRejectedResult = results.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected'
      )

      if (firstRejectedResult) {
        results.forEach((result, index) => {
          if (result.status === 'rejected') {
            const sourceId = sourceIds[index]
            if (sourceId) {
              updateBatchProgress(sourceId, 'failed')
            }
          }
        })
        toast.error(getSummaryErrorMessage(firstRejectedResult.reason))
      }
    } finally {
      setIsBatchGenerating(false)
    }
  }, [
    generatingSourceIds,
    getSummaryErrorMessage,
    missingSummarySourceIds,
    queueSummaryGeneration,
    resolveSummaryModelId,
    t.sources.insightGenerationStarted,
    updateBatchProgress,
    validateSummaryModel,
  ])

  const handleRefreshSummary = useCallback(async (summaryId: string) => {
    if (refreshingSummaryIds.has(summaryId)) {
      return
    }

    const modelId = resolveSummaryModelId()
    if (!modelId) {
      return
    }

    try {
      const isModelValid = await validateSummaryModel(modelId)
      if (!isModelValid) {
        return
      }

      markSummaryRefreshing(summaryId)
      const response = await insightsApi.refresh(summaryId, modelId)
      toast.success(t.sources.insightRefreshStarted)
      void trackSummaryCommand({ commandId: response.command_id, summaryId })
    } catch (error) {
      clearSummaryRefreshing(summaryId)
      toast.error(getSummaryErrorMessage(error))
    }
  }, [
    clearSummaryRefreshing,
    getSummaryErrorMessage,
    markSummaryRefreshing,
    refreshingSummaryIds,
    resolveSummaryModelId,
    t.sources.insightRefreshStarted,
    trackSummaryCommand,
    validateSummaryModel,
  ])

  const previewContent = useCallback((content?: string | null) => {
    if (!content) {
      return ''
    }

    return content
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
      .trim()
  }, [])

  return (
    <>
      <CollapsibleColumn
        isCollapsed={summariesCollapsed}
        onToggle={toggleSummaries}
        collapsedIcon={BookText}
        collapsedLabel={t.podcasts.summary}
      >
        <Card className="h-full flex flex-col flex-1 overflow-hidden">
          <CardHeader className="pb-3 flex-shrink-0">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-lg">{t.podcasts.summary}</CardTitle>
              <div className="flex items-center gap-2">
                {missingSummaryCount > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void handleGenerateMissingSummaries()
                    }}
                    disabled={isBatchGenerating || Boolean(batchProgress)}
                  >
                    {isBatchGenerating ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="mr-2 h-4 w-4" />
                    )}
                    {`${t.common.create} ${t.podcasts.summary} (${missingSummaryCount})`}
                  </Button>
                )}
                {collapseButton}
              </div>
            </div>
            {batchProgress && (
              <div className="rounded-md border bg-muted/30 p-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium">
                    {isBatchProgressComplete ? t.common.completed : t.common.processing}
                  </span>
                  <span className="text-muted-foreground">
                    {batchProcessedCount} / {batchProgress.total}
                  </span>
                </div>
                <Progress value={batchProgressPercent} className="mt-2 h-2" />
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{t.common.progress}: {batchProgressPercent}%</span>
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
              <div className="flex items-center justify-center py-8">
                <LoadingSpinner />
              </div>
            ) : !summaries || summaries.length === 0 ? (
              <EmptyState
                icon={BookText}
                title={t.podcasts.summary}
                description={t.sources.createFirstSource}
              />
            ) : (
              <div className="space-y-3">
                {summaries.map((item) => {
                  const summary = item.summary
                  const isGenerating = generatingSourceIds.has(item.source_id)
                  const isRefreshing = summary?.id ? refreshingSummaryIds.has(summary.id) : false
                  const hasSummary = Boolean(summary)

                  return (
                    <div
                      key={item.source_id}
                      className="rounded-lg border bg-background p-3 transition-colors hover:bg-accent/30"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div
                          className={hasSummary ? 'min-w-0 flex-1 cursor-pointer' : 'min-w-0 flex-1'}
                          onClick={() => {
                            if (!summary) {
                              return
                            }
                            setSelectedSummary({
                              id: summary.id,
                              insight_type: summary.prompt_title || summary.insight_type,
                              content: summary.content,
                              created: summary.created,
                              source_id: item.source_id,
                            })
                          }}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-semibold break-words">
                              {item.source_title || t.sources.untitledSource}
                            </h3>
                            {hasSummary && (
                              <Badge variant="secondary">{t.podcasts.summary}</Badge>
                            )}
                          </div>

                          <p className="mt-1 text-xs text-muted-foreground">
                            {t.common.updated.replace(
                              '{time}',
                              formatRelativeDate(hasSummary ? summary?.updated : item.source_updated)
                            )}
                          </p>

                          {hasSummary ? (
                            <p className="mt-3 line-clamp-6 whitespace-pre-wrap text-sm text-muted-foreground">
                              {previewContent(summary?.content)}
                            </p>
                          ) : null}
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        {hasSummary ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(event) => {
                              event.stopPropagation()
                              if (summary?.id) {
                                void handleRefreshSummary(summary.id)
                              }
                            }}
                            disabled={isRefreshing || isGenerating}
                          >
                            {isRefreshing ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <RefreshCw className="mr-2 h-4 w-4" />
                            )}
                            {isRefreshing ? t.sources.refreshingInsight : t.common.refresh}
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            onClick={(event) => {
                              event.stopPropagation()
                              void handleGenerateSummary(item.source_id)
                            }}
                            disabled={isGenerating}
                          >
                            {isGenerating ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Sparkles className="mr-2 h-4 w-4" />
                            )}
                            {isGenerating ? t.common.processing : `${t.common.create} ${t.podcasts.summary}`}
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

      <SourceInsightDialog
        open={Boolean(selectedSummary)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedSummary(null)
          }
        }}
        insight={selectedSummary ?? undefined}
      />
    </>
  )
}
