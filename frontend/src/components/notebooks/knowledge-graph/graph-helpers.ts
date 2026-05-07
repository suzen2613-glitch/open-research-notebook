import type { SourceWikiCardResponse } from '@/lib/api/wiki-cards'
import type { PaperType } from './graph-constants'
import { PAPER_TYPE_STYLES, ALL_RELATION_TYPES } from './graph-constants'
import type { ConceptEntry, Filters } from './graph-types'

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export function deriveConceptEntries(card: SourceWikiCardResponse): ConceptEntry[] {
  const ids = card.core_concept_ids?.length ? card.core_concept_ids : card.concept_ids
  const nameById = new Map<string, string>()
  card.concept_ids.forEach((id, index) => {
    nameById.set(id, card.concept_names[index] ?? id.replace(/^concept:/, '').replace(/-/g, ' '))
  })
  const seen = new Set<string>()
  const entries: ConceptEntry[] = []
  for (const id of ids ?? []) {
    if (!id || seen.has(id)) continue
    seen.add(id)
    entries.push({ id, name: nameById.get(id) ?? id.replace(/^concept:/, '').replace(/-/g, ' ') })
    if (entries.length >= 4) break
  }
  return entries
}

export function normalizePaperType(value: string | null | undefined): PaperType | null {
  if (!value) return null
  const normalized = value.toLowerCase() as PaperType
  return normalized in PAPER_TYPE_STYLES ? normalized : null
}

export function defaultFilters(): Filters {
  return {
    search: '',
    domains: new Set(),
    paperTypes: new Set(),
    relationTypes: new Set(ALL_RELATION_TYPES),
    showRelatedWork: false,
    onlyKeyPapers: false,
    showAllPapers: true,
  }
}
