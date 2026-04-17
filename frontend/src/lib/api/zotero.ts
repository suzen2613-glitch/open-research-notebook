import apiClient from './client'

export interface ZoteroCollectionResponse {
  id: number
  key: string
  name: string
  parent_id?: number | null
  library_id?: number | null
  item_count: number
  pdf_count: number
}

export interface ZoteroImportResponse {
  collection_id: number
  collection_name?: string | null
  total: number
  imported: number
  skipped: number
  failed: number
  cancelled?: boolean
  results: Array<{
    title: string
    status: string
    source_id?: string
    reason?: string
    error?: string
    item_key?: string
    attachment_key?: string
    linked_notebooks?: number
  }>
}

export interface ZoteroImportProgress {
  phase: string
  collection_id?: number
  collection_name?: string | null
  total: number
  processed: number
  imported: number
  skipped: number
  failed: number
  percentage: number
  current_item?: string | null
  current_index?: number | null
  item_phase?: string | null
  item_phase_index?: number | null
  item_phase_total?: number | null
  item_phase_percentage?: number | null
  error_message?: string | null
  cancel_requested?: boolean
}

export interface ZoteroImportJobResponse {
  job_id: string
  status: string
  message: string
}

export interface ZoteroImportJobStatusResponse {
  job_id: string
  status: string
  raw_status?: string | null
  app?: string | null
  name?: string | null
  result?: ZoteroImportResponse | null
  error_message?: string | null
  created?: string | null
  updated?: string | null
  progress?: ZoteroImportProgress | null
  args?: {
    collection_id?: number
    notebook_ids?: string[]
    embed?: boolean
    skip_existing?: boolean
  } | null
  context?: Record<string, unknown> | null
  cancel_requested?: boolean
}

export const zoteroApi = {
  listCollections: async () => {
    const response = await apiClient.get<{ collections: ZoteroCollectionResponse[] }>('/zotero/collections')
    return response.data.collections
  },
  importCollection: async (data: {
    collection_id: number
    notebook_ids: string[]
    embed?: boolean
    skip_existing?: boolean
  }) => {
    const response = await apiClient.post<ZoteroImportResponse>('/zotero/import', data)
    return response.data
  },
  startImportCollectionJob: async (data: {
    collection_id: number
    notebook_ids: string[]
    embed?: boolean
    skip_existing?: boolean
  }) => {
    const response = await apiClient.post<ZoteroImportJobResponse>('/zotero/import/jobs', data)
    return response.data
  },
  getImportCollectionJobStatus: async (jobId: string) => {
    const response = await apiClient.get<ZoteroImportJobStatusResponse>(`/zotero/import/jobs/${jobId}`)
    return response.data
  },
  listImportCollectionJobs: async (params?: { limit?: number; status_filter?: string }) => {
    const response = await apiClient.get<ZoteroImportJobStatusResponse[]>('/zotero/import/jobs', {
      params,
    })
    return response.data
  },
  cancelImportCollectionJob: async (jobId: string) => {
    const response = await apiClient.post<{ job_id: string; cancel_requested: boolean }>(
      `/zotero/import/jobs/${jobId}/cancel`
    )
    return response.data
  },
  retryImportCollectionJob: async (jobId: string) => {
    const response = await apiClient.post<ZoteroImportJobResponse>(`/zotero/import/jobs/${jobId}/retry`)
    return response.data
  },
}
