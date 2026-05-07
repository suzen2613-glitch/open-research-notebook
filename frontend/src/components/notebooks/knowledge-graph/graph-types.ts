import type { ReactNode } from 'react'
import type { SimulationNodeDatum, SimulationLinkDatum } from 'd3-force'
import type { Edge, Node } from 'reactflow'
import type { SourceWikiCardResponse } from '@/lib/api/wiki-cards'
import type { PaperType, RelationType } from './graph-constants'

/* ------------------------------------------------------------------ */
/* Graph node data                                                     */
/* ------------------------------------------------------------------ */

export type NodeKind = 'paper' | 'concept'

export type GraphNodeData = {
  kind: NodeKind
  paperId?: string
  conceptId?: string
  label: ReactNode
  degree: number
  paperType?: PaperType | null
  isKeyPaper?: boolean
  dim?: boolean
}

/* ------------------------------------------------------------------ */
/* Simulation types                                                    */
/* ------------------------------------------------------------------ */

export type SimNode = SimulationNodeDatum & {
  id: string
  width: number
  height: number
}

/* ------------------------------------------------------------------ */
/* Concept types                                                       */
/* ------------------------------------------------------------------ */

export type ConceptEntry = { id: string; name: string }

export type ConceptLookupValue = { name: string; relatedCards: SourceWikiCardResponse[] }

/* ------------------------------------------------------------------ */
/* Selection state                                                     */
/* ------------------------------------------------------------------ */

export type SelectedState =
  | { kind: 'paper'; card: SourceWikiCardResponse; conceptNames: string[]; outgoingRelations: import('@/lib/api/wiki-cards').RelationEdgeResponse[] }
  | { kind: 'concept'; conceptId: string; conceptName: string; relatedCards: SourceWikiCardResponse[] }
  | null

/* ------------------------------------------------------------------ */
/* Filters                                                             */
/* ------------------------------------------------------------------ */

export interface Filters {
  search: string
  domains: Set<string>
  paperTypes: Set<string>
  relationTypes: Set<RelationType>
  showRelatedWork: boolean
  onlyKeyPapers: boolean
  showAllPapers: boolean
}

/* ------------------------------------------------------------------ */
/* Graph model result                                                  */
/* ------------------------------------------------------------------ */

export interface GraphModel {
  nodes: Node<GraphNodeData>[]
  edges: Edge[]
  paperLookup: Map<string, SourceWikiCardResponse>
  conceptLookup: Map<string, ConceptLookupValue>
  cardConceptMap: Map<string, ConceptEntry[]>
}

/* ------------------------------------------------------------------ */
/* Label renderer                                                      */
/* ------------------------------------------------------------------ */

export interface LabelRenderers {
  paper: (card: SourceWikiCardResponse, degree: number, dim?: boolean) => ReactNode
  concept: (name: string, degree: number, dim?: boolean) => ReactNode
}
