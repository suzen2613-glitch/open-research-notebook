'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { modelsApi } from '@/lib/api/models'
import { sourcesApi } from '@/lib/api/sources'
import { sourceEvidenceApi } from '@/lib/api/source-evidence'
import { insightsApi, SourceInsightResponse } from '@/lib/api/insights'
import { transformationsApi } from '@/lib/api/transformations'
import { embeddingApi } from '@/lib/api/embedding'
import { SourceDetailResponse, SourceEmbeddingResponse } from '@/lib/types/api'
import { Transformation } from '@/lib/types/transformations'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { InlineEdit } from '@/components/common/InlineEdit'
import { MarkdownImage } from '@/components/ui/markdown-image'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Link as LinkIcon,
  Upload,
  AlignLeft,
  ExternalLink,
  Download,
  Copy,
  CheckCircle,
  Youtube,
  MoreVertical,
  Trash2,
  Sparkles,
  Plus,
  Lightbulb,
  Database,
  AlertCircle,
  MessageSquare,
  RefreshCw,
  Quote,
  FileText,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { getDateLocale } from '@/lib/utils/date-locale'
import { toast } from 'sonner'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useModelDefaults, useModels, useProviders } from '@/lib/hooks/use-models'
import { SourceInsightDialog } from '@/components/source/SourceInsightDialog'
import { SourceEvidenceDialog } from '@/components/source/SourceEvidenceDialog'
import { NotebookAssociations } from '@/components/source/NotebookAssociations'
import { useModalManager } from '@/lib/hooks/use-modal-manager'
import { convertReferencesToCompactMarkdown, createCompactReferenceLinkComponent } from '@/lib/utils/source-references'

const PAPER_GUIDE_TITLE = 'Paper Guide'

const STUDIO_PRESET_DEFINITIONS = [
  {
    id: 'paper-guide',
    title: PAPER_GUIDE_TITLE,
    prompt: `# TASK
Create a durable paper guide for this source.

# HOW TO WORK
- Use the full source text in INPUT and the structured evidence appendix in {{ evidence_context }}.
- Base every claim only on the source.
- If the source does not provide something, write "Not stated in the source."
- Prefer evidence citations in the form [source_embedding:id].
- Every substantive paragraph or bullet must end with at least one citation.

# OUTPUT
## One-Sentence Takeaway

## Research Question

## Core Approach

## Evidence And Evaluation

## Main Findings

## Limitations

## Open Questions For Follow-Up`,
  },
  {
    id: 'faq',
    title: 'Paper FAQ',
    prompt: `# TASK
Write an FAQ for this paper.

# HOW TO WORK
- Use INPUT plus {{ evidence_context }}.
- Keep answers concise and factual.
- Every answer must cite at least one [source_embedding:id].
- If an answer cannot be supported, say "Not stated in the source."

# OUTPUT
Produce 6-8 question and answer pairs covering:
- What problem is being solved?
- What method or argument is proposed?
- What evidence supports it?
- What are the main results?
- What are the main limitations?
- Who should read this paper?`,
  },
  {
    id: 'reviewer-questions',
    title: 'Reviewer Questions',
    prompt: `# TASK
Act like a rigorous paper reviewer and generate sharp review questions.

# HOW TO WORK
- Use INPUT plus {{ evidence_context }} only.
- Focus on assumptions, missing ablations, threats to validity, dataset or benchmark choices, and unclear claims.
- Each question must include a short reason and citation.

# OUTPUT
## Major Questions
- Question
  Reason

## Minor Questions
- Question
  Reason`,
  },
  {
    id: 'method-results-matrix',
    title: 'Method Results Matrix',
    prompt: `# TASK
Summarize the paper as a compact matrix.

# HOW TO WORK
- Use INPUT plus {{ evidence_context }}.
- Only include information stated in the source.
- Every row must include at least one [source_embedding:id].

# OUTPUT
Create a markdown table with columns:
| Aspect | Summary | Evidence |

Cover at least:
- Problem
- Inputs / data
- Method
- Experimental setup
- Main metrics
- Best result
- Limitation`,
  },
] as const

interface SourceDetailContentProps {
  sourceId: string
  showChatButton?: boolean
  onChatClick?: () => void
  onClose?: () => void
}

type SelectedInsightState = {
  id: string
  insight_type?: string
  content?: string
  created?: string
  source_id?: string
}

export function SourceDetailContent({
  sourceId,
  showChatButton = false,
  onChatClick,
  onClose
}: SourceDetailContentProps) {
  const { t, language } = useTranslation()
  const { data: models = [] } = useModels()
  const { data: modelDefaults } = useModelDefaults()
  const { data: providerAvailability } = useProviders()
  const queryClient = useQueryClient()
  const { openModal } = useModalManager()
  const [source, setSource] = useState<SourceDetailResponse | null>(null)
  const [insights, setInsights] = useState<SourceInsightResponse[]>([])
  const [evidence, setEvidence] = useState<SourceEmbeddingResponse[]>([])
  const [transformations, setTransformations] = useState<Transformation[]>([])
  const [selectedTransformation, setSelectedTransformation] = useState<string>('')
  const [customInsightTitle, setCustomInsightTitle] = useState('')
  const [customInsightPrompt, setCustomInsightPrompt] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingInsights, setLoadingInsights] = useState(false)
  const [loadingEvidence, setLoadingEvidence] = useState(false)
  const [creatingInsight, setCreatingInsight] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [isEmbedding, setIsEmbedding] = useState(false)
  const [isDownloadingFile, setIsDownloadingFile] = useState(false)
  const [fileAvailable, setFileAvailable] = useState<boolean | null>(null)
  const [selectedInsight, setSelectedInsight] = useState<SelectedInsightState | null>(null)
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null)
  const [insightToDelete, setInsightToDelete] = useState<string | null>(null)
  const [deletingInsight, setDeletingInsight] = useState(false)
  const [refreshingInsightId, setRefreshingInsightId] = useState<string | null>(null)

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

  const preferredInsightModelId = useMemo(
    () => {
      const candidateModels = availableLanguageModels
      const preferredIds = [
        modelDefaults?.default_transformation_model,
        modelDefaults?.default_chat_model,
      ].filter((value): value is string => Boolean(value))

      for (const preferredId of preferredIds) {
        if (candidateModels.some((model) => model.id === preferredId)) {
          return preferredId
        }
      }

      return candidateModels[0]?.id
    },
    [
      availableLanguageModels,
      modelDefaults?.default_chat_model,
      modelDefaults?.default_transformation_model,
    ]
  )

  const resolveInsightModelId = useCallback(() => {
    if (preferredInsightModelId) {
      return preferredInsightModelId
    }

    toast.error(
      'No usable language model is configured. Open Settings -> Models and configure a working provider and default transformation/chat model.'
    )
    return null
  }, [preferredInsightModelId])

  const getInsightErrorMessage = useCallback((error: unknown) => {
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

  const validateInsightModel = useCallback(async (modelId: string) => {
    try {
      const result = await modelsApi.testModel(modelId)
      if (result.success) {
        return true
      }

      toast.error(result.message || t.apiErrors.pleaseConfigureModels)
      return false
    } catch (error) {
      toast.error(getInsightErrorMessage(error))
      return false
    }
  }, [getInsightErrorMessage, t.apiErrors.pleaseConfigureModels])

  const fetchSource = useCallback(async () => {
    try {
      setLoading(true)
      const data = await sourcesApi.get(sourceId)
      setSource(data)
      if (typeof data.file_available === 'boolean') {
        setFileAvailable(data.file_available)
      } else if (!data.asset?.file_path) {
        setFileAvailable(null)
      } else {
        setFileAvailable(null)
      }
    } catch (err) {
      console.error('Failed to fetch source:', err)
      setError(t.sources.loadFailed)
    } finally {
      setLoading(false)
    }
  }, [sourceId, t])

  const fetchInsights = useCallback(async () => {
    try {
      setLoadingInsights(true)
      const data = await insightsApi.listForSource(sourceId)
      setInsights(data)
    } catch (err) {
      console.error('Failed to fetch insights:', err)
    } finally {
      setLoadingInsights(false)
    }
  }, [sourceId])

  const fetchEvidence = useCallback(async () => {
    try {
      setLoadingEvidence(true)
      const data = await sourceEvidenceApi.listForSource(sourceId, 12)
      setEvidence(data)
    } catch (err) {
      console.error('Failed to fetch evidence:', err)
      setEvidence([])
    } finally {
      setLoadingEvidence(false)
    }
  }, [sourceId])

  const fetchTransformations = useCallback(async () => {
    try {
      const data = await transformationsApi.list()
      setTransformations(data)
    } catch (err) {
      console.error('Failed to fetch transformations:', err)
    }
  }, [])

  useEffect(() => {
    if (sourceId) {
      void fetchSource()
      void fetchInsights()
      void fetchEvidence()
      void fetchTransformations()
    }
  }, [fetchEvidence, fetchInsights, fetchSource, fetchTransformations, sourceId])

  const trackInsightCommand = useCallback((commandId?: string) => {
    if (commandId) {
      void insightsApi.waitForCommand(commandId, {
        maxAttempts: 120,
        intervalMs: 2000
      }).then(result => {
        if (result.success) {
          void fetchInsights()
          void fetchEvidence()
          void queryClient.invalidateQueries({ queryKey: ['sources'] })
        } else if (result.errorMessage) {
          toast.error(result.errorMessage)
        } else {
          toast.error(t.common.error)
        }
      }).catch(err => {
        console.error('Error waiting for insight command:', err)
        toast.error(t.common.error)
      })
      return
    }

    window.setTimeout(() => {
      void fetchInsights()
      void fetchEvidence()
      void queryClient.invalidateQueries({ queryKey: ['sources'] })
    }, 5000)
  }, [fetchEvidence, fetchInsights, queryClient, t.common.error])

  const createInsight = async () => {
    if (!selectedTransformation) {
      toast.error(t.sources.selectTransformation)
      return
    }

    const modelId = resolveInsightModelId()
    if (!modelId) {
      return
    }

    try {
      setCreatingInsight(true)
      const isModelValid = await validateInsightModel(modelId)
      if (!isModelValid) {
        return
      }
      const response = await insightsApi.create(sourceId, {
        transformation_id: selectedTransformation,
        model_id: modelId,
      })
      toast.success(t.sources.insightGenerationStarted)
      setSelectedTransformation('')
      trackInsightCommand(response.command_id)
    } catch (err) {
      console.error('Failed to create insight:', err)
      toast.error(getInsightErrorMessage(err))
    } finally {
      setCreatingInsight(false)
    }
  }

  const createCustomInsight = async () => {
    const trimmedTitle = customInsightTitle.trim()
    const trimmedPrompt = customInsightPrompt.trim()

    if (!trimmedTitle) {
      toast.error(t.sources.customInsightTitleRequired)
      return
    }
    if (!trimmedPrompt) {
      toast.error(t.sources.customInsightPromptRequired)
      return
    }

    const modelId = resolveInsightModelId()
    if (!modelId) {
      return
    }

    try {
      setCreatingInsight(true)
      const isModelValid = await validateInsightModel(modelId)
      if (!isModelValid) {
        return
      }
      const response = await insightsApi.create(sourceId, {
        title: trimmedTitle,
        prompt: trimmedPrompt,
        model_id: modelId,
      })
      toast.success(t.sources.insightGenerationStarted)
      setCustomInsightTitle('')
      setCustomInsightPrompt('')
      trackInsightCommand(response.command_id)
    } catch (err) {
      console.error('Failed to create custom insight:', err)
      toast.error(getInsightErrorMessage(err))
    } finally {
      setCreatingInsight(false)
    }
  }

  const studioPresets = useMemo(() => ([
    {
      ...STUDIO_PRESET_DEFINITIONS[0],
      label: t.sources.paperGuide,
      description: t.sources.paperGuideDesc,
    },
    {
      ...STUDIO_PRESET_DEFINITIONS[1],
      label: t.sources.paperFaq,
      description: t.sources.paperFaqDesc,
    },
    {
      ...STUDIO_PRESET_DEFINITIONS[2],
      label: t.sources.reviewerQuestions,
      description: t.sources.reviewerQuestionsDesc,
    },
    {
      ...STUDIO_PRESET_DEFINITIONS[3],
      label: t.sources.methodResultsMatrix,
      description: t.sources.methodResultsMatrixDesc,
    },
  ]), [t])

  const runStudioPreset = async (title: string, prompt: string) => {
    const modelId = resolveInsightModelId()
    if (!modelId) {
      return
    }

    try {
      setCreatingInsight(true)
      const isModelValid = await validateInsightModel(modelId)
      if (!isModelValid) {
        return
      }
      const response = await insightsApi.create(sourceId, { title, prompt, model_id: modelId })
      toast.success(t.sources.insightGenerationStarted)
      trackInsightCommand(response.command_id)
    } catch (err) {
      console.error('Failed to create studio insight:', err)
      toast.error(getInsightErrorMessage(err))
    } finally {
      setCreatingInsight(false)
    }
  }

  const handleRefreshInsight = async (insightId: string) => {
    const modelId = resolveInsightModelId()
    if (!modelId) {
      return
    }

    try {
      setRefreshingInsightId(insightId)
      const isModelValid = await validateInsightModel(modelId)
      if (!isModelValid) {
        return
      }
      const response = await insightsApi.refresh(insightId, modelId)
      toast.success(t.sources.insightRefreshStarted)
      trackInsightCommand(response.command_id)
    } catch (err) {
      console.error('Failed to refresh insight:', err)
      toast.error(getInsightErrorMessage(err))
    } finally {
      setRefreshingInsightId(null)
    }
  }

  const handleDeleteInsight = async (e?: React.MouseEvent) => {
    e?.preventDefault()
    if (!insightToDelete) return

    try {
      setDeletingInsight(true)
      await insightsApi.delete(insightToDelete)
      toast.success(t.common.success)
      setInsightToDelete(null)
      await fetchInsights()
      await fetchEvidence()
    } catch (err) {
      console.error('Failed to delete insight:', err)
      toast.error(t.common.error)
    } finally {
      setDeletingInsight(false)
    }
  }

  const handleUpdateTitle = async (title: string) => {
    if (!source || title === source.title) return

    try {
      await sourcesApi.update(sourceId, { title })
      toast.success(t.common.success)
      setSource({ ...source, title })
    } catch (err) {
      console.error('Failed to update source title:', err)
      toast.error(t.common.error)
      await fetchSource()
    }
  }

  const handleEmbedContent = async () => {
    if (!source) return

    try {
      setIsEmbedding(true)
      const response = await embeddingApi.embedContent(sourceId, 'source')
      toast.success(response.message || t.common.success)
      await fetchSource()
      await fetchEvidence()
    } catch (err) {
      console.error('Failed to embed content:', err)
      toast.error(t.common.error)
    } finally {
      setIsEmbedding(false)
    }
  }

  const extractFilename = (pathOrUrl: string | undefined, fallback: string) => {
    if (!pathOrUrl) {
      return fallback
    }
    const segments = pathOrUrl.split(/[/\\]/)
    return segments.pop() || fallback
  }

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
      locale: getDateLocale(language)
    })
  }, [language, parseValidDate, t.common.unknown])

  const formatAbsoluteDate = useCallback((value?: string | null) => {
    const date = parseValidDate(value)
    return date ? date.toLocaleString() : t.common.unknown
  }, [parseValidDate, t.common.unknown])

  const parseContentDisposition = (header?: string | null) => {
    if (!header) {
      return null
    }
    const match = header.match(/filename\*?=([^;]+)/i)
    if (!match) {
      return null
    }
    const value = match[1].trim()
    if (value.toLowerCase().startsWith("utf-8''")) {
      return decodeURIComponent(value.slice(7))
    }
    return value.replace(/^["']|["']$/g, '')
  }

  const handleDownloadFile = async () => {
    if (!source?.asset?.file_path || isDownloadingFile || fileAvailable === false) {
      return
    }

    try {
      setIsDownloadingFile(true)
      const response = await sourcesApi.downloadFile(source.id)
      const filenameFromHeader = parseContentDisposition(
        response.headers?.['content-disposition'] as string | undefined
      )
      const fallbackName = extractFilename(source.asset.file_path, `source-${source.id}`)
      const filename = filenameFromHeader || fallbackName

      const blobUrl = window.URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = blobUrl
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(blobUrl)
      setFileAvailable(true)
      toast.success(t.common.success)
    } catch (err) {
      console.error('Failed to download file:', err)
      if (isAxiosError(err) && err.response?.status === 404) {
        setFileAvailable(false)
        toast.error(t.sources.fileUnavailable)
      } else {
        toast.error(t.common.error)
      }
    } finally {
      setIsDownloadingFile(false)
    }
  }

  const getSourceIcon = () => {
    if (!source) return null
    if (source.asset?.url) return <LinkIcon className="h-5 w-5" />
    if (source.asset?.file_path) return <Upload className="h-5 w-5" />
    return <AlignLeft className="h-5 w-5" />
  }

  const getSourceType = () => {
    if (!source) return 'unknown'
    if (source.asset?.url) return 'link'
    if (source.asset?.file_path) return 'file'
    return 'text'
  }

  const handleCopyUrl = useCallback(() => {
    if (source?.asset?.url) {
      navigator.clipboard.writeText(source.asset.url)
      setCopied(true)
      toast.success(t.sources.urlCopied)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [source, t])

  const handleOpenExternal = useCallback(() => {
    if (source?.asset?.url) {
      window.open(source.asset.url, '_blank')
    }
  }, [source])

  const getYouTubeVideoId = (url: string): string | null => {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
      /youtube\.com\/watch\?.*v=([^&\n?#]+)/
    ]

    for (const pattern of patterns) {
      const match = url.match(pattern)
      if (match) return match[1]
    }
    return null
  }

  const isYouTubeUrl = useMemo(() => {
    if (!source?.asset?.url) return false
    return !!(getYouTubeVideoId(source.asset.url))
  }, [source?.asset?.url])

  const youTubeVideoId = useMemo(() => {
    if (!source?.asset?.url) return null
    return getYouTubeVideoId(source.asset.url)
  }, [source?.asset?.url])

  const handleDelete = async () => {
    if (!source) return

    if (confirm(t.sources.deleteSourceConfirm || t.common.confirm)) {
      try {
        await sourcesApi.delete(source.id)
        toast.success(t.common.success)
        onClose?.()
      } catch (error) {
        console.error('Failed to delete source:', error)
        toast.error(t.common.error)
      }
    }
  }

  const latestInsightByTitle = useMemo(() => {
    const entries = new Map<string, SourceInsightResponse>()
    for (const insight of insights) {
      const key = insight.prompt_title || insight.insight_type
      if (!entries.has(key)) {
        entries.set(key, insight)
      }
    }
    return entries
  }, [insights])

  const paperGuideInsight = latestInsightByTitle.get(PAPER_GUIDE_TITLE) ?? null

  const guideMarkdown = useMemo(() => (
    paperGuideInsight
      ? convertReferencesToCompactMarkdown(paperGuideInsight.content, t.common.references)
      : ''
  ), [paperGuideInsight, t.common.references])

  const handleReferenceClick = useCallback((type: string, id: string) => {
    if (type === 'source_embedding') {
      setSelectedEvidenceId(id)
      return
    }
    if (type === 'source_insight') {
      setSelectedInsight({ id, content: '', insight_type: '' })
      return
    }
    if (type === 'source') {
      const normalizedCurrentId = sourceId.includes(':') ? sourceId : `source:${sourceId}`
      const normalizedClickedId = id.includes(':') ? id : `source:${id}`
      if (normalizedClickedId === normalizedCurrentId) {
        return
      }
    }
    const modalType = type === 'source_insight'
      ? 'insight'
      : type === 'source_embedding'
        ? 'evidence'
        : type as 'source' | 'note' | 'insight' | 'evidence'
    openModal(modalType, id)
  }, [openModal, sourceId])

  const GuideLinkComponent = useMemo(
    () => createCompactReferenceLinkComponent(handleReferenceClick),
    [handleReferenceClick]
  )

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <LoadingSpinner />
      </div>
    )
  }

  if (error || !source) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
        <p className="text-red-500">{error || t.sources.notFound}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="pb-4 px-2">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <InlineEdit
              value={source.title || ''}
              onSave={handleUpdateTitle}
              className="text-2xl font-bold"
              inputClassName="text-2xl font-bold"
              placeholder={t.sources.titlePlaceholder}
              emptyText={t.sources.untitledSource}
            />
            <p className="mt-1 text-sm text-muted-foreground">
              {t.sources.id}: {source.id}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {getSourceIcon()}
            <Badge variant="secondary" className="text-sm">
              {getSourceType()}
            </Badge>

            {/* Chat with source button - only in modal */}
            {showChatButton && onChatClick && (
              <Button variant="outline" size="sm" onClick={onChatClick}>
                <MessageSquare className="h-4 w-4 mr-2" />
                {t.chat.chatWith.replace('{name}', t.navigation.sources)}
              </Button>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {source.asset?.file_path && (
                  <>
                    <DropdownMenuItem
                      onClick={handleDownloadFile}
                      disabled={isDownloadingFile || fileAvailable === false}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      {fileAvailable === false
                        ? t.sources.fileUnavailable
                        : isDownloadingFile
                          ? t.sources.preparing
                          : t.sources.downloadFile}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem
                  onClick={handleEmbedContent}
                  disabled={isEmbedding || source.embedded}
                >
                  <Database className="mr-2 h-4 w-4" />
                  {isEmbedding ? t.sources.embedding : source.embedded ? t.sources.alreadyEmbedded : t.sources.embedContent}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={handleDelete}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t.sources.deleteSource}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* Tabs Content */}
      <div className="flex-1 overflow-y-auto px-2">
        <Tabs defaultValue="guide" className="w-full">
          <TabsList className="grid w-full grid-cols-4 sticky top-0 z-10">
            <TabsTrigger value="guide">{t.sources.guide}</TabsTrigger>
            <TabsTrigger value="content">{t.sources.content}</TabsTrigger>
            <TabsTrigger value="studio">
              {t.sources.studio} {insights.length > 0 && `(${insights.length})`}
            </TabsTrigger>
            <TabsTrigger value="details">{t.sources.details}</TabsTrigger>
          </TabsList>

          <TabsContent value="guide" className="mt-6">
            <div className="grid gap-6 xl:grid-cols-[1.45fr_1fr]">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2">
                      <FileText className="h-5 w-5" />
                      {t.sources.paperGuide}
                    </span>
                    {paperGuideInsight ? (
                      <Badge variant="secondary">
                        {formatRelativeDate(paperGuideInsight.updated)}
                      </Badge>
                    ) : null}
                  </CardTitle>
                  <CardDescription>{t.sources.paperGuideDesc}</CardDescription>
                </CardHeader>
                <CardContent>
                  {!paperGuideInsight ? (
                    <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                      <FileText className="mx-auto mb-3 h-10 w-10 opacity-50" />
                      <p>{t.sources.paperGuideEmpty}</p>
                      <Button
                        className="mt-4"
                        onClick={() => void runStudioPreset(
                          STUDIO_PRESET_DEFINITIONS[0].title,
                          STUDIO_PRESET_DEFINITIONS[0].prompt
                        )}
                        disabled={creatingInsight}
                      >
                        {creatingInsight ? (
                          <>
                            <LoadingSpinner className="mr-2 h-3 w-3" />
                            {t.common.creating}
                          </>
                        ) : (
                          <>
                            <Sparkles className="mr-2 h-4 w-4" />
                            {t.sources.generateGuide}
                          </>
                        )}
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSelectedInsight(paperGuideInsight)}
                        >
                          {t.sources.viewInsight}
                        </Button>
                        {paperGuideInsight.can_refresh ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void handleRefreshInsight(paperGuideInsight.id)}
                            disabled={refreshingInsightId === paperGuideInsight.id}
                          >
                            {refreshingInsightId === paperGuideInsight.id ? (
                              <>
                                <LoadingSpinner className="mr-2 h-3 w-3" />
                                {t.sources.refreshingInsight}
                              </>
                            ) : (
                              <>
                                <RefreshCw className="mr-2 h-3.5 w-3.5" />
                                {t.sources.refreshInsight}
                              </>
                            )}
                          </Button>
                        ) : null}
                      </div>

                      <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none break-words prose-p:leading-7">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            a: GuideLinkComponent,
                            img: ({ src, alt, ...props }) => (
                              <MarkdownImage
                                {...props}
                                src={src}
                                alt={alt}
                                className="my-4 max-w-full rounded-md"
                              />
                            ),
                            table: ({ children }) => (
                              <div className="my-4 overflow-x-auto">
                                <table className="min-w-full border-collapse border border-border">{children}</table>
                              </div>
                            ),
                            thead: ({ children }) => <thead className="bg-muted">{children}</thead>,
                            tbody: ({ children }) => <tbody>{children}</tbody>,
                            tr: ({ children }) => <tr className="border-b border-border">{children}</tr>,
                            th: ({ children }) => <th className="border border-border px-3 py-2 text-left font-semibold">{children}</th>,
                            td: ({ children }) => <td className="border border-border px-3 py-2">{children}</td>,
                          }}
                        >
                          {guideMarkdown}
                        </ReactMarkdown>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Quote className="h-5 w-5" />
                    {t.sources.evidenceTrail}
                  </CardTitle>
                  <CardDescription>{t.sources.evidenceTrailDesc}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {loadingEvidence ? (
                    <div className="flex items-center justify-center py-8">
                      <LoadingSpinner />
                    </div>
                  ) : evidence.length === 0 ? (
                    <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                      <Quote className="mx-auto mb-3 h-10 w-10 opacity-50" />
                      <p>{t.sources.noEvidenceYet}</p>
                      {!source.embedded ? (
                        <Button
                          variant="outline"
                          className="mt-4"
                          onClick={handleEmbedContent}
                          disabled={isEmbedding}
                        >
                          <Database className="mr-2 h-4 w-4" />
                          {isEmbedding ? t.sources.embedding : t.sources.embedContent}
                        </Button>
                      ) : null}
                    </div>
                  ) : (
                    evidence.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setSelectedEvidenceId(item.id)}
                        className="w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted/50"
                      >
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          {item.section ? <Badge variant="secondary">{item.section}</Badge> : null}
                          {typeof item.order === 'number' ? (
                            <Badge variant="outline">
                              {t.sources.chunkLabel.replace('{number}', String(item.order + 1))}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="line-clamp-4 text-sm text-muted-foreground">{item.content}</p>
                      </button>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="content" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {isYouTubeUrl && <Youtube className="h-5 w-5" />}
                  {t.sources.content}
                </CardTitle>
                {source.asset?.url && !isYouTubeUrl && (
                  <CardDescription className="flex items-center gap-2">
                    <LinkIcon className="h-4 w-4" />
                    <a
                      href={source.asset.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline text-blue-600"
                    >
                      {source.asset.url}
                    </a>
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent>
                {isYouTubeUrl && youTubeVideoId && (
                  <div className="mb-6">
                    <div className="aspect-video rounded-lg overflow-hidden bg-black">
                      <iframe
                        src={`https://www.youtube.com/embed/${youTubeVideoId}`}
                        title={t.common.accessibility.ytVideo}
                        className="w-full h-full"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      />
                    </div>
                    {source.asset?.url && (
                      <div className="mt-2">
                        <a
                          href={source.asset.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1"
                        >
                          <ExternalLink className="h-3 w-3" />
                          {t.sources.openOnYoutube}
                        </a>
                      </div>
                    )}
                  </div>
                )}
                <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none prose-headings:font-semibold prose-a:text-blue-600 prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-p:mb-4 prose-p:leading-7 prose-li:mb-2">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      p: ({ children }) => <p className="mb-4">{children}</p>,
                      h1: ({ children }) => <h1 className="text-2xl font-bold mt-6 mb-4">{children}</h1>,
                      h2: ({ children }) => <h2 className="text-xl font-bold mt-5 mb-3">{children}</h2>,
                      h3: ({ children }) => <h3 className="text-lg font-semibold mt-4 mb-2">{children}</h3>,
                      ul: ({ children }) => <ul className="mb-4 list-disc pl-6">{children}</ul>,
                      ol: ({ children }) => <ol className="mb-4 list-decimal pl-6">{children}</ol>,
                      li: ({ children }) => <li className="mb-1">{children}</li>,
                      img: ({ src, alt, ...props }) => (
                        <MarkdownImage
                          {...props}
                          src={src}
                          alt={alt}
                          className="my-4 max-w-full rounded-md"
                        />
                      ),
                      table: ({ children }) => (
                        <div className="my-4 overflow-x-auto">
                          <table className="min-w-full border-collapse border border-border">{children}</table>
                        </div>
                      ),
                      thead: ({ children }) => <thead className="bg-muted">{children}</thead>,
                      tbody: ({ children }) => <tbody>{children}</tbody>,
                      tr: ({ children }) => <tr className="border-b border-border">{children}</tr>,
                      th: ({ children }) => <th className="border border-border px-3 py-2 text-left font-semibold">{children}</th>,
                      td: ({ children }) => <td className="border border-border px-3 py-2">{children}</td>,
                    }}
                  >
                    {source.full_text || t.sources.noContent}
                  </ReactMarkdown>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="studio" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Lightbulb className="h-5 w-5" />
                    {t.sources.studio}
                  </span>
                  <Badge variant="secondary">{insights.length}</Badge>
                </CardTitle>
                <CardDescription>
                  {t.sources.studioDesc}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-lg border bg-muted/30 p-4">
                  <Label className="mb-3 flex items-center gap-2 text-sm font-semibold">
                    <Sparkles className="h-4 w-4" />
                    {t.sources.studioPresets}
                  </Label>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {studioPresets.map((preset) => {
                      const latestInsight = latestInsightByTitle.get(preset.title)
                      return (
                        <div key={preset.id} className="rounded-md border bg-background p-4">
                          <div className="space-y-2">
                            <p className="text-sm font-medium">{preset.label}</p>
                            <p className="text-xs text-muted-foreground">{preset.description}</p>
                            {latestInsight ? (
                              <Badge variant="outline" className="text-[10px] uppercase">
                                {t.sources.latestStudioOutput}
                              </Badge>
                            ) : null}
                          </div>
                          <div className="mt-4 flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              onClick={() => void runStudioPreset(preset.title, preset.prompt)}
                              disabled={creatingInsight}
                            >
                              {creatingInsight ? (
                                <>
                                  <LoadingSpinner className="mr-2 h-3 w-3" />
                                  {t.common.creating}
                                </>
                              ) : (
                                <>
                                  <Sparkles className="mr-2 h-4 w-4" />
                                  {latestInsight ? t.common.refresh : t.common.create}
                                </>
                              )}
                            </Button>
                            {latestInsight ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setSelectedInsight(latestInsight)}
                              >
                                {t.sources.viewInsight}
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Create New Insight */}
                <div className="rounded-lg border bg-muted/30 p-4">
                  <Label
                    htmlFor="transformation-select"
                    className="mb-3 flex items-center gap-2 text-sm font-semibold"
                  >
                    <Sparkles className="h-4 w-4" />
                    {t.sources.studioBuilder}
                  </Label>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="rounded-md border bg-background p-4">
                      <div className="mb-3 space-y-1">
                        <p className="text-sm font-medium">{t.sources.transformationInsight}</p>
                        <p className="text-xs text-muted-foreground">
                          {t.sources.transformationInsightDesc}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Select
                          name="transformation"
                          value={selectedTransformation}
                          onValueChange={setSelectedTransformation}
                          disabled={creatingInsight}
                        >
                          <SelectTrigger id="transformation-select" className="flex-1">
                            <SelectValue placeholder={t.sources.selectTransformation} />
                          </SelectTrigger>
                          <SelectContent>
                            {transformations.map((trans) => (
                              <SelectItem key={trans.id} value={trans.id}>
                                {trans.title || trans.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          size="sm"
                          onClick={createInsight}
                          disabled={!selectedTransformation || creatingInsight}
                        >
                          {creatingInsight ? (
                            <>
                              <LoadingSpinner className="mr-2 h-3 w-3" />
                              {t.common.creating}
                            </>
                          ) : (
                            <>
                              <Plus className="mr-2 h-4 w-4" />
                              {t.common.create}
                            </>
                          )}
                        </Button>
                      </div>
                    </div>

                    <div className="rounded-md border bg-background p-4">
                      <div className="mb-3 space-y-1">
                        <p className="text-sm font-medium">{t.sources.customInsight}</p>
                        <p className="text-xs text-muted-foreground">
                          {t.sources.customInsightDesc}
                        </p>
                      </div>
                      <div className="space-y-3">
                        <Input
                          value={customInsightTitle}
                          onChange={(event) => setCustomInsightTitle(event.target.value)}
                          placeholder={t.sources.customInsightTitlePlaceholder}
                          disabled={creatingInsight}
                        />
                        <Textarea
                          value={customInsightPrompt}
                          onChange={(event) => setCustomInsightPrompt(event.target.value)}
                          placeholder={t.sources.customInsightPromptPlaceholder}
                          disabled={creatingInsight}
                          rows={6}
                        />
                        <div className="flex justify-end">
                          <Button
                            size="sm"
                            onClick={createCustomInsight}
                            disabled={!customInsightTitle.trim() || !customInsightPrompt.trim() || creatingInsight}
                          >
                            {creatingInsight ? (
                              <>
                                <LoadingSpinner className="mr-2 h-3 w-3" />
                                {t.common.creating}
                              </>
                            ) : (
                              <>
                                <Sparkles className="mr-2 h-4 w-4" />
                                {t.sources.createCustomInsight}
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Insights List */}
                {loadingInsights ? (
                  <div className="flex items-center justify-center py-8">
                    <LoadingSpinner />
                  </div>
                ) : insights.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Lightbulb className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p className="text-sm">{t.sources.noInsightsYet}</p>
                    <p className="text-xs mt-1">{t.sources.createFirstInsight}</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {insights.map((insight) => (
                      <div key={insight.id} className="rounded-lg border bg-background p-4">
                        <div className="flex items-start justify-between">
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-medium">
                                {insight.prompt_title || insight.insight_type}
                              </p>
                              <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
                                {insight.transformation_id ? t.sources.transformationInsight : t.sources.customInsight}
                              </Badge>
                            </div>
                            <Badge variant="outline" className="text-xs uppercase">
                              {insight.insight_type}
                            </Badge>
                          </div>
                        </div>
                        <p className="mt-2 text-sm text-muted-foreground">
                          {insight.content.slice(0, 180)}{insight.content.length > 180 ? '…' : ''}
                        </p>
                        <div className="mt-3 flex justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => setSelectedInsight(insight)}>
                            {t.sources.viewInsight}
                          </Button>
                          {insight.can_refresh ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void handleRefreshInsight(insight.id)}
                              disabled={refreshingInsightId === insight.id}
                            >
                              {refreshingInsightId === insight.id ? (
                                <>
                                  <LoadingSpinner className="mr-2 h-3 w-3" />
                                  {t.sources.refreshingInsight}
                                </>
                              ) : (
                                <>
                                  <RefreshCw className="mr-2 h-3.5 w-3.5" />
                                  {t.sources.refreshInsight}
                                </>
                              )}
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setInsightToDelete(insight.id)}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="details" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>{t.sources.details}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Embedding Alert */}
                {!source.embedded && (
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>
                      {t.sources.notEmbeddedAlert}
                    </AlertTitle>
                    <AlertDescription>
                      {t.sources.notEmbeddedDesc}
                      <div className="mt-3">
                        <Button
                          onClick={handleEmbedContent}
                          disabled={isEmbedding}
                          size="sm"
                        >
                          <Database className="mr-2 h-4 w-4" />
                          {isEmbedding ? t.sources.embedding : t.sources.embedContent}
                        </Button>
                      </div>
                    </AlertDescription>
                  </Alert>
                )}

                {/* Source Information */}
                <div className="space-y-4">
                  {source.asset?.url && (
                    <div>
                      <h3 className="mb-2 text-sm font-semibold">{t.common.url}</h3>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 rounded bg-muted px-2 py-1 text-sm">
                          {source.asset.url}
                        </code>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleCopyUrl}
                        >
                          {copied ? (
                            <CheckCircle className="h-4 w-4" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleOpenExternal}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}

                  {source.asset?.file_path && (
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold">{t.sources.uploadedFile}</h3>
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="rounded bg-muted px-2 py-1 text-sm">
                          {source.asset.file_path}
                        </code>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleDownloadFile}
                          disabled={isDownloadingFile || fileAvailable === false}
                        >
                          <Download className="mr-2 h-4 w-4" />
                          {fileAvailable === false
                            ? t.sources.fileUnavailable
                            : isDownloadingFile
                              ? t.sources.preparing
                              : t.common.download}
                        </Button>
                      </div>
                      {fileAvailable === false ? (
                        <p className="text-xs text-muted-foreground">
                          {t.sources.fileUnavailableDesc}
                        </p>
                      ) : null}
                    </div>
                  )}

                  {source.topics && source.topics.length > 0 && (
                    <div>
                      <h3 className="mb-2 text-sm font-semibold">{t.sources.topics}</h3>
                      <div className="flex flex-wrap gap-2">
                        {source.topics.map((topic, idx) => (
                          <Badge key={idx} variant="outline">
                            {topic}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Metadata */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold">{t.sources.metadata}</h3>
                    <div className="flex items-center gap-2">
                      <Database className="h-3.5 w-3.5 text-muted-foreground" />
                      <Badge variant={source.embedded ? "default" : "secondary"} className="text-xs">
                        {source.embedded ? t.sources.embedded : t.sources.notEmbedded}
                      </Badge>
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">{t.common.created_label}</p>
                      <p className="text-sm">{formatRelativeDate(source.created)}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatAbsoluteDate(source.created)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">{t.common.updated_label}</p>
                      <p className="text-sm">{formatRelativeDate(source.updated)}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatAbsoluteDate(source.updated)}
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Notebook Associations */}
            <NotebookAssociations
              sourceId={sourceId}
              currentNotebookIds={source.notebooks || []}
              onSave={fetchSource}
            />
          </TabsContent>
        </Tabs>
      </div>

      <SourceInsightDialog
        open={Boolean(selectedInsight)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedInsight(null)
          }
        }}
        insight={selectedInsight ?? undefined}
        onDelete={async (insightId) => {
          try {
            await insightsApi.delete(insightId)
            toast.success(t.common.success)
            setSelectedInsight(null)
            await fetchInsights()
          } catch (err) {
            console.error('Failed to delete insight:', err)
            toast.error(t.common.error)
          }
        }}
      />

      <SourceEvidenceDialog
        open={Boolean(selectedEvidenceId)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedEvidenceId(null)
          }
        }}
        embeddingId={selectedEvidenceId}
      />

      <AlertDialog open={!!insightToDelete} onOpenChange={() => setInsightToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.sources.deleteInsight}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.sources.deleteInsightConfirm}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingInsight}>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                onClick={handleDeleteInsight}
                disabled={deletingInsight}
                variant="destructive"
              >
                {deletingInsight ? t.common.deleting : t.common.delete}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
