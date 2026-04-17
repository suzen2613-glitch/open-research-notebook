import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import { sourcesApi } from '@/lib/api/sources'
import { notebooksApi } from '@/lib/api/notebooks'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { useToast } from '@/lib/hooks/use-toast'
import { useTranslation } from '@/lib/hooks/use-translation'
import { getApiErrorMessage } from '@/lib/utils/error-handler'
import {
  CreateSourceRequest,
  UpdateSourceRequest,
  SourceResponse,
  SourceStatusResponse,
  SourceListResponse,
  DuplicateSourceGroupResponse,
  DuplicateCleanupResponse,
} from '@/lib/types/api'

const NOTEBOOK_SOURCES_PAGE_SIZE = 30

export function useSources(notebookId?: string, options?: { enabled?: boolean }) {
  const enabled = (options?.enabled ?? true) && !!notebookId

  return useQuery({
    queryKey: QUERY_KEYS.sources(notebookId),
    queryFn: () => sourcesApi.list({ notebook_id: notebookId }),
    enabled,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  })
}

export function useNotebookSources(notebookId: string, options?: { enabled?: boolean }) {
  const queryClient = useQueryClient()
  const enabled = (options?.enabled ?? true) && !!notebookId

  const query = useInfiniteQuery({
    queryKey: QUERY_KEYS.sourcesInfinite(notebookId),
    queryFn: async ({ pageParam = 0 }) => {
      const data = await sourcesApi.list({
        notebook_id: notebookId,
        limit: NOTEBOOK_SOURCES_PAGE_SIZE,
        offset: pageParam,
        sort_by: 'updated',
        sort_order: 'desc',
      })
      return {
        sources: data,
        nextOffset: data.length === NOTEBOOK_SOURCES_PAGE_SIZE ? pageParam + data.length : undefined,
      }
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset,
    enabled,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  })

  const sources: SourceListResponse[] = useMemo(
    () => query.data?.pages.flatMap((page) => page.sources) ?? [],
    [query.data?.pages]
  )

  const refetch = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.sourcesInfinite(notebookId) })
  }, [queryClient, notebookId])

  return {
    sources,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isRefetching: query.isRefetching,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    refetch,
    error: query.error,
  }
}

export function useSource(id: string) {
  return useQuery({
    queryKey: QUERY_KEYS.source(id),
    queryFn: () => sourcesApi.get(id),
    enabled: !!id,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  })
}

export function useCreateSource() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: (data: CreateSourceRequest) => sourcesApi.create(data),
    onSuccess: (_result: SourceResponse, variables) => {
      const notebookIds = variables.notebooks ?? (variables.notebook_id ? [variables.notebook_id] : [])

      notebookIds.forEach((notebookId) => {
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.sources(notebookId), refetchType: 'active' })
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.sourcesInfinite(notebookId), refetchType: 'active' })
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.summaries(notebookId), refetchType: 'active' })
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.wikiCards(notebookId), refetchType: 'active' })
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.notebook(notebookId), refetchType: 'active' })
      })

      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.sources(), refetchType: 'active' })
      queryClient.invalidateQueries({ queryKey: ['summaries'], refetchType: 'active' })

      if (variables.async_processing) {
        toast({
          title: t.sources.sourceQueued,
          description: t.sources.sourceQueuedDesc,
        })
      } else {
        toast({
          title: t.common.success,
          description: t.sources.sourceAddedSuccess,
        })
      }
    },
    onError: (error: unknown) => {
      toast({
        title: t.common.error,
        description: getApiErrorMessage(error, (key) => t(key), t.sources.failedToAddSource),
        variant: 'destructive',
      })
    },
  })
}

export function useUpdateSource() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateSourceRequest }) => sourcesApi.update(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['sources'] })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.source(id) })
      toast({
        title: t.common.success,
        description: t.sources.sourceUpdatedSuccess,
      })
    },
    onError: (error: unknown) => {
      toast({
        title: t.common.error,
        description: getApiErrorMessage(error, (key) => t(key), t.sources.failedToUpdateSource),
        variant: 'destructive',
      })
    },
  })
}

export function useDeleteSource() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: (id: string) => sourcesApi.delete(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['sources'] })
      queryClient.invalidateQueries({ queryKey: ['summaries'] })
      queryClient.invalidateQueries({ queryKey: ['wiki-cards'] })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.source(id) })
      toast({
        title: t.common.success,
        description: t.sources.sourceDeletedSuccess,
      })
    },
    onError: (error: unknown) => {
      toast({
        title: t.common.error,
        description: getApiErrorMessage(error, (key) => t(key), t.sources.failedToDeleteSource),
        variant: 'destructive',
      })
    },
  })
}

export function useFileUpload() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: ({ file, notebookId }: { file: File; notebookId?: string }) =>
      sourcesApi.upload(file, notebookId),
    onSuccess: (_, { notebookId }) => {
      queryClient.invalidateQueries({ queryKey: ['sources'] })
      if (notebookId) {
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.sources(notebookId) })
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.sourcesInfinite(notebookId) })
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.notebook(notebookId) })
      }
      toast({
        title: t.common.success,
        description: t.sources.fileUploadedSuccess,
      })
    },
    onError: (error: unknown) => {
      toast({
        title: t.common.error,
        description: getApiErrorMessage(error, (key) => t(key), t.sources.failedToUploadFile),
        variant: 'destructive',
      })
    },
  })
}

export function useRetrySource() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: (sourceId: string) => sourcesApi.retry(sourceId),
    onSuccess: (_, sourceId) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.source(sourceId) })
      queryClient.invalidateQueries({ queryKey: ['sources'] })
      queryClient.invalidateQueries({ queryKey: ['summaries'] })
      queryClient.invalidateQueries({ queryKey: ['wiki-cards'] })
      toast({
        title: t.common.success,
        description: t.sources.retryStarted || 'Source retry queued.',
      })
    },
    onError: (error: unknown) => {
      toast({
        title: t.common.error,
        description: getApiErrorMessage(error, (key) => t(key), t.sources.failedToRetrySource || 'Failed to retry source'),
        variant: 'destructive',
      })
    },
  })
}

type SourceStatusOptions = boolean | { enabled?: boolean; refetchInterval?: number | false }

export function useSourceStatus(id?: string, options?: SourceStatusOptions) {
  const sourceId = id ?? ''
  const normalizedOptions = typeof options === 'boolean' ? { enabled: options } : options

  return useQuery<SourceStatusResponse>({
    queryKey: [...QUERY_KEYS.source(sourceId), 'status'],
    queryFn: () => sourcesApi.status(sourceId),
    enabled: !!sourceId && (normalizedOptions?.enabled ?? true),
    refetchInterval: normalizedOptions?.refetchInterval ?? false,
  })
}

export function useAddSourcesToNotebook() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: async ({ notebookId, sourceIds }: { notebookId: string; sourceIds: string[] }) => {
      await Promise.all(sourceIds.map((sourceId) => notebooksApi.addSource(notebookId, sourceId)))
      return { notebookId, sourceIds }
    },
    onSuccess: ({ notebookId }) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.sources(notebookId) })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.sourcesInfinite(notebookId) })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.notebook(notebookId) })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.duplicateSources(notebookId) })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.summaries(notebookId) })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.wikiCards(notebookId) })
      toast({
        title: t.common.success,
        description: t.sources.sourcesAddedSuccess || 'Sources added to notebook.',
      })
    },
    onError: (error: unknown) => {
      toast({
        title: t.common.error,
        description: getApiErrorMessage(error, (key) => t(key), t.sources.failedToAddSource),
        variant: 'destructive',
      })
    },
  })
}

export function useRemoveSourceFromNotebook() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: ({ notebookId, sourceId }: { notebookId: string; sourceId: string }) =>
      notebooksApi.removeSource(notebookId, sourceId),
    onSuccess: (_, { notebookId, sourceId }) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.sources(notebookId) })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.sourcesInfinite(notebookId) })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.notebook(notebookId) })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.duplicateSources(notebookId) })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.source(sourceId) })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.summaries(notebookId) })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.wikiCards(notebookId) })
      toast({
        title: t.common.success,
        description: t.sources.sourceRemovedSuccess || 'Source removed from notebook.',
      })
    },
    onError: (error: unknown) => {
      toast({
        title: t.common.error,
        description: getApiErrorMessage(error, (key) => t(key), t.sources.failedToRemoveSource || 'Failed to remove source from notebook'),
        variant: 'destructive',
      })
    },
  })
}

export function useNotebookDuplicateSources(notebookId?: string, options?: { enabled?: boolean }) {
  const resolvedNotebookId = notebookId ?? ''
  const enabled = !!resolvedNotebookId && (options?.enabled ?? true)

  return useQuery<DuplicateSourceGroupResponse[]>({
    queryKey: QUERY_KEYS.duplicateSources(resolvedNotebookId),
    queryFn: () => notebooksApi.listDuplicateSources(resolvedNotebookId),
    enabled,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  })
}

export function useScanNotebookDuplicateSources() {
  const queryClient = useQueryClient()

  return useMutation<DuplicateSourceGroupResponse[], unknown, string>({
    mutationFn: (notebookId: string) => notebooksApi.listDuplicateSources(notebookId),
    onSuccess: (result, notebookId) => {
      queryClient.setQueryData(QUERY_KEYS.duplicateSources(notebookId), result)
    },
  })
}

export function useCleanupNotebookDuplicateSources() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation<DuplicateCleanupResponse, unknown, string>({
    mutationFn: (notebookId: string) => notebooksApi.cleanupDuplicateSources(notebookId),
    onSuccess: (_, notebookId) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.sourcesInfinite(notebookId) })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.sources(notebookId) })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.summaries(notebookId) })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.wikiCards(notebookId) })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.notebook(notebookId) })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.duplicateSources(notebookId) })
      toast({
        title: t.common.success,
        description: t.sources.duplicateCleanupSuccess,
      })
    },
    onError: (error: unknown) => {
      toast({
        title: t.common.error,
        description: getApiErrorMessage(error, (key) => t(key), t.sources.failedToCleanupDuplicates),
        variant: 'destructive',
      })
    },
  })
}
