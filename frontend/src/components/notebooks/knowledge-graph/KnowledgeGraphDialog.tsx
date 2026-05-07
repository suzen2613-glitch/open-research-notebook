'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  useReactFlow,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { BookMarked, Lightbulb, Network } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/hooks/use-translation'
import type { SourceWikiCardResponse, SourceWikiCardSlotResponse } from '@/lib/api/wiki-cards'

import { PAPER_TYPE_STYLES, RELATION_STYLES, type PaperType, type RelationType } from './graph-constants'
import { normalizePaperType, defaultFilters } from './graph-helpers'
import { computeGraphModel, runForceLayout } from './graph-layout'
import { createLabelRenderers } from './node-renderers'
import { Legend } from './Legend'
import { Toolbar } from './Toolbar'
import type { Filters, SelectedState, GraphNodeData } from './graph-types'

/* ------------------------------------------------------------------ */
/* Main dialog                                                         */
/* ------------------------------------------------------------------ */

interface KnowledgeGraphDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  notebookName: string
  wikiCardSlots: SourceWikiCardSlotResponse[]
}

function KnowledgeGraphBody({ cards, notebookName }: { cards: SourceWikiCardResponse[]; notebookName: string }) {
  const { t } = useTranslation()
  const [filters, setFilters] = useState<Filters>(() => defaultFilters())
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [selected, setSelected] = useState<SelectedState>(null)
  const rfInstance = useReactFlow()
  const renderers = useMemo(() => createLabelRenderers(), [])

  const updateFilters = useCallback(
    (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch })),
    []
  )

  const resetFilters = useCallback(() => {
    setFilters(defaultFilters())
    setFocusedId(null)
    setSelected(null)
  }, [])

  // domain/paper type histograms
  const allDomains = useMemo(() => {
    const counts = new Map<string, number>()
    cards.forEach((c) => (c.domains || []).forEach((d) => counts.set(d, (counts.get(d) || 0) + 1)))
    return Array.from(counts.entries())
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count)
  }, [cards])

  const allPaperTypes = useMemo(() => {
    const counts = new Map<string, number>()
    cards.forEach((c) => {
      const key = c.paper_type || 'unknown'
      counts.set(key, (counts.get(key) || 0) + 1)
    })
    return Array.from(counts.entries())
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count)
  }, [cards])

  const graphModel = useMemo(
    () => computeGraphModel({ cards, filters, renderers }),
    [cards, filters, renderers]
  )

  const laidOutNodes = useMemo(
    () => runForceLayout(graphModel.nodes, graphModel.edges),
    // We recompute only when the structural shape changes (node/edge count).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graphModel.nodes.length, graphModel.edges.length, filters.search]
  )

  // Focus mode: dim non-neighbors
  const focusNeighbors = useMemo(() => {
    if (!focusedId) return null
    const ids = new Set<string>([focusedId])
    graphModel.edges.forEach((e) => {
      if (e.source === focusedId) ids.add(e.target as string)
      if (e.target === focusedId) ids.add(e.source as string)
    })
    return ids
  }, [focusedId, graphModel.edges])

  const displayNodes = useMemo(() => {
    if (!focusNeighbors) return laidOutNodes
    return laidOutNodes.map((n) => {
      if (focusNeighbors.has(n.id)) return n
      const paperCard = n.data.paperId ? graphModel.paperLookup.get(n.data.paperId) : undefined
      const newLabel = n.data.kind === 'paper' && paperCard
        ? renderers.paper(paperCard, n.data.degree, true)
        : n.data.kind === 'concept' && n.data.conceptId
          ? renderers.concept(
              graphModel.conceptLookup.get(n.data.conceptId)?.name || '',
              n.data.degree,
              true
            )
          : n.data.label
      return { ...n, data: { ...n.data, label: newLabel, dim: true } }
    })
  }, [laidOutNodes, focusNeighbors, graphModel.paperLookup, graphModel.conceptLookup, renderers])

  const displayEdges = useMemo(() => {
    if (!focusNeighbors) return graphModel.edges
    return graphModel.edges.map((e) => {
      const connected = focusNeighbors.has(e.source as string) && focusNeighbors.has(e.target as string)
      if (connected) {
        return { ...e, animated: e.source === focusedId || e.target === focusedId }
      }
      return {
        ...e,
        style: { ...(e.style || {}), strokeOpacity: 0.08 },
        labelStyle: { ...(e.labelStyle || {}), opacity: 0.1 },
      }
    })
  }, [graphModel.edges, focusNeighbors, focusedId])

  const paperCount = graphModel.nodes.filter((n) => n.data.kind === 'paper').length
  const conceptCount = graphModel.nodes.filter((n) => n.data.kind === 'concept').length

  useEffect(() => {
    // When the graph size changes, fit view after a tick
    if (rfInstance) {
      const t = setTimeout(() => rfInstance.fitView({ padding: 0.15, duration: 400 }), 120)
      return () => clearTimeout(t)
    }
  }, [laidOutNodes.length, rfInstance])

  const handleFitToSelection = useCallback(() => {
    if (!rfInstance) return
    if (focusNeighbors) {
      const nodes = laidOutNodes.filter((n) => focusNeighbors.has(n.id))
      rfInstance.fitView({ padding: 0.25, duration: 400, nodes })
    } else {
      rfInstance.fitView({ padding: 0.15, duration: 400 })
    }
  }, [rfInstance, focusNeighbors, laidOutNodes])

  return (
    <div className="flex h-full flex-col">
      <Toolbar
        filters={filters}
        onChange={updateFilters}
        allDomains={allDomains}
        allPaperTypes={allPaperTypes}
        nodeCount={{ papers: paperCount, concepts: conceptCount }}
        edgeCount={graphModel.edges.length}
        onReset={resetFilters}
        onFitView={handleFitToSelection}
      />
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="relative min-h-0 border-b lg:border-b-0 lg:border-r">
          {graphModel.nodes.length === 0 ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
              {t.knowledgeGraph.noNodesMatch}
            </div>
          ) : (
            <>
              <ReactFlow
                nodes={displayNodes}
                edges={displayEdges}
                fitView
                fitViewOptions={{ padding: 0.15 }}
                minZoom={0.15}
                maxZoom={2}
                nodesConnectable={false}
                nodesDraggable
                panOnDrag
                proOptions={{ hideAttribution: true }}
                onPaneClick={() => {
                  setFocusedId(null)
                  setSelected(null)
                }}
                onNodeClick={(_, node) => {
                  setFocusedId(node.id)
                  if (node.data.kind === 'paper' && node.data.paperId) {
                    const card = graphModel.paperLookup.get(node.data.paperId)
                    if (!card) return
                    setSelected({
                      kind: 'paper',
                      card,
                      conceptNames: (graphModel.cardConceptMap.get(node.data.paperId) || []).map((e) => e.name),
                      outgoingRelations: (card.relation_edges || []).filter((r) =>
                        graphModel.paperLookup.has(r.target_source_id)
                      ),
                    })
                  } else if (node.data.kind === 'concept' && node.data.conceptId) {
                    const concept = graphModel.conceptLookup.get(node.data.conceptId)
                    if (!concept) return
                    setSelected({
                      kind: 'concept',
                      conceptId: node.data.conceptId,
                      conceptName: concept.name,
                      relatedCards: concept.relatedCards,
                    })
                  }
                }}
              >
                <Background gap={22} size={1} color="#e2e8f0" />
                <Controls showInteractive={false} />
                <MiniMap
                  pannable
                  zoomable
                  nodeStrokeWidth={2}
                  nodeColor={(node) => {
                    if (node.data.kind === 'concept') return '#d1fae5'
                    const pt = (node.data as GraphNodeData).paperType
                    if (!pt) return '#e0f2fe'
                    const map: Record<PaperType, string> = {
                      foundational: '#ede9fe',
                      method: '#e0f2fe',
                      application: '#d1fae5',
                      benchmark: '#fef3c7',
                      review: '#e2e8f0',
                      survey: '#e2e8f0',
                    }
                    return map[pt]
                  }}
                />
              </ReactFlow>
              <Legend />
            </>
          )}
        </div>

        <ScrollArea className="min-h-0 h-full">
          <div className="space-y-4 p-5">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {t.knowledgeGraph.selectedNode}
              </h3>
              <p className="text-xs text-muted-foreground">
                {selected ? t.knowledgeGraph.clickToClear : t.knowledgeGraph.clickToFocus}
              </p>
            </div>

            {!selected && (
              <div className="rounded-lg border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">
                <p className="mb-2 font-medium">{t.knowledgeGraph.tips}</p>
                <ul className="list-disc space-y-1 pl-4">
                  <li>{t.knowledgeGraph.tipConceptSize}</li>
                  <li dangerouslySetInnerHTML={{ __html: t.knowledgeGraph.tipClickFit }} />
                  <li dangerouslySetInnerHTML={{ __html: t.knowledgeGraph.tipGenericLinks }} />
                  <li>{t.knowledgeGraph.tipSearch}</li>
                </ul>
              </div>
            )}

            {selected?.kind === 'paper' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <BookMarked className="mt-0.5 h-4 w-4 text-blue-600" />
                    <div>
                      <h4 className="font-semibold leading-snug">
                        {selected.card.title || selected.card.source_title || selected.card.source_id}
                      </h4>
                      <p className="text-sm text-muted-foreground">
                        {(selected.card.paper_type || 'paper').replace(/_/g, ' ')} · {selected.card.year || 'year n/a'}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selected.card.is_key_paper && <Badge className="bg-amber-500 text-white">{t.knowledgeGraph.keyPaperBadge}</Badge>}
                    {(selected.card.domains || []).slice(0, 3).map((d) => (
                      <Badge key={d} variant="outline">{d.replace(/_/g, ' ')}</Badge>
                    ))}
                  </div>
                </div>

                {selected.conceptNames.length > 0 && (
                  <div className="space-y-2">
                    <h5 className="text-sm font-medium">{t.knowledgeGraph.coreConcepts}</h5>
                    <div className="flex flex-wrap gap-2">
                      {selected.conceptNames.map((concept) => (
                        <Badge key={concept} variant="secondary">{concept}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                {selected.card.positioning_summary && (
                  <div className="space-y-2">
                    <h5 className="text-sm font-medium">{t.wikiCards.positioning}</h5>
                    <p className="text-sm leading-6 text-muted-foreground">{selected.card.positioning_summary}</p>
                  </div>
                )}

                {selected.outgoingRelations.length > 0 && (
                  <div className="space-y-2">
                    <h5 className="text-sm font-medium">{t.knowledgeGraph.outgoingRelations.replace('{count}', String(selected.outgoingRelations.length))}</h5>
                    <div className="space-y-2">
                      {selected.outgoingRelations.map((rel) => {
                        const style = RELATION_STYLES[rel.relation_type as RelationType] || RELATION_STYLES.related_work
                        const targetCard = graphModel.paperLookup.get(rel.target_source_id)
                        return (
                          <div key={`${rel.relation_type}:${rel.target_source_id}`} className="rounded border p-2">
                            <div className="flex items-center gap-2 text-xs">
                              <span className="font-medium" style={{ color: style.color }}>
                                {style.label}
                              </span>
                              <span className="text-slate-400">→</span>
                              <span className="line-clamp-1 flex-1 text-slate-700">
                                {targetCard?.short_title || targetCard?.title || rel.target_source_id}
                              </span>
                            </div>
                            {rel.reason && (
                              <p className="mt-1 text-xs leading-snug text-muted-foreground">{rel.reason}</p>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {selected?.kind === 'concept' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <Lightbulb className="mt-0.5 h-4 w-4 text-emerald-600" />
                    <div>
                      <h4 className="font-semibold leading-snug">{selected.conceptName}</h4>
                      <p className="text-sm text-muted-foreground">
                        {t.knowledgeGraph.relatedPapers.replace('{count}', String(selected.relatedCards.length))}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <h5 className="text-sm font-medium">{t.knowledgeGraph.papersUsingConcept}</h5>
                  <div className="space-y-2">
                    {selected.relatedCards.map((card) => {
                      const pt = normalizePaperType(card.paper_type)
                      const style = pt ? PAPER_TYPE_STYLES[pt] : null
                      return (
                        <div key={card.source_id} className={cn(
                          'rounded border border-l-4 p-3',
                          style ? style.border : 'border-l-slate-300'
                        )}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="space-y-1">
                              <p className="text-sm font-medium leading-snug">
                                {card.short_title || card.title || card.source_title || card.source_id}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {(card.paper_type || 'paper').replace(/_/g, ' ')} · {card.year || 'year n/a'}
                              </p>
                            </div>
                            {card.is_key_paper && <Badge className="bg-amber-500 text-white">{t.knowledgeGraph.keyBadge}</Badge>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}

            <div className="rounded-lg border bg-muted/20 p-3 text-xs leading-5 text-muted-foreground" dangerouslySetInnerHTML={{ __html: t.knowledgeGraph.forceLayoutDesc.replace('{name}', notebookName) }} />
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}

export function KnowledgeGraphDialog({
  open,
  onOpenChange,
  notebookName,
  wikiCardSlots,
}: KnowledgeGraphDialogProps) {
  const { t } = useTranslation()
  const completedCards = useMemo(
    () => wikiCardSlots
      .filter((slot) => slot.status === 'completed' && slot.wiki_card)
      .map((slot) => slot.wiki_card as SourceWikiCardResponse),
    [wikiCardSlots]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[92vh] max-w-[97vw] p-0">
        <DialogHeader className="border-b px-6 py-3 text-left">
          <DialogTitle className="flex items-center gap-2">
            <Network className="h-5 w-5 text-blue-600" />
            {t.knowledgeGraph.title.replace('{name}', notebookName)}
          </DialogTitle>
          <DialogDescription>
            {t.knowledgeGraph.description}
          </DialogDescription>
        </DialogHeader>
        <div className="h-[calc(92vh-80px)]">
          {completedCards.length === 0 ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
              {t.knowledgeGraph.generateFirst}
            </div>
          ) : (
            <ReactFlowProvider>
              <KnowledgeGraphBody cards={completedCards} notebookName={notebookName} />
            </ReactFlowProvider>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
