'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { AlertTriangle, FileText, Quote, RefreshCw } from 'lucide-react'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MarkdownImage } from '@/components/ui/markdown-image'
import { useModalManager } from '@/lib/hooks/use-modal-manager'
import { useRefreshWikiCard } from '@/lib/hooks/use-wiki-cards'
import { type EvidenceSnippetResponse, type SourceWikiCardResponse } from '@/lib/api/wiki-cards'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/hooks/use-translation'

interface WikiCardDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  wikiCard?: SourceWikiCardResponse | null
  title: string
  sourceLabel: string
}

function getConfidenceBadgeTone(confidence?: number | null) {
  if (typeof confidence !== 'number') {
    return 'border-muted-foreground/30 bg-muted text-muted-foreground'
  }

  if (confidence > 0.75) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300'
  }

  if (confidence >= 0.5) {
    return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300'
  }

  return 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300'
}

function formatConfidence(confidence?: number | null, unavailableLabel = 'Unavailable') {
  if (typeof confidence !== 'number') {
    return unavailableLabel
  }

  return `${Math.round(confidence * 100)}%`
}

function EvidenceSnippetCard({
  snippet,
  sourceId,
  onOpenDetail,
  onOpenSource,
  t,
}: {
  snippet: EvidenceSnippetResponse
  sourceId?: string | null
  onOpenDetail: (embeddingId: string) => void
  onOpenSource: (snippet: EvidenceSnippetResponse) => void
  t: ReturnType<typeof useTranslation>['t']
}) {
  const hasCharRange =
    typeof snippet.char_start === 'number' && typeof snippet.char_end === 'number'
  return (
    <Card className="border-muted transition-colors hover:border-primary/30 hover:bg-muted/20">
      <CardHeader className="gap-3 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {snippet.section || t.wikiCards.unknownSection}
          </Badge>
          <Badge variant="secondary" className="text-xs">
            {hasCharRange
              ? t.sources.charRange.replace('{start}', String(snippet.char_start)).replace('{end}', String(snippet.char_end))
              : t.wikiCards.rangeUnavailable}
          </Badge>
        </div>
        <CardTitle className="text-sm font-medium leading-6 text-foreground/90">
          {snippet.excerpt}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t.wikiCards.match}
          </p>
          <p className="text-sm text-muted-foreground">{snippet.reason}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onOpenDetail(snippet.embedding_id)}
          >
            <Quote className="mr-1.5 h-3 w-3" />
            {t.wikiCards.openChunk}
          </Button>
          {sourceId && hasCharRange && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onOpenSource(snippet)}
            >
              <FileText className="mr-1.5 h-3 w-3" />
              {t.wikiCards.jumpToSource}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export function WikiCardDialog({
  open,
  onOpenChange,
  wikiCard,
  title,
  sourceLabel,
}: WikiCardDialogProps) {
  const { t } = useTranslation()
  const { openModal } = useModalManager()
  const refreshCard = useRefreshWikiCard()
  const evidenceSnippets = (wikiCard?.evidence_snippets ?? []).slice(0, 4)
  const hasEvidenceGap =
    !!wikiCard && wikiCard.status === 'completed' && evidenceSnippets.length === 0
  const canRefresh = !!wikiCard?.id

  const openEvidence = (embeddingId: string) => {
    openModal('evidence', embeddingId)
  }

  const openSourceAtSnippet = (snippet: EvidenceSnippetResponse) => {
    if (!wikiCard?.source_id) return
    const hasRange =
      typeof snippet.char_start === 'number' && typeof snippet.char_end === 'number'
    openModal(
      'source',
      wikiCard.source_id,
      hasRange
        ? { anchor: { start: snippet.char_start as number, end: snippet.char_end as number } }
        : undefined
    )
  }

  const handleRegenerate = () => {
    if (!wikiCard?.id) return
    refreshCard.mutate({ wikiCardId: wikiCard.id })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-2">
            <span>{title}</span>
            <div className="flex items-center gap-2">
              {wikiCard?.status && (
                <Badge variant="outline" className="text-xs uppercase">
                  {wikiCard.status}
                </Badge>
              )}
              {wikiCard?.source_id && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openModal('source', wikiCard.source_id)}
                  className="gap-1"
                >
                  <FileText className="h-3 w-3" />
                  {sourceLabel}
                </Button>
              )}
            </div>
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="wiki-card" className="flex-1 min-h-0">
          <TabsList className="w-full justify-start">
            <TabsTrigger value="wiki-card">{t.wikiCards.wikiCard}</TabsTrigger>
            <TabsTrigger value="source-evidence">{t.wikiCards.sourceEvidence}</TabsTrigger>
          </TabsList>

          <TabsContent value="wiki-card" className="min-h-0 overflow-y-auto pr-1">
            {wikiCard && (
              <div className="mb-4 flex flex-wrap gap-2">
                {wikiCard.paper_type && (
                  <Badge variant="secondary" className="text-xs">
                    {wikiCard.paper_type}
                  </Badge>
                )}
                {wikiCard.is_key_paper && (
                  <Badge variant="default" className="text-xs">
                    {t.wikiCards.keyPaper}
                  </Badge>
                )}
                {wikiCard.domains.map(domain => (
                  <Badge key={domain} variant="outline" className="text-xs">
                    {domain}
                  </Badge>
                ))}
              </div>
            )}
            {wikiCard && (wikiCard.research_context || wikiCard.claimed_gap || wikiCard.positioning_summary) && (
              <div className="mb-4 grid gap-3 md:grid-cols-3">
                {wikiCard.research_context && (
                  <Card className="border-muted">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">{t.wikiCards.researchContext}</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">
                      {wikiCard.research_context}
                    </CardContent>
                  </Card>
                )}
                {wikiCard.claimed_gap && (
                  <Card className="border-muted">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">{t.wikiCards.claimedGap}</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">
                      {wikiCard.claimed_gap}
                    </CardContent>
                  </Card>
                )}
                {wikiCard.positioning_summary && (
                  <Card className="border-muted">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">{t.wikiCards.positioning}</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">
                      {wikiCard.positioning_summary}
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
            {wikiCard?.obsidian_markdown ? (
              <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
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
                  {wikiCard.obsidian_markdown}
                </ReactMarkdown>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t.wikiCards.noExportYet}</p>
            )}
          </TabsContent>

          <TabsContent value="source-evidence" className="min-h-0 overflow-y-auto pr-1">
            <div className="space-y-4">
              <Card className="border-muted">
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <CardTitle className="text-base">{t.wikiCards.sourceEvidence}</CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {t.wikiCards.sourceEvidenceDesc}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant="outline"
                        className={cn('text-xs font-medium', getConfidenceBadgeTone(wikiCard?.extraction_confidence))}
                      >
                        {t.wikiCards.confidence.replace('{value}', formatConfidence(wikiCard?.extraction_confidence, t.wikiCards.unavailable))}
                      </Badge>
                      {canRefresh && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1"
                          onClick={handleRegenerate}
                          disabled={refreshCard.isPending}
                        >
                          <RefreshCw className={cn('h-3.5 w-3.5', refreshCard.isPending && 'animate-spin')} />
                          {refreshCard.isPending ? t.wikiCards.starting : t.wikiCards.regenerate}
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
              </Card>

              {hasEvidenceGap && (
                <Card className="border-amber-200 bg-amber-50/70 dark:border-amber-900/50 dark:bg-amber-950/30">
                  <CardContent className="flex items-start gap-3 py-4">
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                    <div className="space-y-1 text-sm">
                      <p className="font-medium text-amber-900 dark:text-amber-200">
                        {t.wikiCards.noEvidenceTrail}
                      </p>
                      <p className="text-amber-800/80 dark:text-amber-300/80">
                        {t.wikiCards.noEvidenceTrailDesc}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {evidenceSnippets.length > 0 ? (
                <div className="space-y-3">
                  {evidenceSnippets.map((snippet, index) => (
                    <div key={`${snippet.embedding_id}-${index}`} className="space-y-2">
                      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        <Quote className="h-3.5 w-3.5" />
                        {t.wikiCards.evidence.replace('{index}', String(index + 1))}
                      </div>
                      <EvidenceSnippetCard
                        snippet={snippet}
                        sourceId={wikiCard?.source_id}
                        onOpenDetail={openEvidence}
                        onOpenSource={openSourceAtSnippet}
                        t={t}
                      />
                    </div>
                  ))}
                </div>
              ) : !hasEvidenceGap ? (
                <Card className="border-dashed border-muted">
                  <CardContent className="py-8 text-sm text-muted-foreground">
                    {t.wikiCards.noEvidenceSnippets}
                  </CardContent>
                </Card>
              ) : null}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
