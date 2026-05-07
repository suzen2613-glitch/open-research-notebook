'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  zoteroApi,
  type ZoteroCollectionResponse,
  type ZoteroImportJobStatusResponse,
  type ZoteroImportResponse,
} from '@/lib/api/zotero'
import { useNotebooks } from '@/lib/hooks/use-notebooks'
import { toast } from 'sonner'

const ACTIVE_ZOTERO_IMPORT_JOB_STORAGE_KEY = 'open-notebook:zotero-import-active-job'

function upsertImportJob(
  jobs: ZoteroImportJobStatusResponse[],
  nextJob: ZoteroImportJobStatusResponse
) {
  const remaining = jobs.filter((job) => job.job_id !== nextJob.job_id)
  return [nextJob, ...remaining].slice(0, 10)
}

export function useZoteroImport(onImportComplete?: () => void | Promise<void>) {
  const { data: notebooks = [] } = useNotebooks()
  const [collections, setCollections] = useState<ZoteroCollectionResponse[]>([])
  const [importing, setImporting] = useState(false)
  const [loadingCollections, setLoadingCollections] = useState(false)
  const [showZoteroPanel, setShowZoteroPanel] = useState(false)
  const [selectedCollectionId, setSelectedCollectionId] = useState<string>('')
  const [selectedNotebookId, setSelectedNotebookId] = useState<string>('')
  const [skipExisting, setSkipExisting] = useState(true)
  const [importJobStatus, setImportJobStatus] = useState<ZoteroImportJobStatusResponse | null>(null)
  const [importJobs, setImportJobs] = useState<ZoteroImportJobStatusResponse[]>([])
  const [loadingImportJobs, setLoadingImportJobs] = useState(false)
  const zoteroImportPollRef = useRef<number | null>(null)

  const persistActiveImportJob = useCallback((jobId: string | null) => {
    if (typeof window === 'undefined') return
    if (jobId) {
      window.localStorage.setItem(ACTIVE_ZOTERO_IMPORT_JOB_STORAGE_KEY, jobId)
    } else {
      window.localStorage.removeItem(ACTIVE_ZOTERO_IMPORT_JOB_STORAGE_KEY)
    }
  }, [])

  const loadCollections = useCallback(async () => {
    try {
      setLoadingCollections(true)
      const data = await zoteroApi.listCollections()
      setCollections(data.filter((c) => c.pdf_count > 0))
    } catch (err) {
      console.error('Failed to load Zotero collections:', err)
      toast.error('Failed to load Zotero collections')
    } finally {
      setLoadingCollections(false)
    }
  }, [])

  const loadImportJobs = useCallback(async () => {
    try {
      setLoadingImportJobs(true)
      const jobs = await zoteroApi.listImportCollectionJobs({ limit: 10 })
      setImportJobs(jobs)
    } catch (err) {
      console.error('Failed to load Zotero import jobs:', err)
    } finally {
      setLoadingImportJobs(false)
    }
  }, [])

  useEffect(() => { void loadCollections() }, [loadCollections])
  useEffect(() => { void loadImportJobs() }, [loadImportJobs])

  const stopZoteroImportPolling = useCallback(() => {
    if (zoteroImportPollRef.current !== null) {
      window.clearInterval(zoteroImportPollRef.current)
      zoteroImportPollRef.current = null
    }
  }, [])

  const finalizeZoteroImport = useCallback(async (statusData: ZoteroImportJobStatusResponse) => {
    stopZoteroImportPolling()
    setImporting(false)
    setImportJobStatus(statusData)
    setImportJobs((prev) => upsertImportJob(prev, statusData))
    persistActiveImportJob(null)

    if (statusData.status === 'completed') {
      const result = statusData.result as ZoteroImportResponse | undefined
      if (result) {
        toast.success(`Zotero import finished: ${result.imported} imported, ${result.skipped} skipped, ${result.failed} failed`)
      } else {
        toast.success('Zotero import finished')
      }
      await onImportComplete?.()
      await loadImportJobs()
      return
    }

    if (statusData.status === 'canceled') {
      const result = statusData.result as ZoteroImportResponse | undefined
      toast.success(
        result
          ? `Zotero import canceled: ${result.imported} imported, ${result.skipped} skipped, ${result.failed} failed`
          : 'Zotero import canceled'
      )
      await onImportComplete?.()
      await loadImportJobs()
      return
    }

    const errorMessage =
      statusData.error_message ||
      statusData.progress?.error_message ||
      'Zotero import failed'
    toast.error(errorMessage)
    await onImportComplete?.()
    await loadImportJobs()
  }, [loadImportJobs, onImportComplete, persistActiveImportJob, stopZoteroImportPolling])

  const pollZoteroImportJob = useCallback(async (jobId: string) => {
    try {
      const statusData = await zoteroApi.getImportCollectionJobStatus(jobId)
      setImportJobStatus(statusData)
      setImportJobs((prev) => upsertImportJob(prev, statusData))

      if (statusData.status === 'completed' || statusData.status === 'failed' || statusData.status === 'canceled') {
        await finalizeZoteroImport(statusData)
      }
    } catch (err) {
      console.error('Failed to fetch Zotero import status:', err)
      stopZoteroImportPolling()
      setImporting(false)
      toast.error('Failed to fetch Zotero import status')
    }
  }, [finalizeZoteroImport, stopZoteroImportPolling])

  const startZoteroImportPolling = useCallback((jobId: string) => {
    stopZoteroImportPolling()
    persistActiveImportJob(jobId)
    void pollZoteroImportJob(jobId)
    zoteroImportPollRef.current = window.setInterval(() => {
      void pollZoteroImportJob(jobId)
    }, 1500)
  }, [persistActiveImportJob, pollZoteroImportJob, stopZoteroImportPolling])

  useEffect(() => {
    return () => { stopZoteroImportPolling() }
  }, [stopZoteroImportPolling])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const storedJobId = window.localStorage.getItem(ACTIVE_ZOTERO_IMPORT_JOB_STORAGE_KEY)
    if (!storedJobId) return
    setImporting(true)
    startZoteroImportPolling(storedJobId)
  }, [startZoteroImportPolling])

  const handleImportFromZotero = useCallback(async () => {
    if (collections.length === 0) {
      toast.error('No Zotero collections with PDFs found')
      return
    }

    if (!selectedCollectionId) {
      toast.error('Please choose a Zotero collection')
      return
    }

    const collectionId = Number(selectedCollectionId)
    if (!Number.isFinite(collectionId)) {
      toast.error('Invalid collection ID')
      return
    }

    const selectedCollection = collections.find((collection) => collection.id === collectionId)

    try {
      setImporting(true)
      setImportJobStatus({
        job_id: 'pending',
        status: 'submitted',
        args: {
          collection_id: collectionId,
          notebook_ids: selectedNotebookId ? [selectedNotebookId] : [],
          embed: true,
          skip_existing: skipExisting,
        },
        progress: {
          phase: 'queued',
          collection_id: collectionId,
          collection_name: selectedCollection?.name,
          total: selectedCollection?.pdf_count ?? 0,
          processed: 0,
          imported: 0,
          skipped: 0,
          failed: 0,
          percentage: 0,
          current_item: null,
          current_index: null,
          item_phase: null,
          item_phase_index: null,
          item_phase_total: null,
          item_phase_percentage: null,
        },
      })

      const job = await zoteroApi.startImportCollectionJob({
        collection_id: collectionId,
        notebook_ids: selectedNotebookId ? [selectedNotebookId] : [],
        embed: true,
        skip_existing: skipExisting,
      })

      const nextJobStatus: ZoteroImportJobStatusResponse = {
        job_id: job.job_id,
        status: 'new',
        args: {
          collection_id: collectionId,
          notebook_ids: selectedNotebookId ? [selectedNotebookId] : [],
          embed: true,
          skip_existing: skipExisting,
        },
        progress: {
          phase: 'queued',
          collection_id: collectionId,
          collection_name: selectedCollection?.name,
          total: selectedCollection?.pdf_count ?? 0,
          processed: 0,
          imported: 0,
          skipped: 0,
          failed: 0,
          percentage: 0,
          current_item: null,
          current_index: null,
          item_phase: null,
          item_phase_index: null,
          item_phase_total: null,
          item_phase_percentage: null,
        },
      }
      setImportJobStatus(nextJobStatus)
      setImportJobs((prev) => upsertImportJob(prev, nextJobStatus))
      startZoteroImportPolling(job.job_id)
      await loadImportJobs()
    } catch (err) {
      console.error('Failed to import from Zotero:', err)
      stopZoteroImportPolling()
      setImporting(false)
      persistActiveImportJob(null)
      toast.error('Failed to import from Zotero')
    }
  }, [collections, loadImportJobs, persistActiveImportJob, selectedCollectionId, selectedNotebookId, skipExisting, startZoteroImportPolling, stopZoteroImportPolling])

  const handleCancelImportJob = useCallback(async (jobId: string) => {
    try {
      const response = await zoteroApi.cancelImportCollectionJob(jobId)
      setImportJobStatus((prev) => {
        if (!prev || prev.job_id !== jobId) return prev
        return {
          ...prev,
          cancel_requested: response.cancel_requested || prev.cancel_requested,
          progress: prev.progress ? {
            ...prev.progress,
            phase: 'cancel_requested',
            cancel_requested: true,
          } : prev.progress,
        }
      })
      setImportJobs((prev) => prev.map((job) => (
        job.job_id === jobId
          ? {
              ...job,
              cancel_requested: response.cancel_requested || job.cancel_requested,
              progress: job.progress ? {
                ...job.progress,
                phase: 'cancel_requested',
                cancel_requested: true,
              } : job.progress,
            }
          : job
      )))
      toast.success(response.cancel_requested ? 'Cancellation requested' : 'Import job already finished')
      void pollZoteroImportJob(jobId)
    } catch (err) {
      console.error('Failed to cancel Zotero import job:', err)
      toast.error('Failed to cancel Zotero import job')
    }
  }, [pollZoteroImportJob])

  const handleRetryImportJob = useCallback(async (jobId: string) => {
    try {
      const originalJob = importJobs.find((job) => job.job_id === jobId)
      const job = await zoteroApi.retryImportCollectionJob(jobId)

      if (originalJob?.args?.collection_id) {
        setSelectedCollectionId(String(originalJob.args.collection_id))
      }
      setSelectedNotebookId(originalJob?.args?.notebook_ids?.[0] || '')
      setSkipExisting(originalJob?.args?.skip_existing ?? true)
      setShowZoteroPanel(true)
      setImporting(true)

      const nextJobStatus: ZoteroImportJobStatusResponse = {
        job_id: job.job_id,
        status: 'new',
        args: originalJob?.args,
        progress: {
          phase: 'queued',
          collection_id: originalJob?.args?.collection_id,
          collection_name: originalJob?.progress?.collection_name || originalJob?.result?.collection_name || null,
          total: originalJob?.progress?.total ?? originalJob?.result?.total ?? 0,
          processed: 0,
          imported: 0,
          skipped: 0,
          failed: 0,
          percentage: 0,
          current_item: null,
          current_index: null,
          item_phase: null,
          item_phase_index: null,
          item_phase_total: null,
          item_phase_percentage: null,
        },
      }
      setImportJobStatus(nextJobStatus)
      setImportJobs((prev) => upsertImportJob(prev, nextJobStatus))
      startZoteroImportPolling(job.job_id)
      await loadImportJobs()
      toast.success('Retry job submitted')
    } catch (err) {
      console.error('Failed to retry Zotero import job:', err)
      toast.error('Failed to retry Zotero import job')
    }
  }, [importJobs, loadImportJobs, startZoteroImportPolling])

  const getImportCollectionName = useCallback((job: ZoteroImportJobStatusResponse) => {
    const collectionId = job.progress?.collection_id ?? job.args?.collection_id
    const mappedCollection = typeof collectionId === 'number'
      ? collections.find((collection) => collection.id === collectionId)
      : null
    return (
      job.progress?.collection_name ||
      job.result?.collection_name ||
      mappedCollection?.name ||
      (collectionId ? `Collection ${collectionId}` : 'Unknown collection')
    )
  }, [collections])

  const getImportNotebookLabel = useCallback((job: ZoteroImportJobStatusResponse) => {
    const notebookIds = job.args?.notebook_ids || []
    if (notebookIds.length === 0) return 'No notebook'
    const notebookNames = notebookIds.map((notebookId) => (
      notebooks.find((notebook) => notebook.id === notebookId)?.name || notebookId
    ))
    return notebookNames.join(', ')
  }, [notebooks])

  const getImportStatusVariant = useCallback((status: string) => {
    switch (status) {
      case 'completed': return 'default' as const
      case 'failed':
      case 'canceled': return 'destructive' as const
      default: return 'secondary' as const
    }
  }, [])

  const getItemPhaseLabel = useCallback((phase?: string | null) => {
    switch (phase) {
      case 'checking_existing': return 'Checking duplicates'
      case 'converting_pdf': return 'Converting PDF'
      case 'creating_source': return 'Creating markdown source'
      default: return null
    }
  }, [])

  return {
    // State
    collections,
    importing,
    loadingCollections,
    showZoteroPanel,
    selectedCollectionId,
    selectedNotebookId,
    skipExisting,
    importJobStatus,
    importJobs,
    loadingImportJobs,
    notebooks,

    // Setters
    setShowZoteroPanel,
    setSelectedCollectionId,
    setSelectedNotebookId,
    setSkipExisting,

    // Actions
    handleImportFromZotero,
    handleCancelImportJob,
    handleRetryImportJob,

    // Helpers
    getImportCollectionName,
    getImportNotebookLabel,
    getImportStatusVariant,
    getItemPhaseLabel,
  }
}
