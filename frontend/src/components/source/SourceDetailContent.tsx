'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { isAxiosError } from 'axios'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { sourcesApi } from '@/lib/api/sources'
import { embeddingApi } from '@/lib/api/embedding'
import { SourceDetailResponse, SourceReferenceConnectionsResponse } from '@/lib/types/api'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { InlineEdit } from '@/components/common/InlineEdit'
import { MarkdownImage } from '@/components/ui/markdown-image'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
  Database,
  AlertCircle,
  MessageSquare,
  FileText,
  BookOpenText,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { getDateLocale } from '@/lib/utils/date-locale'
import { toast } from 'sonner'
import { useTranslation } from '@/lib/hooks/use-translation'
import { NotebookAssociations } from '@/components/source/NotebookAssociations'

interface SourceDetailContentProps {
  sourceId: string
  showChatButton?: boolean
  onChatClick?: () => void
  onClose?: () => void
}

type SourceViewMode = 'markdown' | 'reading'
const SOURCE_VIEW_MODE_KEY = 'open-research-notebook:source-view-mode'

function normalizeMathDelimiters(content: string) {
  return content
    .replace(/\\\[((?:.|\n)*?)\\\]/g, (_, math: string) => `\n$$\n${math.trim()}\n$$\n`)
    .replace(/\\\(((?:.|\n)*?)\\\)/g, (_, math: string) => `$${math.trim()}$`)
}

export function SourceDetailContent({
  sourceId,
  showChatButton = false,
  onChatClick,
  onClose
}: SourceDetailContentProps) {
  const { t, language } = useTranslation()
  const isZh = language?.startsWith('zh')
  const [source, setSource] = useState<SourceDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [isEmbedding, setIsEmbedding] = useState(false)
  const [isDownloadingFile, setIsDownloadingFile] = useState(false)
  const [fileAvailable, setFileAvailable] = useState<boolean | null>(null)
  const [viewMode, setViewMode] = useState<SourceViewMode>('reading')
  const [referenceConnections, setReferenceConnections] = useState<SourceReferenceConnectionsResponse | null>(null)
  const [referencesLoading, setReferencesLoading] = useState(true)
  const [referencesError, setReferencesError] = useState<string | null>(null)

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

  const fetchReferenceConnections = useCallback(async () => {
    try {
      setReferencesLoading(true)
      setReferencesError(null)
      const data = await sourcesApi.getReferences(sourceId)
      setReferenceConnections(data)
    } catch (err) {
      console.error('Failed to fetch source references:', err)
      setReferencesError(isZh ? '参考文献关系加载失败' : 'Failed to load reference connections')
    } finally {
      setReferencesLoading(false)
    }
  }, [isZh, sourceId])

  useEffect(() => {
    if (sourceId) {
      void fetchSource()
      void fetchReferenceConnections()
    }
  }, [fetchReferenceConnections, fetchSource, sourceId])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const saved = window.localStorage.getItem(SOURCE_VIEW_MODE_KEY)
    if (saved === 'markdown' || saved === 'reading') {
      setViewMode(saved)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(SOURCE_VIEW_MODE_KEY, viewMode)
  }, [viewMode])

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

  const referencesCardTitle = isZh ? '文献关联' : 'References'
  const referencesCardDescription = isZh
    ? '从当前论文的参考文献中提取出的 notebook 内互联和候选论文。'
    : 'Notebook-internal links and candidate papers extracted from this source references.'
  const citesLabel = isZh ? '引用了 notebook 中的论文' : 'Cites in notebook'
  const citedByLabel = isZh ? '被 notebook 中的论文引用' : 'Cited by in notebook'
  const candidatesLabel = isZh ? '候选参考文献' : 'Reference candidates'
  const noConnectionsLabel = isZh ? '还没有匹配到 notebook 内部文献。' : 'No notebook connections matched yet.'
  const noCandidatesLabel = isZh ? '暂时没有可补充的候选参考文献。' : 'No unmatched reference candidates yet.'
  const noReferenceSectionLabel = isZh ? '尚未识别到参考文献区。' : 'No reference section detected yet.'
  const openPaperLabel = isZh ? '打开论文' : 'Open paper'

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

  const openRelatedSource = useCallback((targetSourceId: string) => {
    window.open(`/sources/${targetSourceId}`, '_blank')
  }, [])

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

  const renderedContent = useMemo(
    () => normalizeMathDelimiters(source?.full_text || t.sources.noContent),
    [source?.full_text, t.sources.noContent]
  )

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

  const isReadingMode = viewMode === 'reading'
  const contentWrapperClassName = isReadingMode
    ? 'mx-auto max-w-4xl break-words text-[15px] leading-8 text-foreground prose prose-neutral prose-lg dark:prose-invert prose-headings:font-semibold prose-headings:tracking-tight prose-p:mb-5 prose-p:text-[15px] prose-p:leading-8 prose-li:mb-2 prose-li:leading-7 prose-img:mx-auto prose-figure:mx-auto prose-hr:my-8 prose-blockquote:border-l-4 prose-blockquote:border-border prose-blockquote:pl-4 prose-code:rounded prose-code:bg-muted/60 prose-code:px-1 prose-code:py-0.5 prose-pre:bg-muted/70'
    : 'max-w-none break-words prose prose-sm prose-neutral dark:prose-invert prose-headings:font-semibold prose-p:mb-4 prose-p:leading-7 prose-li:mb-2 prose-a:text-blue-600 prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5'

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

      <div className="flex-1 overflow-y-auto px-2">
        <div className="space-y-6">
          {!source.embedded && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{t.sources.notEmbeddedAlert}</AlertTitle>
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

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_360px]">
            <Card className="min-w-0">
              <CardHeader className="gap-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <CardTitle className="flex items-center gap-2">
                      {isYouTubeUrl ? <Youtube className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
                      {t.sources.content}
                    </CardTitle>
                    <CardDescription className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">{getSourceType()}</Badge>
                      <Badge variant={source.embedded ? 'default' : 'secondary'}>
                        {source.embedded ? t.sources.embedded : t.sources.notEmbedded}
                      </Badge>
                      <span>{formatRelativeDate(source.updated)}</span>
                    </CardDescription>
                  </div>

                  <div className="inline-flex w-fit items-center rounded-lg border bg-muted/30 p-1">
                    <Button
                      type="button"
                      size="sm"
                      variant={viewMode === 'reading' ? 'secondary' : 'ghost'}
                      onClick={() => setViewMode('reading')}
                      className="h-8 gap-1.5 px-3"
                    >
                      <BookOpenText className="h-4 w-4" />
                      {isZh ? '阅读' : 'Reading'}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={viewMode === 'markdown' ? 'secondary' : 'ghost'}
                      onClick={() => setViewMode('markdown')}
                      className="h-8 gap-1.5 px-3"
                    >
                      <AlignLeft className="h-4 w-4" />
                      Markdown
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {isYouTubeUrl && youTubeVideoId && (
                  <div className="mb-6">
                    <div className="aspect-video overflow-hidden rounded-lg bg-black">
                      <iframe
                        src={`https://www.youtube.com/embed/${youTubeVideoId}`}
                        title={t.common.accessibility.ytVideo}
                        className="h-full w-full"
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
                          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
                        >
                          <ExternalLink className="h-3 w-3" />
                          {t.sources.openOnYoutube}
                        </a>
                      </div>
                    )}
                  </div>
                )}

                <div className={contentWrapperClassName}>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeKatex]}
                    components={{
                      p: ({ children }) => <p className="mb-4">{children}</p>,
                      h1: ({ children }) => <h1 className="mb-4 mt-6 text-2xl font-bold">{children}</h1>,
                      h2: ({ children }) => <h2 className="mb-3 mt-5 text-xl font-bold">{children}</h2>,
                      h3: ({ children }) => <h3 className="mb-2 mt-4 text-lg font-semibold">{children}</h3>,
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
                      th: ({ children }) => (
                        <th className="border border-border px-3 py-2 text-left font-semibold">{children}</th>
                      ),
                      td: ({ children }) => <td className="border border-border px-3 py-2">{children}</td>,
                    }}
                  >
                    {renderedContent}
                  </ReactMarkdown>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>{t.sources.details}</CardTitle>
                  <CardDescription>{t.sources.metadata}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {source.asset?.url && (
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold">{t.common.url}</h3>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 rounded bg-muted px-2 py-1 text-sm">
                          {source.asset.url}
                        </code>
                        <Button size="sm" variant="outline" onClick={handleCopyUrl}>
                          {copied ? <CheckCircle className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </Button>
                        <Button size="sm" variant="outline" onClick={handleOpenExternal}>
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
                          {extractFilename(source.asset.file_path, `source-${source.id}`)}
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
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold">{t.sources.topics}</h3>
                      <div className="flex flex-wrap gap-2">
                        {source.topics.map((topic, idx) => (
                          <Badge key={idx} variant="outline">
                            {topic}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">{t.common.created_label}</p>
                      <p className="text-sm">{formatRelativeDate(source.created)}</p>
                      <p className="text-xs text-muted-foreground">{formatAbsoluteDate(source.created)}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">{t.common.updated_label}</p>
                      <p className="text-sm">{formatRelativeDate(source.updated)}</p>
                      <p className="text-xs text-muted-foreground">{formatAbsoluteDate(source.updated)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{referencesCardTitle}</CardTitle>
                  <CardDescription>
                    {referencesLoading
                      ? (isZh ? '正在提取参考文献关联…' : 'Extracting reference connections...')
                      : referenceConnections
                        ? `${referenceConnections.references_extracted} ${isZh ? '条参考文献已扫描' : 'references scanned'}`
                        : referencesCardDescription}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  {referencesLoading ? (
                    <div className="space-y-3">
                      {[0, 1, 2].map((item) => (
                        <div key={item} className="space-y-2">
                          <div className="h-3 w-32 animate-pulse rounded bg-muted" />
                          <div className="h-10 animate-pulse rounded-md bg-muted/70" />
                        </div>
                      ))}
                    </div>
                  ) : referencesError ? (
                    <p className="text-sm text-muted-foreground">{referencesError}</p>
                  ) : referenceConnections ? (
                    <div className="space-y-5">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <h3 className="text-sm font-semibold">{citesLabel}</h3>
                          <Badge variant="secondary">{referenceConnections.citations_in_notebook.length}</Badge>
                        </div>
                        {referenceConnections.citations_in_notebook.length > 0 ? (
                          <div className="space-y-2">
                            {referenceConnections.citations_in_notebook.map((item) => (
                              <button
                                key={item.source_id}
                                type="button"
                                onClick={() => openRelatedSource(item.source_id)}
                                className="w-full rounded-lg border px-3 py-2 text-left transition hover:bg-muted/50"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium leading-5">{item.source_title || item.source_id}</p>
                                    {item.raw_reference ? (
                                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.raw_reference}</p>
                                    ) : null}
                                  </div>
                                  <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                                </div>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">{referenceConnections.references_extracted === 0 ? noReferenceSectionLabel : noConnectionsLabel}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <h3 className="text-sm font-semibold">{citedByLabel}</h3>
                          <Badge variant="secondary">{referenceConnections.cited_by_in_notebook.length}</Badge>
                        </div>
                        {referenceConnections.cited_by_in_notebook.length > 0 ? (
                          <div className="space-y-2">
                            {referenceConnections.cited_by_in_notebook.map((item) => (
                              <button
                                key={item.source_id}
                                type="button"
                                onClick={() => openRelatedSource(item.source_id)}
                                className="w-full rounded-lg border px-3 py-2 text-left transition hover:bg-muted/50"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium leading-5">{item.source_title || item.source_id}</p>
                                    {item.raw_reference ? (
                                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.raw_reference}</p>
                                    ) : null}
                                  </div>
                                  <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                                </div>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">{noConnectionsLabel}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <h3 className="text-sm font-semibold">{candidatesLabel}</h3>
                          <Badge variant="secondary">{referenceConnections.reference_candidates.length}</Badge>
                        </div>
                        {referenceConnections.reference_candidates.length > 0 ? (
                          <div className="space-y-2">
                            {referenceConnections.reference_candidates.map((item, index) => (
                              <div key={`${item.normalized_title || item.title || 'candidate'}-${index}`} className="rounded-lg border px-3 py-2">
                                <p className="text-sm font-medium leading-5">{item.title || item.normalized_title || openPaperLabel}</p>
                                <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{item.raw_reference}</p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">{referenceConnections.references_extracted === 0 ? noReferenceSectionLabel : noCandidatesLabel}</p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">{referencesCardDescription}</p>
                  )}
                </CardContent>
              </Card>

              <NotebookAssociations
                sourceId={sourceId}
                currentNotebookIds={source.notebooks || []}
                onSave={fetchSource}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
