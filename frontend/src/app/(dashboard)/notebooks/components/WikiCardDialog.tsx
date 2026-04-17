'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { FileText } from 'lucide-react'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { MarkdownImage } from '@/components/ui/markdown-image'
import { useModalManager } from '@/lib/hooks/use-modal-manager'
import { type SourceWikiCardResponse } from '@/lib/api/wiki-cards'

interface WikiCardDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  wikiCard?: SourceWikiCardResponse | null
  title: string
  sourceLabel: string
}

export function WikiCardDialog({
  open,
  onOpenChange,
  wikiCard,
  title,
  sourceLabel,
}: WikiCardDialogProps) {
  const { openModal } = useModalManager()

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

        <div className="flex-1 overflow-y-auto min-h-0">
          {wikiCard && (
            <div className="mb-4 flex flex-wrap gap-2">
              {wikiCard.paper_type && (
                <Badge variant="secondary" className="text-xs">
                  {wikiCard.paper_type}
                </Badge>
              )}
              {wikiCard.is_key_paper && (
                <Badge variant="default" className="text-xs">
                  Key paper
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
                    <CardTitle className="text-sm">Research Context</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    {wikiCard.research_context}
                  </CardContent>
                </Card>
              )}
              {wikiCard.claimed_gap && (
                <Card className="border-muted">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Claimed Gap</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    {wikiCard.claimed_gap}
                  </CardContent>
                </Card>
              )}
              {wikiCard.positioning_summary && (
                <Card className="border-muted">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Positioning</CardTitle>
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
            <p className="text-sm text-muted-foreground">No export is available yet.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
