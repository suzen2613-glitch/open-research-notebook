'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { sourcesApi } from '@/lib/api/sources'
import {
  zoteroApi,
  ZoteroCollectionResponse,
  ZoteroImportJobStatusResponse,
  ZoteroImportResponse,
} from '@/lib/api/zotero'
import { SourceListResponse } from '@/lib/types/api'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { EmptyState } from '@/components/common/EmptyState'
import { AppShell } from '@/components/layout/AppShell'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { FileText, Link as LinkIcon, Upload, AlignLeft, Trash2, ArrowUpDown, Database, Loader2, History, RotateCcw, Square } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useNotebooks } from '@/lib/hooks/use-notebooks'
import { getDateLocale } from '@/lib/utils/date-locale'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { getApiErrorKey } from '@/lib/utils/error-handler'

const ACTIVE_ZOTERO_IMPORT_JOB_STORAGE_KEY = 'open-notebook:zotero-import-active-job'

function upsertImportJob(
  jobs: ZoteroImportJobStatusResponse[],
  nextJob: ZoteroImportJobStatusResponse
) {
  const remaining = jobs.filter((job) => job.job_id !== nextJob.job_id)
  return [nextJob, ...remaining].slice(0, 10)
}

export default function SourcesPage() {
  const { t, language } = useTranslation()
  const [sources, setSources] = useState<SourceListResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [sortBy, setSortBy] = useState<'created' | 'updated'>('updated')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; source: SourceListResponse | null }>({
    open: false,
    source: null
  })
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
  const router = useRouter()
  const { data: notebooks = [] } = useNotebooks()
  const tableRef = useRef<HTMLTableElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const offsetRef = useRef(0)
  const loadingMoreRef = useRef(false)
  const hasMoreRef = useRef(true)
  const zoteroImportPollRef = useRef<number | null>(null)
  const PAGE_SIZE = 30

  const persistActiveImportJob = useCallback((jobId: string | null) => {
    if (typeof window === 'undefined') {
      return
    }

    if (jobId) {
      window.localStorage.setItem(ACTIVE_ZOTERO_IMPORT_JOB_STORAGE_KEY, jobId)
      return
    }

    window.localStorage.removeItem(ACTIVE_ZOTERO_IMPORT_JOB_STORAGE_KEY)
  }, [])

  const fetchSources = useCallback(async (reset = false) => {
    try {
      // Check flags before proceeding
      if (!reset && (loadingMoreRef.current || !hasMoreRef.current)) {
        return
      }

      if (reset) {
        setLoading(true)
        offsetRef.current = 0
        setSources([])
        hasMoreRef.current = true
      } else {
        loadingMoreRef.current = true
        setLoadingMore(true)
      }

      const data = await sourcesApi.list({
        limit: PAGE_SIZE,
        offset: offsetRef.current,
        sort_by: sortBy,
        sort_order: sortOrder,
      })

      if (reset) {
        setSources(data)
      } else {
        setSources(prev => [...prev, ...data])
      }

      // Check if we have more data
      const hasMoreData = data.length === PAGE_SIZE
      hasMoreRef.current = hasMoreData
      offsetRef.current += data.length
    } catch (err) {
      console.error('Failed to fetch sources:', err)
      setError(t.sources.failedToLoad)
      toast.error(t.sources.failedToLoad)
    } finally {
      setLoading(false)
      setLoadingMore(false)
      loadingMoreRef.current = false
    }
  }, [sortBy, sortOrder, t.sources.failedToLoad])

  // Initial load and when sort changes
  useEffect(() => {
    fetchSources(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy, sortOrder])

  useEffect(() => {
    // Focus the table when component mounts or sources change
    if (sources.length > 0 && tableRef.current) {
      tableRef.current.focus()
    }
  }, [sources])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (sources.length === 0) return

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((prev) => {
            const newIndex = Math.min(prev + 1, sources.length - 1)
            // Scroll to keep selected row visible
            setTimeout(() => scrollToSelectedRow(newIndex), 0)
            return newIndex
          })
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((prev) => {
            const newIndex = Math.max(prev - 1, 0)
            // Scroll to keep selected row visible
            setTimeout(() => scrollToSelectedRow(newIndex), 0)
            return newIndex
          })
          break
        case 'Enter':
          e.preventDefault()
          if (sources[selectedIndex]) {
            router.push(`/sources/${sources[selectedIndex].id}`)
          }
          break
        case 'Home':
          e.preventDefault()
          setSelectedIndex(0)
          setTimeout(() => scrollToSelectedRow(0), 0)
          break
        case 'End':
          e.preventDefault()
          const lastIndex = sources.length - 1
          setSelectedIndex(lastIndex)
          setTimeout(() => scrollToSelectedRow(lastIndex), 0)
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [sources, selectedIndex, router])

  const scrollToSelectedRow = (index: number) => {
    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) return

    // Find the selected row element
    const rows = scrollContainer.querySelectorAll('tbody tr')
    const selectedRow = rows[index] as HTMLElement
    if (!selectedRow) return

    const containerRect = scrollContainer.getBoundingClientRect()
    const rowRect = selectedRow.getBoundingClientRect()

    // Check if row is above visible area
    if (rowRect.top < containerRect.top) {
      selectedRow.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    // Check if row is below visible area
    else if (rowRect.bottom > containerRect.bottom) {
      selectedRow.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }

  // Set up scroll listener after sources are loaded
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) return

    let scrollTimeout: NodeJS.Timeout | null = null

    const handleScroll = () => {
      if (scrollTimeout) {
        clearTimeout(scrollTimeout)
      }

      scrollTimeout = setTimeout(() => {
        if (!scrollContainerRef.current) return

        const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current
        const distanceFromBottom = scrollHeight - scrollTop - clientHeight

        // Load more when within 200px of the bottom
        if (distanceFromBottom < 200 && !loadingMoreRef.current && hasMoreRef.current) {
          fetchSources(false)
        }
      }, 100)
    }

    scrollContainer.addEventListener('scroll', handleScroll)
    handleScroll() // Check on mount

    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll)
      if (scrollTimeout) {
        clearTimeout(scrollTimeout)
      }
    }
  }, [fetchSources, sources.length])

  const toggleSort = (field: 'created' | 'updated') => {
    if (sortBy === field) {
      // Toggle order if clicking the same field
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      // Switch to new field with default desc order
      setSortBy(field)
      setSortOrder('desc')
    }
  }

  const getSourceIcon = (source: SourceListResponse) => {
    if (source.asset?.url) return <LinkIcon className="h-4 w-4" />
    if (source.asset?.file_path) return <Upload className="h-4 w-4" />
    return <AlignLeft className="h-4 w-4" />
  }

  const getSourceType = (source: SourceListResponse) => {
    if (source.asset?.url) return t.sources.type.link
    if (source.asset?.file_path) return t.sources.type.file
    return t.sources.type.text
  }

  const handleRowClick = useCallback((index: number, sourceId: string) => {
    setSelectedIndex(index)
    router.push(`/sources/${sourceId}`)
  }, [router])


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

  useEffect(() => {
    void loadCollections()
  }, [loadCollections])

  useEffect(() => {
    void loadImportJobs()
  }, [loadImportJobs])

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
      await fetchSources(true)
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
      await fetchSources(true)
      await loadImportJobs()
      return
    }

    const errorMessage =
      statusData.error_message ||
      statusData.progress?.error_message ||
      'Zotero import failed'
    toast.error(errorMessage)
    await fetchSources(true)
    await loadImportJobs()
  }, [fetchSources, loadImportJobs, persistActiveImportJob, stopZoteroImportPolling])

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
    return () => {
      stopZoteroImportPolling()
    }
  }, [stopZoteroImportPolling])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const storedJobId = window.localStorage.getItem(ACTIVE_ZOTERO_IMPORT_JOB_STORAGE_KEY)
    if (!storedJobId) {
      return
    }

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
      setImportJobStatus({
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
      })
      setImportJobs((prev) => upsertImportJob(prev, {
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
      }))
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
        if (!prev || prev.job_id !== jobId) {
          return prev
        }
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

  const handleDeleteClick = useCallback((e: React.MouseEvent, source: SourceListResponse) => {
    e.stopPropagation() // Prevent row click
    setDeleteDialog({ open: true, source })
  }, [])

  const handleDeleteConfirm = async () => {
    if (!deleteDialog.source) return

    try {
      await sourcesApi.delete(deleteDialog.source.id)
      toast.success(t.sources.deleteSuccess)
      // Remove the deleted source from the list
      setSources(prev => prev.filter(s => s.id !== deleteDialog.source?.id))
      setDeleteDialog({ open: false, source: null })
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } }, message?: string };
      console.error('Failed to delete source:', error)
      toast.error(t(getApiErrorKey(error.response?.data?.detail || error.message)))
    }
  }

  const getImportCollectionName = (job: ZoteroImportJobStatusResponse) => {
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
  }

  const getImportNotebookLabel = (job: ZoteroImportJobStatusResponse) => {
    const notebookIds = job.args?.notebook_ids || []
    if (notebookIds.length === 0) {
      return 'No notebook'
    }

    const notebookNames = notebookIds.map((notebookId) => (
      notebooks.find((notebook) => notebook.id === notebookId)?.name || notebookId
    ))
    return notebookNames.join(', ')
  }

  const getImportStatusVariant = (status: string) => {
    switch (status) {
      case 'completed':
        return 'default' as const
      case 'failed':
      case 'canceled':
        return 'destructive' as const
      default:
        return 'secondary' as const
    }
  }

  const getItemPhaseLabel = (phase?: string | null) => {
    switch (phase) {
      case 'checking_existing':
        return 'Checking duplicates'
      case 'converting_pdf':
        return 'Converting PDF'
      case 'creating_source':
        return 'Creating markdown source'
      default:
        return null
    }
  }

  if (loading) {
    return (
      <AppShell>
        <div className="flex h-full items-center justify-center">
          <LoadingSpinner />
        </div>
      </AppShell>
    )
  }

  if (error) {
    return (
      <AppShell>
        <div className="flex h-full items-center justify-center">
          <p className="text-red-500">{error}</p>
        </div>
      </AppShell>
    )
  }

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
    <AppShell>
      <div className="flex flex-col h-full w-full max-w-none px-6 py-6">
        <div className="mb-6 flex-shrink-0 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">{t.sources.allSources}</h1>
            <p className="mt-2 text-muted-foreground">
              {t.sources.allSourcesDesc}
            </p>
          </div>
          <Button onClick={() => setShowZoteroPanel((v) => !v)} disabled={importing || loadingCollections}>
            {importing || loadingCollections ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Database className="h-4 w-4 mr-2" />}
            Import from Zotero
          </Button>
        </div>



      {showZoteroPanel && (
        <div className="mb-4 rounded-lg border p-4 space-y-4 bg-background">
          <div>
            <h2 className="text-lg font-semibold">Import from Zotero</h2>
            <p className="text-sm text-muted-foreground">
              Choose a Zotero collection and optionally a target notebook.
              Re-importing into another notebook now links existing sources instead of silently doing nothing.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Zotero Collection</Label>
              <Select value={selectedCollectionId} onValueChange={setSelectedCollectionId}>
                <SelectTrigger>
                  <SelectValue placeholder={loadingCollections ? 'Loading collections...' : 'Choose a collection'} />
                </SelectTrigger>
                <SelectContent>
                  {collections.map((collection) => (
                    <SelectItem key={collection.id} value={String(collection.id)}>
                      {collection.name} ({collection.pdf_count} PDFs)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Target Notebook (optional)</Label>
              <Select value={selectedNotebookId || '__none__'} onValueChange={(value) => setSelectedNotebookId(value === '__none__' ? '' : value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Import without assigning a notebook" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No notebook</SelectItem>
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
            <Label htmlFor="skip-existing">Skip already imported items</Label>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowZoteroPanel(false)} disabled={importing}>Cancel</Button>
            <Button onClick={() => void handleImportFromZotero()} disabled={importing || !selectedCollectionId}>
              {importing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Database className="h-4 w-4 mr-2" />}
              Import Collection
            </Button>
          </div>

          {importJobStatus && (
            <div className="space-y-3 rounded-md border bg-muted/30 p-4">
              <div className="flex items-center justify-between gap-4 text-sm">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Current Import</span>
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
                  {zoteroImportProcessed} / {zoteroImportTotal || '—'} processed
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
                <span>{zoteroImportProgress?.imported ?? zoteroImportResult?.imported ?? 0} imported</span>
                <span>{zoteroImportProgress?.skipped ?? zoteroImportResult?.skipped ?? 0} skipped</span>
                <span>{zoteroImportProgress?.failed ?? zoteroImportResult?.failed ?? 0} failed</span>
                {importJobStatus.cancel_requested && importJobStatus.status !== 'canceled' && (
                  <span>Cancellation requested</span>
                )}
              </div>

              {zoteroImportProgress?.current_item && importJobStatus.status === 'running' && (
                <p className="text-xs text-muted-foreground truncate">
                  Current: {zoteroImportProgress.current_item}
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
                    {importJobStatus.cancel_requested ? 'Cancel Requested' : 'Cancel Import'}
                  </Button>
                </div>
              )}

              {zoteroImportFailedItems.length > 0 && (
                <div className="space-y-2 rounded-md border border-destructive/20 bg-background p-3">
                  <p className="text-xs font-medium text-destructive">Failed items</p>
                  {zoteroImportFailedItems.slice(0, 5).map((item) => (
                    <div key={`${item.attachment_key || item.title}-${item.error || 'error'}`} className="text-xs">
                      <p className="font-medium">{item.title}</p>
                      {item.error && <p className="text-muted-foreground">{item.error}</p>}
                    </div>
                  ))}
                  {zoteroImportFailedItems.length > 5 && (
                    <p className="text-xs text-muted-foreground">
                      {zoteroImportFailedItems.length - 5} more failed item(s) are available in the job result.
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
                <span className="font-medium">Recent Import Jobs</span>
              </div>
              {loadingImportJobs && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>

            {importJobs.length === 0 && !loadingImportJobs && (
              <p className="text-sm text-muted-foreground">No import jobs yet.</p>
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
                          {job.cancel_requested ? 'Cancel Requested' : 'Cancel'}
                        </Button>
                      )}
                      {canRetry && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void handleRetryImportJob(job.job_id)}
                        >
                          <RotateCcw className="mr-2 h-3.5 w-3.5" />
                          Retry
                        </Button>
                      )}
                    </div>
                  </div>

                  <Progress value={percent} className="h-1.5" />

                  <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                    <span>{processed} / {total || '—'} processed</span>
                    <span>{progress?.imported ?? result?.imported ?? 0} imported</span>
                    <span>{progress?.skipped ?? result?.skipped ?? 0} skipped</span>
                    <span>{progress?.failed ?? result?.failed ?? 0} failed</span>
                    {job.cancel_requested && job.status !== 'canceled' && <span>Cancellation requested</span>}
                  </div>

                  {progress?.current_item && job.status === 'running' && (
                    <p className="text-xs text-muted-foreground truncate">
                      Current: {progress.current_item}
                    </p>
                  )}

                  {failedItems.length > 0 && (
                    <div className="space-y-1 rounded-md border border-destructive/20 bg-muted/20 p-2">
                      <p className="text-xs font-medium text-destructive">Failed items</p>
                      {failedItems.slice(0, 3).map((item) => (
                        <div key={`${job.job_id}-${item.attachment_key || item.title}`} className="text-xs">
                          <p className="font-medium">{item.title}</p>
                          {item.error && <p className="text-muted-foreground">{item.error}</p>}
                        </div>
                      ))}
                      {failedItems.length > 3 && (
                        <p className="text-xs text-muted-foreground">
                          {failedItems.length - 3} more failed item(s) omitted.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

        {sources.length === 0 ? (
          <div className="flex-1 rounded-md border">
            <EmptyState
              icon={FileText}
              title={t.sources.noSourcesYet}
              description={t.sources.allSourcesDescShort}
            />
          </div>
        ) : (
          <div ref={scrollContainerRef} className="flex-1 rounded-md border overflow-auto">
            <table
              ref={tableRef}
              tabIndex={0}
              className="w-full min-w-[800px] outline-none table-fixed"
            >
              <colgroup>
                <col className="w-[120px]" />
                <col className="w-auto" />
                <col className="w-[140px]" />
                <col className="w-[100px]" />
                <col className="w-[100px]" />
                <col className="w-[100px]" />
              </colgroup>
              <thead className="sticky top-0 bg-background z-10">
                <tr className="border-b bg-muted/50">
                  <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                    {t.common.type}
                  </th>
                  <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                    {t.common.title}
                  </th>
                  <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground hidden sm:table-cell">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleSort('created')}
                      className="h-8 px-2 hover:bg-muted"
                    >
                      {t.common.created_label}
                      <ArrowUpDown className={cn(
                        "ml-2 h-3 w-3",
                        sortBy === 'created' ? 'opacity-100' : 'opacity-30'
                      )} />
                      {sortBy === 'created' && (
                        <span className="ml-1 text-xs">
                          {sortOrder === 'asc' ? '↑' : '↓'}
                        </span>
                      )}
                    </Button>
                  </th>
                  <th className="h-12 px-4 text-center align-middle font-medium text-muted-foreground hidden md:table-cell">
                    {t.sources.insights}
                  </th>
                  <th className="h-12 px-4 text-center align-middle font-medium text-muted-foreground hidden lg:table-cell">
                    {t.sources.embedded}
                  </th>
                  <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">
                    {t.common.actions}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sources.map((source, index) => (
                  <tr
                    key={source.id}
                    onClick={() => handleRowClick(index, source.id)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={cn(
                      "border-b transition-colors cursor-pointer",
                      selectedIndex === index
                        ? "bg-accent"
                        : "hover:bg-muted/50"
                    )}
                  >
                    <td className="h-12 px-4">
                      <div className="flex items-center gap-2">
                        {getSourceIcon(source)}
                        <Badge variant="secondary" className="text-xs">
                          {getSourceType(source)}
                        </Badge>
                      </div>
                    </td>
                    <td className="h-12 px-4">
                      <div className="flex flex-col overflow-hidden">
                        <span className="font-medium truncate">
                          {source.title || t.sources.untitledSource}
                        </span>
                        {source.asset?.url && (
                          <span className="text-xs text-muted-foreground truncate">
                            {source.asset.url}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="h-12 px-4 text-muted-foreground text-sm hidden sm:table-cell">
                      {formatDistanceToNow(new Date(source.created), {
                        addSuffix: true,
                        locale: getDateLocale(language)
                      })}
                    </td>
                    <td className="h-12 px-4 text-center hidden md:table-cell">
                      <span className="text-sm font-medium">{source.insights_count || 0}</span>
                    </td>
                    <td className="h-12 px-4 text-center hidden lg:table-cell">
                      <Badge variant={source.embedded ? "default" : "secondary"} className="text-xs">
                        {source.embedded ? t.sources.yes : t.sources.no}
                      </Badge>
                    </td>
                    <td className="h-12 px-4 text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => handleDeleteClick(e, source)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
                {loadingMore && (
                  <tr>
                    <td colSpan={6} className="h-16 text-center">
                      <div className="flex items-center justify-center">
                        <LoadingSpinner />
                        <span className="ml-2 text-muted-foreground">{t.sources.loadingMore}</span>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>


      <ConfirmDialog
        open={deleteDialog.open}
        onOpenChange={(open) => setDeleteDialog({ open, source: deleteDialog.source })}
        title={t.sources.delete}
        description={t.sources.deleteConfirmWithTitle.replace('{title}', deleteDialog.source?.title || t.sources.untitledSource)}
        confirmText={t.common.delete}
        confirmVariant="destructive"
        onConfirm={handleDeleteConfirm}
      />
    </AppShell>
  )
}
