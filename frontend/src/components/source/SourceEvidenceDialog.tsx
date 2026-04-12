'use client'

import { useQuery } from '@tanstack/react-query'
import { FileText, Quote } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { sourceEvidenceApi } from '@/lib/api/source-evidence'
import { useModalManager } from '@/lib/hooks/use-modal-manager'
import { useTranslation } from '@/lib/hooks/use-translation'

interface SourceEvidenceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  embeddingId: string | null
}

export function SourceEvidenceDialog({
  open,
  onOpenChange,
  embeddingId,
}: SourceEvidenceDialogProps) {
  const { t } = useTranslation()
  const { openModal } = useModalManager()

  const embeddingIdWithPrefix = embeddingId
    ? (embeddingId.includes(':') ? embeddingId : `source_embedding:${embeddingId}`)
    : ''

  const { data, isLoading } = useQuery({
    queryKey: ['source-evidence', embeddingIdWithPrefix],
    queryFn: () => sourceEvidenceApi.get(embeddingIdWithPrefix),
    enabled: open && !!embeddingIdWithPrefix,
    staleTime: 30 * 1000,
  })

  const handleViewSource = () => {
    if (data?.source_id) {
      openModal('source', data.source_id)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Quote className="h-4 w-4" />
            {t.sources.evidenceDetail}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="py-8 text-sm text-muted-foreground">{t.common.loading}</div>
        ) : !data ? (
          <div className="py-8 text-sm text-muted-foreground">{t.common.noResults}</div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{data.id}</Badge>
              {data.section ? <Badge variant="secondary">{data.section}</Badge> : null}
              {typeof data.order === 'number' ? (
                <Badge variant="secondary">
                  {t.sources.chunkLabel.replace('{number}', String(data.order + 1))}
                </Badge>
              ) : null}
              {typeof data.char_start === 'number' && typeof data.char_end === 'number' ? (
                <Badge variant="secondary">
                  {t.sources.charRange
                    .replace('{start}', String(data.char_start))
                    .replace('{end}', String(data.char_end))}
                </Badge>
              ) : null}
            </div>

            <div className="rounded-lg border bg-muted/30 p-4">
              <p className="whitespace-pre-wrap text-sm leading-7">{data.content}</p>
            </div>

            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={handleViewSource}>
                <FileText className="mr-2 h-4 w-4" />
                {t.sources.viewSource}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
