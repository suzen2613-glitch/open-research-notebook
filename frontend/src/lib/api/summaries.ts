import apiClient from './client'
import type { InsightCreationResponse, SourceInsightResponse } from './insights'

export interface NotebookSourceSummaryResponse {
  source_id: string
  source_title?: string | null
  source_created: string
  source_updated: string
  summary?: SourceInsightResponse | null
}

export const summariesApi = {
  list: async (notebookId: string) => {
    const response = await apiClient.get<NotebookSourceSummaryResponse[]>(
      `/notebooks/${notebookId}/summaries`
    )
    return response.data
  },

  create: async (sourceId: string, modelId?: string) => {
    const response = await apiClient.post<InsightCreationResponse>(
      `/sources/${sourceId}/summary`,
      modelId ? { model_id: modelId } : {}
    )
    return response.data
  },
}
