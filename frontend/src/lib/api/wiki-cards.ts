import apiClient from './client'
import { type CommandJobStatusResponse } from './insights'

export type WikiCardStatus = 'missing' | 'pending' | 'completed' | 'failed'

export interface RelatedSourceResponse {
  source_id: string
  source_title?: string | null
  relation_type: string
  reason: string
}

export interface RelationEdgeResponse {
  source_id: string
  relation_type: string
  reason: string
}

export interface EvidenceSnippetResponse {
  embedding_id: string
  section?: string | null
  char_start?: number | null
  char_end?: number | null
  excerpt: string
  reason: string
}

export interface SourceWikiCardResponse {
  id: string
  source_id: string
  notebook_ids: string[]
  source_title?: string | null
  title?: string | null
  short_title?: string | null
  canonical_title?: string | null
  slug?: string | null
  authors: string[]
  year?: number | null
  venue?: string | null
  paper_type?: 'review' | 'foundational' | 'method' | 'application' | 'benchmark' | 'survey' | null
  domains: string[]
  summary_text?: string | null
  topics: string[]
  methods: string[]
  problems: string[]
  contributions: string[]
  limitations: string[]
  keywords: string[]
  moc_groups: string[]
  recommended_entry_points: string[]
  is_key_paper: boolean
  concept_ids: string[]
  concept_names: string[]
  core_concept_ids: string[]
  question_ids: string[]
  question_names: string[]
  related_sources: RelatedSourceResponse[]
  relation_edges: RelationEdgeResponse[]
  display_language?: 'en' | 'zh' | 'mixed' | 'unknown' | null
  canonical_language?: 'en' | 'zh' | 'mixed' | 'unknown' | null
  extraction_confidence?: number | null
  evidence_snippets: EvidenceSnippetResponse[]
  obsidian_markdown?: string | null
  obsidian_frontmatter?: Record<string, unknown> | null
  summary_source_insight_id?: string | null
  prompt_snapshot?: string | null
  model_id?: string | null
  command_id?: string | null
  status: Exclude<WikiCardStatus, 'missing'>
  error_message?: string | null
  created: string
  updated: string
}

export interface SourceWikiCardSlotResponse {
  source_id: string
  source_title?: string | null
  source_created: string
  source_updated: string
  status: WikiCardStatus
  wiki_card?: SourceWikiCardResponse | null
}

export interface WikiCardCreationResponse {
  status: 'pending'
  message: string
  source_id: string
  wiki_card_id: string
  command_id?: string
}

export interface NotebookMocSectionResponse {
  id: string
  label: string
  count: number
  wiki_card_ids: string[]
  source_ids: string[]
}

export interface NotebookMocResponse {
  notebook_id: string
  paper_types: NotebookMocSectionResponse[]
  domains: NotebookMocSectionResponse[]
  moc_groups: NotebookMocSectionResponse[]
  key_papers: SourceWikiCardResponse[]
  recently_updated: SourceWikiCardResponse[]
}

export interface NotebookMocLiteResponse {
  notebook_id: string
  paper_types: NotebookMocSectionResponse[]
  domains: NotebookMocSectionResponse[]
  moc_groups: NotebookMocSectionResponse[]
  key_paper_ids: string[]
  recently_updated_ids: string[]
}

export const wikiCardsApi = {
  list: async (notebookId: string) => {
    const response = await apiClient.get<SourceWikiCardSlotResponse[]>(
      `/notebooks/${notebookId}/wiki-cards`
    )
    return response.data
  },

  getForSource: async (sourceId: string) => {
    const response = await apiClient.get<SourceWikiCardSlotResponse>(
      `/sources/${sourceId}/wiki-card`
    )
    return response.data
  },

  create: async (sourceId: string, modelId?: string) => {
    const response = await apiClient.post<WikiCardCreationResponse>(
      `/sources/${sourceId}/wiki-card`,
      modelId ? { model_id: modelId } : {}
    )
    return response.data
  },

  refresh: async (wikiCardId: string, modelId?: string) => {
    const response = await apiClient.post<WikiCardCreationResponse>(
      `/wiki-cards/${wikiCardId}/refresh`,
      modelId ? { model_id: modelId } : {}
    )
    return response.data
  },

  getCommandStatus: async (commandId: string) => {
    const response = await apiClient.get<CommandJobStatusResponse>(
      `/commands/jobs/${commandId}`
    )
    return response.data
  },

  getMoc: async (notebookId: string) => {
    const response = await apiClient.get<NotebookMocResponse>(
      `/notebooks/${notebookId}/moc`
    )
    return response.data
  },

  getMocLite: async (notebookId: string) => {
    const response = await apiClient.get<NotebookMocLiteResponse>(
      `/notebooks/${notebookId}/moc-lite`
    )
    return response.data
  },

  getPaperTypes: async (notebookId: string) => {
    const response = await apiClient.get<NotebookMocSectionResponse[]>(
      `/notebooks/${notebookId}/paper-types`
    )
    return response.data
  },

  getDomains: async (notebookId: string) => {
    const response = await apiClient.get<NotebookMocSectionResponse[]>(
      `/notebooks/${notebookId}/domains`
    )
    return response.data
  },
}
