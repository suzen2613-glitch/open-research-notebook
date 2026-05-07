import type { RelationEdgeResponse } from '@/lib/api/wiki-cards'

/* ------------------------------------------------------------------ */
/* Visual language                                                     */
/* ------------------------------------------------------------------ */

export type PaperType = 'foundational' | 'method' | 'application' | 'benchmark' | 'review' | 'survey'

export const PAPER_TYPE_STYLES: Record<PaperType, { label: string; border: string; dot: string; text: string }> = {
  foundational: { label: 'Foundational', border: 'border-l-violet-500', dot: 'bg-violet-500', text: 'text-violet-700' },
  method:       { label: 'Method',       border: 'border-l-sky-500',    dot: 'bg-sky-500',    text: 'text-sky-700' },
  application: { label: 'Application',  border: 'border-l-emerald-500',dot: 'bg-emerald-500',text: 'text-emerald-700' },
  benchmark:    { label: 'Benchmark',    border: 'border-l-amber-500',  dot: 'bg-amber-500',  text: 'text-amber-700' },
  review:       { label: 'Review',       border: 'border-l-slate-500',  dot: 'bg-slate-500',  text: 'text-slate-700' },
  survey:       { label: 'Survey',       border: 'border-l-slate-400',  dot: 'bg-slate-400',  text: 'text-slate-700' },
}

export type RelationType = RelationEdgeResponse['relation_type']

export const RELATION_STYLES: Record<RelationType, { color: string; dash?: string; width: number; label: string }> = {
  extends:       { color: '#2563eb', width: 2.2, label: 'extends' },
  improves:      { color: '#16a34a', width: 2.2, label: 'improves' },
  uses:          { color: '#7c3aed', width: 1.8, label: 'uses' },
  applies:       { color: '#0891b2', width: 1.8, label: 'applies' },
  compares_with: { color: '#64748b', width: 1.6, dash: '4 3', label: 'compares with' },
  criticizes:    { color: '#dc2626', width: 2,   dash: '6 3', label: 'criticizes' },
  benchmark_for: { color: '#d97706', width: 1.8, label: 'benchmark for' },
  related_work:  { color: '#cbd5e1', width: 1,   dash: '2 4', label: 'related work' },
}

export const CONCEPT_EDGE_COLOR = '#94a3b8'

export const ALL_RELATION_TYPES: RelationType[] = [
  'extends', 'improves', 'uses', 'applies', 'compares_with', 'criticizes', 'benchmark_for', 'related_work',
]

/* ------------------------------------------------------------------ */
/* Layout constants                                                    */
/* ------------------------------------------------------------------ */

export const PAPER_NODE_WIDTH = 210
export const PAPER_NODE_HEIGHT = 86
export const CONCEPT_BASE_SIZE = 68
export const CONCEPT_MAX_SIZE = 130
export const LAYOUT_WIDTH = 1400
export const LAYOUT_HEIGHT = 900
