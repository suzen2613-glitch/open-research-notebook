import { useQuery } from '@tanstack/react-query'

import { wikiCardsApi } from '@/lib/api/wiki-cards'
import { QUERY_KEYS } from '@/lib/api/query-client'

export function useNotebookWikiCards(notebookId?: string, options?: { enabled?: boolean }) {
  const resolvedNotebookId = notebookId ?? ''
  const enabled = !!resolvedNotebookId && (options?.enabled ?? true)

  return useQuery({
    queryKey: QUERY_KEYS.wikiCards(resolvedNotebookId),
    queryFn: () => wikiCardsApi.list(resolvedNotebookId),
    enabled,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  })
}

export function useSourceWikiCard(sourceId?: string) {
  const resolvedSourceId = sourceId ?? ''

  return useQuery({
    queryKey: QUERY_KEYS.sourceWikiCard(resolvedSourceId),
    queryFn: () => wikiCardsApi.getForSource(resolvedSourceId),
    enabled: !!resolvedSourceId,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  })
}
