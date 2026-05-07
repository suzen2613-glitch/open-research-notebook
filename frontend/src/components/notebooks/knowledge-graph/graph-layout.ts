import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
} from 'd3-force'
import { MarkerType, type Edge, type Node } from 'reactflow'
import type { SourceWikiCardResponse } from '@/lib/api/wiki-cards'

import {
  RELATION_STYLES,
  CONCEPT_EDGE_COLOR,
  PAPER_NODE_WIDTH,
  PAPER_NODE_HEIGHT,
  CONCEPT_BASE_SIZE,
  CONCEPT_MAX_SIZE,
  LAYOUT_WIDTH,
  LAYOUT_HEIGHT,
  type RelationType,
} from './graph-constants'
import { deriveConceptEntries, normalizePaperType } from './graph-helpers'
import type { GraphNodeData, SimNode, ConceptLookupValue, ConceptEntry, Filters, GraphModel, LabelRenderers } from './graph-types'

/* ------------------------------------------------------------------ */
/* Graph computation (data-only, no JSX)                               */
/* ------------------------------------------------------------------ */

interface BuildOptions {
  cards: SourceWikiCardResponse[]
  filters: Filters
  renderers: LabelRenderers
}

export function computeGraphModel({ cards, filters, renderers }: BuildOptions): GraphModel {
  // 1. Filter cards
  const search = filters.search.trim().toLowerCase()
  const filteredCards = cards.filter((card) => {
    if (filters.onlyKeyPapers && !card.is_key_paper) return false
    if (filters.paperTypes.size > 0 && !filters.paperTypes.has(card.paper_type || 'unknown')) return false
    if (filters.domains.size > 0 && !(card.domains || []).some((d) => filters.domains.has(d))) return false
    if (search) {
      const haystack = [
        card.title,
        card.short_title,
        card.source_title,
        ...(card.concept_names || []),
        ...(card.keywords || []),
        ...(card.methods || []),
        ...(card.topics || []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      if (!haystack.includes(search)) return false
    }
    return true
  })

  const paperLookup = new Map<string, SourceWikiCardResponse>()
  filteredCards.forEach((card) => paperLookup.set(card.source_id, card))

  // 2. Build concept lookup
  const conceptLookup = new Map<string, ConceptLookupValue>()
  const cardConceptMap = new Map<string, ConceptEntry[]>()

  const addConceptNode = (conceptId: string, name: string, card: SourceWikiCardResponse) => {
    const existing = conceptLookup.get(conceptId)
    if (existing) {
      existing.relatedCards.push(card)
    } else {
      conceptLookup.set(conceptId, { name, relatedCards: [card] })
    }
  }

  filteredCards.forEach((card) => {
    const entries = deriveConceptEntries(card)
    cardConceptMap.set(card.source_id, entries)
    entries.forEach((entry) => addConceptNode(entry.id, entry.name, card))
  })

  // Drop concepts with only 1 linked paper when we have a lot of papers
  const prunedConcepts = new Map<string, ConceptLookupValue>()
  const conceptMinDegree = filteredCards.length > 25 ? 2 : 1
  conceptLookup.forEach((value, id) => {
    if (value.relatedCards.length >= conceptMinDegree) prunedConcepts.set(id, value)
  })

  // 3. Build nodes + edges
  const nodes: Node<GraphNodeData>[] = []
  const edges: Edge[] = []
  const degreeMap = new Map<string, number>()
  const bumpDegree = (id: string) => degreeMap.set(id, (degreeMap.get(id) || 0) + 1)

  // concept nodes
  prunedConcepts.forEach((concept, conceptId) => {
    const nodeId = `concept:${conceptId}`
    nodes.push({
      id: nodeId,
      position: { x: 0, y: 0 },
      draggable: true,
      selectable: true,
      data: {
        kind: 'concept',
        conceptId,
        degree: concept.relatedCards.length,
        label: renderers.concept(concept.name, concept.relatedCards.length),
      },
      style: { background: 'transparent', border: 'none', padding: 0, width: 'auto' as unknown as number },
    })
  })

  // paper nodes
  filteredCards.forEach((card) => {
    const nodeId = `paper:${card.source_id}`
    nodes.push({
      id: nodeId,
      position: { x: 0, y: 0 },
      draggable: true,
      selectable: true,
      data: {
        kind: 'paper',
        paperId: card.source_id,
        paperType: normalizePaperType(card.paper_type),
        isKeyPaper: card.is_key_paper,
        degree: 0,
        label: renderers.paper(card, 0),
      },
      style: {
        background: 'transparent',
        border: 'none',
        padding: 0,
        width: PAPER_NODE_WIDTH,
      },
    })
  })

  // paper-concept edges
  filteredCards.forEach((card) => {
    const nodeId = `paper:${card.source_id}`
    const entries = cardConceptMap.get(card.source_id) || []
    entries.forEach((entry) => {
      if (!prunedConcepts.has(entry.id)) return
      const targetId = `concept:${entry.id}`
      const edgeId = `paper-concept:${card.source_id}-${entry.id}`
      edges.push({
        id: edgeId,
        source: nodeId,
        target: targetId,
        style: { stroke: CONCEPT_EDGE_COLOR, strokeWidth: 1, strokeOpacity: 0.55 },
        type: 'default',
      })
      bumpDegree(nodeId)
      bumpDegree(targetId)
    })
  })

  // paper-paper relation edges
  filteredCards.forEach((card) => {
    const nodeId = `paper:${card.source_id}`
    for (const relation of card.relation_edges ?? []) {
      const rt = relation.relation_type as RelationType
      if (!filters.relationTypes.has(rt)) continue
      if (!filters.showRelatedWork && rt === 'related_work') continue
      if (!paperLookup.has(relation.target_source_id)) continue
      const targetNode = `paper:${relation.target_source_id}`
      const edgeId = `paper-${rt}:${card.source_id}->${relation.target_source_id}`
      const style = RELATION_STYLES[rt] || RELATION_STYLES.related_work
      edges.push({
        id: edgeId,
        source: nodeId,
        target: targetNode,
        label: style.label,
        labelStyle: { fontSize: 10, fill: style.color, fontWeight: 500 },
        labelBgStyle: { fill: 'white', opacity: 0.85 },
        labelBgPadding: [2, 3],
        style: {
          stroke: style.color,
          strokeWidth: style.width,
          strokeDasharray: style.dash,
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: style.color, width: 14, height: 14 },
      })
      bumpDegree(nodeId)
      bumpDegree(targetNode)
    }
  })

  // Patch degree onto paper node data for label re-render
  nodes.forEach((n) => {
    if (n.data.kind === 'paper' && n.data.paperId) {
      const card = paperLookup.get(n.data.paperId)
      if (!card) return
      const deg = degreeMap.get(n.id) || 0
      n.data = { ...n.data, degree: deg, label: renderers.paper(card, deg) }
    }
  })

  return { nodes, edges, paperLookup, conceptLookup: prunedConcepts, cardConceptMap }
}

/* ------------------------------------------------------------------ */
/* Force layout                                                        */
/* ------------------------------------------------------------------ */

export function runForceLayout(nodes: Node<GraphNodeData>[], edges: Edge[]): Node<GraphNodeData>[] {
  if (nodes.length === 0) return nodes
  const simNodes: SimNode[] = nodes.map((n) => {
    const conceptSize = n.data.kind === 'concept'
      ? Math.min(CONCEPT_MAX_SIZE, CONCEPT_BASE_SIZE + n.data.degree * 6)
      : 0
    const width = n.data.kind === 'paper' ? PAPER_NODE_WIDTH : conceptSize
    const height = n.data.kind === 'paper' ? PAPER_NODE_HEIGHT : conceptSize
    return { id: n.id, width, height, x: Math.random() * LAYOUT_WIDTH, y: Math.random() * LAYOUT_HEIGHT }
  })
  const nodeById = new Map(simNodes.map((n) => [n.id, n]))
  const simLinks: SimulationLinkDatum<SimNode>[] = edges
    .filter((e) => nodeById.has(e.source as string) && nodeById.has(e.target as string))
    .map((e) => ({ source: e.source as string, target: e.target as string }))

  const simulation: Simulation<SimNode, SimulationLinkDatum<SimNode>> = forceSimulation(simNodes)
    .force('charge', forceManyBody<SimNode>().strength((d) => (d.id.startsWith('concept:') ? -900 : -420)))
    .force(
      'link',
      forceLink<SimNode, SimulationLinkDatum<SimNode>>(simLinks)
        .id((d) => d.id)
        .distance((l) => {
          const src = typeof l.source === 'string' ? l.source : (l.source as SimNode).id
          const tgt = typeof l.target === 'string' ? l.target : (l.target as SimNode).id
          return src.startsWith('concept:') || tgt.startsWith('concept:') ? 160 : 240
        })
        .strength(0.45)
    )
    .force('center', forceCenter(LAYOUT_WIDTH / 2, LAYOUT_HEIGHT / 2))
    .force(
      'collide',
      forceCollide<SimNode>().radius((d) => Math.max(d.width, d.height) / 2 + 20)
    )
    .stop()

  const iterations = Math.min(300, 120 + nodes.length * 3)
  for (let i = 0; i < iterations; i += 1) simulation.tick()

  return nodes.map((n) => {
    const sim = nodeById.get(n.id)
    if (!sim) return n
    const w = sim.width
    const h = sim.height
    return { ...n, position: { x: (sim.x ?? 0) - w / 2, y: (sim.y ?? 0) - h / 2 } }
  })
}
