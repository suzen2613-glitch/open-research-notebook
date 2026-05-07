'use client'

import { ExternalLink } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useTranslation } from '@/lib/hooks/use-translation'
import type { SourceReferenceConnectionsResponse } from '@/lib/types/api'

interface ReferencesCardProps {
  referencesLoading: boolean
  referencesError: string | null
  referenceConnections: SourceReferenceConnectionsResponse | null
  onOpenSource: (targetSourceId: string) => void
}

export function ReferencesCard({
  referencesLoading,
  referencesError,
  referenceConnections,
  onOpenSource,
}: ReferencesCardProps) {
  const { t, language } = useTranslation()
  const isZh = language?.startsWith('zh')

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

  return (
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
                      onClick={() => onOpenSource(item.source_id)}
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
                      onClick={() => onOpenSource(item.source_id)}
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
  )
}
