import { useQuery } from '@tanstack/react-query'

import { summariesApi } from '@/lib/api/summaries'
import { QUERY_KEYS } from '@/lib/api/query-client'

export function useNotebookSummaries(notebookId?: string) {
  const resolvedNotebookId = notebookId ?? ''

  return useQuery({
    queryKey: QUERY_KEYS.summaries(resolvedNotebookId),
    queryFn: () => summariesApi.list(resolvedNotebookId),
    enabled: !!resolvedNotebookId,
    staleTime: 5 * 1000,
    refetchOnWindowFocus: true,
  })
}
