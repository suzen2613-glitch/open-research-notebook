import { useQuery } from '@tanstack/react-query'

import { wikiCardsApi } from '@/lib/api/wiki-cards'
import { QUERY_KEYS } from '@/lib/api/query-client'

export function useNotebookWikiCards(notebookId?: string) {
  const resolvedNotebookId = notebookId ?? ''

  return useQuery({
    queryKey: QUERY_KEYS.wikiCards(resolvedNotebookId),
    queryFn: () => wikiCardsApi.list(resolvedNotebookId),
    enabled: !!resolvedNotebookId,
    staleTime: 5 * 1000,
    refetchOnWindowFocus: true,
  })
}

export function useSourceWikiCard(sourceId?: string) {
  const resolvedSourceId = sourceId ?? ''

  return useQuery({
    queryKey: QUERY_KEYS.sourceWikiCard(resolvedSourceId),
    queryFn: () => wikiCardsApi.getForSource(resolvedSourceId),
    enabled: !!resolvedSourceId,
    staleTime: 5 * 1000,
    refetchOnWindowFocus: true,
  })
}
