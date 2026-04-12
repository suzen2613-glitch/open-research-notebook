import apiClient from './client'
import type { SourceEmbeddingResponse } from '@/lib/types/api'

export const sourceEvidenceApi = {
  get: async (embeddingId: string) => {
    const response = await apiClient.get<SourceEmbeddingResponse>(
      `/source-embeddings/${embeddingId}`
    )
    return response.data
  },

  listForSource: async (sourceId: string, limit: number = 12) => {
    const response = await apiClient.get<SourceEmbeddingResponse[]>(
      `/sources/${sourceId}/evidence`,
      { params: { limit } }
    )
    return response.data
  },
}
