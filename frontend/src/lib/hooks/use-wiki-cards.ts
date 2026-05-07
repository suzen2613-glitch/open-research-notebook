import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

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

export function useRefreshWikiCard() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ wikiCardId, modelId }: { wikiCardId: string; modelId?: string }) =>
      wikiCardsApi.refresh(wikiCardId, modelId),
    onSuccess: () => {
      toast.success('Wiki card refresh started', {
        description: 'Regeneration is running in the background.',
      })
      queryClient.invalidateQueries({ queryKey: ['wiki-cards'] })
      queryClient.invalidateQueries({ queryKey: ['source-wiki-card'] })
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Failed to refresh wiki card'
      toast.error('Could not start refresh', { description: message })
    },
  })
}
