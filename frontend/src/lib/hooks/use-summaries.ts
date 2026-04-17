import { useQuery } from '@tanstack/react-query'

import { summariesApi } from '@/lib/api/summaries'
import { QUERY_KEYS } from '@/lib/api/query-client'

export function useNotebookSummaries(notebookId?: string, options?: { enabled?: boolean }) {
  const resolvedNotebookId = notebookId ?? ''
  const enabled = !!resolvedNotebookId && (options?.enabled ?? true)

  return useQuery({
    queryKey: QUERY_KEYS.summaries(resolvedNotebookId),
    queryFn: () => summariesApi.list(resolvedNotebookId),
    enabled,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  })
}
