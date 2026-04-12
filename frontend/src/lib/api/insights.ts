import apiClient from './client'
import type { NoteResponse } from '@/lib/types/api'

export interface SourceInsightResponse {
  id: string
  source_id: string
  insight_type: string
  content: string
  transformation_id?: string | null
  prompt_title?: string | null
  can_refresh: boolean
  created: string
  updated: string
}

export interface CreateSourceInsightRequest {
  transformation_id?: string
  title?: string
  prompt?: string
  model_id?: string
}

export interface InsightCreationResponse {
  status: 'pending'
  message: string
  source_id: string
  transformation_id?: string | null
  insight_title?: string | null
  command_id?: string
}

export interface CommandJobStatusResponse {
  job_id: string
  status: string
  result?: Record<string, unknown>
  error_message?: string
}

export interface InsightCommandWaitResult {
  success: boolean
  status: 'completed' | 'failed' | 'canceled' | 'timeout'
  errorMessage?: string
}

export const insightsApi = {
  listForSource: async (sourceId: string) => {
    const response = await apiClient.get<SourceInsightResponse[]>(`/sources/${sourceId}/insights`)
    return response.data
  },

  get: async (insightId: string) => {
    const response = await apiClient.get<SourceInsightResponse>(`/insights/${insightId}`)
    return response.data
  },

  create: async (sourceId: string, data: CreateSourceInsightRequest) => {
    const response = await apiClient.post<InsightCreationResponse>(
      `/sources/${sourceId}/insights`,
      data
    )
    return response.data
  },

  refresh: async (insightId: string, modelId?: string) => {
    const response = await apiClient.post<InsightCreationResponse>(
      `/insights/${insightId}/refresh`,
      modelId ? { model_id: modelId } : {}
    )
    return response.data
  },

  saveAsNote: async (insightId: string, notebookId?: string) => {
    const response = await apiClient.post<NoteResponse>(
      `/insights/${insightId}/save-as-note`,
      notebookId ? { notebook_id: notebookId } : {}
    )
    return response.data
  },

  delete: async (insightId: string) => {
    await apiClient.delete(`/insights/${insightId}`)
  },

  getCommandStatus: async (commandId: string) => {
    const response = await apiClient.get<CommandJobStatusResponse>(
      `/commands/jobs/${commandId}`
    )
    return response.data
  },

  /**
   * Poll command status until completed or failed.
   * Returns completion metadata so the caller can surface actionable errors.
   */
  waitForCommand: async (
    commandId: string,
    options?: { maxAttempts?: number; intervalMs?: number }
  ): Promise<InsightCommandWaitResult> => {
    const maxAttempts = options?.maxAttempts ?? 60 // Default 60 attempts
    const intervalMs = options?.intervalMs ?? 2000 // Default 2 seconds

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const status = await insightsApi.getCommandStatus(commandId)
        if (status.status === 'completed') {
          return { success: true, status: 'completed' }
        }
        if (status.status === 'failed' || status.status === 'canceled') {
          console.warn('Insight command did not complete:', status.error_message)
          return {
            success: false,
            status: status.status,
            errorMessage: status.error_message,
          }
        }
        // Still running, wait and retry
        await new Promise(resolve => setTimeout(resolve, intervalMs))
      } catch (error) {
        console.error('Error checking command status:', error)
        // Continue polling on error
        await new Promise(resolve => setTimeout(resolve, intervalMs))
      }
    }
    // Timeout
    console.warn('Command polling timed out')
    return {
      success: false,
      status: 'timeout',
      errorMessage: 'Insight generation timed out while waiting for background processing.',
    }
  }
}
