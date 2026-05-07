'use client'

import { Database, History, Loader2, RotateCcw, Square } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

import type { ZoteroImportResponse } from '@/lib/api/zotero'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useTranslation } from '@/lib/hooks/use-translation'
import { getDateLocale } from '@/lib/utils/date-locale'
import type { useZoteroImport } from '@/lib/hooks/use-zotero-import'

type ZoteroImportReturn = ReturnType<typeof useZoteroImport>

interface ZoteroImportPanelProps {
  zotero: ZoteroImportReturn
  language: string
}

export function ZoteroImportPanel({ zotero, language }: ZoteroImportPanelProps) {
  const { t } = useTranslation()

  const {
    collections,
    importing,
    loadingCollections,
    selectedCollectionId,
    selectedNotebookId,
    skipExisting,
    importJobStatus,
    importJobs,
    loadingImportJobs,
    notebooks,
    setSelectedCollectionId,
    setSelectedNotebookId,
    setSkipExisting,
    handleImportFromZotero,
    handleCancelImportJob,
    handleRetryImportJob,
    getImportCollectionName,
    getImportNotebookLabel,
    getImportStatusVariant,
    getItemPhaseLabel,
  } = zotero

  const zoteroImportProgress = importJobStatus?.progress
  const zoteroImportResult = importJobStatus?.result as ZoteroImportResponse | undefined
  const zoteroImportTotal = zoteroImportProgress?.total ?? zoteroImportResult?.total ?? 0
  const zoteroImportProcessed = zoteroImportProgress?.processed ?? (
    (zoteroImportResult?.imported ?? 0) +
    (zoteroImportResult?.skipped ?? 0) +
    (zoteroImportResult?.failed ?? 0)
  )
  const zoteroImportPercent = zoteroImportProgress?.percentage ?? (
    zoteroImportTotal > 0 ? (zoteroImportProcessed / zoteroImportTotal) * 100 : 0
  )
  const zoteroImportItemPhasePercent = zoteroImportProgress?.item_phase_percentage ?? 0
  const zoteroImportItemPhaseLabel = getItemPhaseLabel(zoteroImportProgress?.item_phase)
  const zoteroImportFailedItems = (zoteroImportResult?.results || []).filter((item) => item.status === 'failed')

  return (
    <div className="mb-4 rounded-lg border p-4 space-y-4 bg-background">
      <div>
        <h2 className="text-lg font-semibold">{t.zotero.importFromZotero}</h2>
        <p className="text-sm text-muted-foreground">
          {t.zotero.importDescription}
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>{t.zotero.zoteroCollection}</Label>
          <Select value={selectedCollectionId} onValueChange={setSelectedCollectionId}>
            <SelectTrigger>
              <SelectValue placeholder={loadingCollections ? t.zotero.loadingCollections : t.zotero.chooseCollection} />
            </SelectTrigger>
            <SelectContent>
              {collections.map((collection) => (
                <SelectItem key={collection.id} value={String(collection.id)}>
                  {collection.name} ({t.zotero.pdfCount.replace('{count}', String(collection.pdf_count))})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>{t.zotero.targetNotebook}</Label>
          <Select value={selectedNotebookId || '__none__'} onValueChange={(value) => setSelectedNotebookId(value === '__none__' ? '' : value)}>
            <SelectTrigger>
              <SelectValue placeholder={t.zotero.importWithoutNotebook} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">{t.zotero.noNotebook}</SelectItem>
              {notebooks.map((notebook) => (
                <SelectItem key={notebook.id} value={notebook.id}>
                  {notebook.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex items-center space-x-2">
        <Checkbox id="skip-existing" checked={skipExisting} onCheckedChange={(checked) => setSkipExisting(Boolean(checked))} />
        <Label htmlFor="skip-existing">{t.zotero.skipAlreadyImported}</Label>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => zotero.setShowZoteroPanel(false)} disabled={importing}>{t.zotero.cancel}</Button>
        <Button onClick={() => void handleImportFromZotero()} disabled={importing || !selectedCollectionId}>
          {importing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Database className="h-4 w-4 mr-2" />}
          {t.zotero.importCollection}
        </Button>
      </div>

      {importJobStatus && (
        <div className="space-y-3 rounded-md border bg-muted/30 p-4">
          <div className="flex items-center justify-between gap-4 text-sm">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{t.zotero.currentImport}</span>
                <Badge variant={getImportStatusVariant(importJobStatus.status)} className="capitalize">
                  {importJobStatus.status}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {getImportCollectionName(importJobStatus)} to {getImportNotebookLabel(importJobStatus)}
              </p>
            </div>
            {importJobStatus.job_id !== 'pending' && (
              <p className="text-xs text-muted-foreground">{importJobStatus.job_id}</p>
            )}
          </div>

          <Progress value={zoteroImportPercent} className="h-2" />

          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {t.zotero.processed.replace('{processed}', String(zoteroImportProcessed)).replace('{total}', String(zoteroImportTotal || '—'))}
            </span>
            <span className="font-medium">{zoteroImportPercent.toFixed(1)}%</span>
          </div>

          {zoteroImportItemPhaseLabel && importJobStatus.status === 'running' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{zoteroImportItemPhaseLabel}</span>
                <span>{zoteroImportItemPhasePercent.toFixed(1)}%</span>
              </div>
              <Progress value={zoteroImportItemPhasePercent} className="h-1.5" />
            </div>
          )}

          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span>{zoteroImportProgress?.imported ?? zoteroImportResult?.imported ?? 0} {t.zotero.imported}</span>
            <span>{zoteroImportProgress?.skipped ?? zoteroImportResult?.skipped ?? 0} {t.zotero.skipped}</span>
            <span>{zoteroImportProgress?.failed ?? zoteroImportResult?.failed ?? 0} {t.zotero.failed}</span>
            {importJobStatus.cancel_requested && importJobStatus.status !== 'canceled' && (
              <span>{t.zotero.cancellationRequested}</span>
            )}
          </div>

          {zoteroImportProgress?.current_item && importJobStatus.status === 'running' && (
            <p className="text-xs text-muted-foreground truncate">
              {t.zotero.current.replace('{item}', zoteroImportProgress.current_item)}
            </p>
          )}

          {(importJobStatus.status === 'running' || importJobStatus.status === 'new') && importJobStatus.job_id !== 'pending' && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleCancelImportJob(importJobStatus.job_id)}
                disabled={Boolean(importJobStatus.cancel_requested)}
              >
                <Square className="mr-2 h-3.5 w-3.5" />
                {importJobStatus.cancel_requested ? t.zotero.cancelRequested : t.zotero.cancelImport}
              </Button>
            </div>
          )}

          {zoteroImportFailedItems.length > 0 && (
            <div className="space-y-2 rounded-md border border-destructive/20 bg-background p-3">
              <p className="text-xs font-medium text-destructive">{t.sources.failedItems}</p>
              {zoteroImportFailedItems.slice(0, 5).map((item) => (
                <div key={`${item.attachment_key || item.title}-${item.error || 'error'}`} className="text-xs">
                  <p className="font-medium">{item.title}</p>
                  {item.error && <p className="text-muted-foreground">{item.error}</p>}
                </div>
              ))}
              {zoteroImportFailedItems.length > 5 && (
                <p className="text-xs text-muted-foreground">
                  {t.sources.moreFailedAvailable.replace('{count}', String(zoteroImportFailedItems.length - 5))}
                </p>
              )}
            </div>
          )}

          {importJobStatus.error_message && (
            <p className="text-sm text-destructive">{importJobStatus.error_message}</p>
          )}
        </div>
      )}

      <div className="space-y-3 rounded-md border bg-muted/20 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4" />
            <span className="font-medium">{t.zotero.recentImportJobs}</span>
          </div>
          {loadingImportJobs && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        {importJobs.length === 0 && !loadingImportJobs && (
          <p className="text-sm text-muted-foreground">{t.zotero.noImportJobs}</p>
        )}

        {importJobs.map((job) => {
          const result = job.result as ZoteroImportResponse | undefined
          const progress = job.progress
          const total = progress?.total ?? result?.total ?? 0
          const processed = progress?.processed ?? (
            (result?.imported ?? 0) +
            (result?.skipped ?? 0) +
            (result?.failed ?? 0)
          )
          const percent = progress?.percentage ?? (total > 0 ? (processed / total) * 100 : 0)
          const failedItems = (result?.results || []).filter((item) => item.status === 'failed')
          const canCancel = job.status === 'running' || job.status === 'new'
          const canRetry = job.status === 'failed' || job.status === 'canceled'

          return (
            <div key={job.job_id} className="space-y-3 rounded-md border bg-background p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{getImportCollectionName(job)}</span>
                    <Badge variant={getImportStatusVariant(job.status)} className="capitalize">
                      {job.status}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>{job.job_id}</span>
                    <span>{getImportNotebookLabel(job)}</span>
                    {job.created && (
                      <span>
                        {formatDistanceToNow(new Date(job.created), {
                          addSuffix: true,
                          locale: getDateLocale(language)
                        })}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex gap-2">
                  {canCancel && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleCancelImportJob(job.job_id)}
                      disabled={Boolean(job.cancel_requested)}
                    >
                      <Square className="mr-2 h-3.5 w-3.5" />
                      {job.cancel_requested ? t.zotero.cancelRequested : t.zotero.cancel}
                    </Button>
                  )}
                  {canRetry && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleRetryImportJob(job.job_id)}
                    >
                      <RotateCcw className="mr-2 h-3.5 w-3.5" />
                      {t.zotero.retry}
                    </Button>
                  )}
                </div>
              </div>

              <Progress value={percent} className="h-1.5" />

              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                <span>{t.zotero.processed.replace('{processed}', String(processed)).replace('{total}', String(total || '—'))}</span>
                <span>{progress?.imported ?? result?.imported ?? 0} {t.zotero.imported}</span>
                <span>{progress?.skipped ?? result?.skipped ?? 0} {t.zotero.skipped}</span>
                <span>{progress?.failed ?? result?.failed ?? 0} {t.zotero.failed}</span>
                {job.cancel_requested && job.status !== 'canceled' && <span>{t.zotero.cancellationRequested}</span>}
              </div>

              {progress?.current_item && job.status === 'running' && (
                <p className="text-xs text-muted-foreground truncate">
                  {t.zotero.current.replace('{item}', progress.current_item)}
                </p>
              )}

              {failedItems.length > 0 && (
                <div className="space-y-1 rounded-md border border-destructive/20 bg-muted/20 p-2">
                  <p className="text-xs font-medium text-destructive">{t.sources.failedItems}</p>
                  {failedItems.slice(0, 3).map((item) => (
                    <div key={`${job.job_id}-${item.attachment_key || item.title}`} className="text-xs">
                      <p className="font-medium">{item.title}</p>
                      {item.error && <p className="text-muted-foreground">{item.error}</p>}
                    </div>
                  ))}
                  {failedItems.length > 3 && (
                    <p className="text-xs text-muted-foreground">
                      {t.sources.moreFailedOmitted.replace('{count}', String(failedItems.length - 3))}
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
