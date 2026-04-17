'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { SourceListResponse } from '@/lib/types/api'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu'
import {
  FileText,
  ExternalLink,
  Upload,
  MoreVertical,
  Trash2,
  RefreshCw,
  Clock,
  CheckCircle,
  AlertTriangle,
  Loader2,
  Unlink,
  BookMarked,
  BookText,
} from 'lucide-react'
import { useSourceStatus } from '@/lib/hooks/use-sources'
import { useTranslation } from '@/lib/hooks/use-translation'
import { TranslationKeys } from '@/lib/locales'
import { cn } from '@/lib/utils'
import { ContextToggle } from '@/components/common/ContextToggle'
import { ContextMode } from '@/app/(dashboard)/notebooks/[id]/page'

export type SourceArtifactState = 'missing' | 'ready' | 'pending' | 'failed' | 'stale'

interface SourceCardProps {
  source: SourceListResponse
  onDelete?: (sourceId: string) => void
  onRetry?: (sourceId: string) => void
  onRemoveFromNotebook?: (sourceId: string) => void
  onClick?: (sourceId: string) => void
  onRefresh?: () => void
  className?: string
  showRemoveFromNotebook?: boolean
  contextMode?: ContextMode
  onContextModeChange?: (mode: ContextMode) => void
  summaryState?: SourceArtifactState
  wikiState?: SourceArtifactState
}

const SOURCE_TYPE_ICONS = {
  link: ExternalLink,
  upload: Upload,
  text: FileText,
} as const

const WORKER_HINT_THRESHOLD_MS = 60 * 1000

const getStatusConfig = (t: TranslationKeys) => ({
  new: {
    icon: Clock,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    label: t.sources.statusProcessing,
    description: t.sources.statusPreparingDesc
  },
  queued: {
    icon: Clock,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    label: t.sources.statusQueued,
    description: t.sources.statusQueuedDesc
  },
  running: {
    icon: Loader2,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    label: t.sources.statusProcessing,
    description: t.sources.statusProcessingDesc
  },
  completed: {
    icon: CheckCircle,
    color: 'text-green-600',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
    label: t.sources.statusCompleted,
    description: t.sources.statusCompletedDesc
  },
  failed: {
    icon: AlertTriangle,
    color: 'text-red-600',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    label: t.sources.statusFailed,
    description: t.sources.statusFailedDesc
  }
} as const)

type SourceStatus = 'new' | 'queued' | 'running' | 'completed' | 'failed'

function isSourceStatus(status: unknown): status is SourceStatus {
  return typeof status === 'string' && ['new', 'queued', 'running', 'completed', 'failed'].includes(status)
}

function getSourceType(source: SourceListResponse): 'link' | 'upload' | 'text' {
  if (source.asset?.url) return 'link'
  if (source.asset?.file_path) return 'upload'
  return 'text'
}

export function SourceCard({
  source,
  onClick,
  onDelete,
  onRetry,
  onRemoveFromNotebook,
  onRefresh,
  className,
  showRemoveFromNotebook = false,
  contextMode,
  onContextModeChange,
  summaryState = 'missing',
  wikiState = 'missing',
}: SourceCardProps) {
  const { t, language } = useTranslation()
  const statusConfigMap = getStatusConfig(t)
  const isZh = language?.startsWith('zh')

  const sourceWithStatus = source as SourceListResponse & {
    command_id?: string
    status?: string
    error_message?: string | null
  }

  const [wasProcessing, setWasProcessing] = useState(false)

  const shouldFetchStatus = !!sourceWithStatus.command_id ||
    sourceWithStatus.status === 'new' ||
    sourceWithStatus.status === 'queued' ||
    sourceWithStatus.status === 'running' ||
    sourceWithStatus.status === 'failed' ||
    wasProcessing

  const { data: statusData, isLoading: statusLoading } = useSourceStatus(
    source.id,
    shouldFetchStatus
  )

  const rawStatus = statusData?.status || sourceWithStatus.status
  const currentStatus: SourceStatus = isSourceStatus(rawStatus)
    ? rawStatus
    : (sourceWithStatus.command_id ? 'new' : 'completed')

  useEffect(() => {
    const currentStatusFromData = statusData?.status || sourceWithStatus.status

    if (currentStatusFromData === 'new' || currentStatusFromData === 'running' || currentStatusFromData === 'queued') {
      setWasProcessing(true)
    }

    if (wasProcessing &&
        (currentStatusFromData === 'completed' || currentStatusFromData === 'failed')) {
      setWasProcessing(false)

      if (onRefresh) {
        setTimeout(() => onRefresh(), 500)
      }
    }
  }, [statusData, sourceWithStatus.status, wasProcessing, onRefresh])

  const statusConfig = statusConfigMap[currentStatus] || statusConfigMap.completed
  const StatusIcon = statusConfig.icon
  const sourceType = getSourceType(source)
  const SourceTypeIcon = SOURCE_TYPE_ICONS[sourceType]

  const artifactLabels = useMemo(() => ({
    summary: {
      ready: t.podcasts.summary,
      missing: isZh ? '待生成总结' : 'Summary missing',
      pending: isZh ? '总结生成中' : 'Summary pending',
      failed: isZh ? '总结失败' : 'Summary failed',
      stale: isZh ? '总结待刷新' : 'Summary stale',
    },
    wiki: {
      ready: 'Wiki',
      missing: isZh ? '待建 Wiki' : 'Wiki missing',
      pending: isZh ? 'Wiki 生成中' : 'Wiki pending',
      failed: isZh ? 'Wiki 失败' : 'Wiki failed',
      stale: isZh ? 'Wiki 待刷新' : 'Wiki stale',
    },
  }), [isZh, t.podcasts.summary])

  const getArtifactBadgeClassName = (state: SourceArtifactState) => {
    switch (state) {
      case 'ready':
        return ''
      case 'pending':
        return 'border-blue-200 text-blue-700'
      case 'failed':
        return 'border-red-200 text-red-700'
      case 'stale':
        return 'border-amber-300 text-amber-700'
      default:
        return 'border-dashed text-muted-foreground'
    }
  }

  const title = source.title || t.sources.untitledSource
  const errorMessage =
    typeof statusData?.error_message === 'string' && statusData.error_message
      ? statusData.error_message
      : typeof sourceWithStatus.error_message === 'string' && sourceWithStatus.error_message
        ? sourceWithStatus.error_message
        : typeof statusData?.processing_info?.error === 'string' && statusData.processing_info.error
          ? statusData.processing_info.error
          : null

  const handleRetry = () => {
    if (onRetry) {
      onRetry(source.id)
    }
  }

  const handleDelete = () => {
    if (onDelete) {
      onDelete(source.id)
    }
  }

  const handleRemoveFromNotebook = () => {
    if (onRemoveFromNotebook) {
      onRemoveFromNotebook(source.id)
    }
  }

  const handleCardClick = () => {
    if (onClick) {
      onClick(source.id)
    }
  }

  const isProcessing = currentStatus === 'new' || currentStatus === 'running' || currentStatus === 'queued'
  const isFailed = currentStatus === 'failed'
  const isCompleted = currentStatus === 'completed'
  const startedAt = statusData?.processing_info?.started_at
  const sourceCreatedAt = Date.parse(source.created)
  const sourceAgeMs = Number.isNaN(sourceCreatedAt) ? 0 : Date.now() - sourceCreatedAt
  const showWorkerHint =
    (currentStatus === 'new' || currentStatus === 'queued') &&
    !startedAt &&
    sourceAgeMs > WORKER_HINT_THRESHOLD_MS
  const numericProgress = typeof statusData?.processing_info?.progress === 'number'
    ? statusData.processing_info.progress
    : null

  return (
    <Card
      className={cn(
        'transition-all duration-200 hover:shadow-md group relative cursor-pointer border border-border/60 dark:border-border/40',
        className
      )}
      onClick={handleCardClick}
    >
      <CardContent className="px-3 py-1">
        <div className="flex items-start justify-between gap-3 mb-1">
          <div className="flex-1 min-w-0">
            {!isCompleted && (
              <div className="flex items-center gap-2 mb-2">
                <div className={cn(
                  'flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium',
                  statusConfig.bgColor,
                  statusConfig.color
                )}>
                  <StatusIcon className={cn(
                    'h-3 w-3',
                    isProcessing && 'animate-spin'
                  )} />
                  {statusLoading && shouldFetchStatus ? t.sources.checking : statusConfig.label}
                </div>

                <div className="flex items-center gap-1 text-gray-500">
                  <SourceTypeIcon className="h-3 w-3" />
                  <span className="text-xs capitalize">{t.common.source}</span>
                </div>
              </div>
            )}

            <div className={cn('mb-1.5', !isCompleted && 'mb-1')}>
              <h4
                className="text-sm font-medium leading-tight line-clamp-2 break-all"
                title={title}
              >
                {title}
              </h4>
            </div>

            {statusData?.message && (isProcessing || isFailed) && (
              <p className="text-xs text-gray-600 mb-2 italic">
                {statusData.message}
              </p>
            )}

            {isFailed && errorMessage && (
              <p className="mb-2 text-xs text-red-700 line-clamp-3 break-words">
                {errorMessage}
              </p>
            )}

            {showWorkerHint && (
              <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                <div className="flex items-start gap-1.5">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <div>
                    <p className="font-medium">{t.sources.workerLikelyDown}</p>
                    <p>{t.sources.workerLikelyDownDesc}</p>
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="secondary" className="text-xs flex items-center gap-1">
                <SourceTypeIcon className="h-3 w-3" />
                {sourceType === 'link' ? t.sources.addUrl : sourceType === 'upload' ? t.sources.uploadFile : t.sources.enterText}
              </Badge>

              <Badge variant="outline" className={cn('text-xs flex items-center gap-1', getArtifactBadgeClassName(summaryState))}>
                <BookText className="h-3 w-3" />
                {artifactLabels.summary[summaryState]}
              </Badge>
              <Badge variant="outline" className={cn('text-xs flex items-center gap-1', getArtifactBadgeClassName(wikiState))}>
                <BookMarked className="h-3 w-3" />
                {artifactLabels.wiki[wikiState]}
              </Badge>

              {isCompleted && source.insights_count > 0 && (
                <Badge variant="outline" className="text-xs">
                  {t.sources.insightsCount.replace('{count}', source.insights_count.toString())}
                </Badge>
              )}
              {source.topics && source.topics.length > 0 && isCompleted && (
                <>
                  {source.topics.slice(0, 2).map((topic, index) => (
                    <Badge key={index} variant="outline" className="text-xs">
                      {topic}
                    </Badge>
                  ))}
                  {source.topics.length > 2 && (
                    <Badge variant="outline" className="text-xs">
                      +{source.topics.length - 2}
                    </Badge>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1">
            {onContextModeChange && contextMode && (
              <ContextToggle
                mode={contextMode}
                hasInsights={source.insights_count > 0}
                onChange={onContextModeChange}
              />
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
              <DropdownMenuContent align="end" className="w-48">
                {showRemoveFromNotebook && (
                  <>
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation()
                        handleRemoveFromNotebook()
                      }}
                      disabled={!onRemoveFromNotebook}
                    >
                      <Unlink className="h-4 w-4 mr-2" />
                      {t.sources.removeFromNotebook}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}

                {isFailed && (
                  <>
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation()
                        handleRetry()
                      }}
                      disabled={!onRetry}
                    >
                      <RefreshCw className="h-4 w-4 mr-2" />
                      {t.sources.retryProcessing}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}

                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDelete()
                  }}
                  disabled={!onDelete}
                  className="text-red-600 focus:text-red-600"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  {t.sources.deleteSource}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {isFailed && (
          <div className="flex gap-2 pt-2 border-t">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRetry}
              disabled={!onRetry}
              className="h-7 text-xs"
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              {t.sources.retry}
            </Button>
          </div>
        )}

        {isProcessing && numericProgress !== null && (
          <div className="mt-3 pt-2 border-t">
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs text-gray-600">{t.common.progress}</span>
              <span className="text-xs text-gray-600">
                {Math.round(numericProgress)}%
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-1.5">
              <div
                className="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
                style={{ width: `${numericProgress}%` }}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
